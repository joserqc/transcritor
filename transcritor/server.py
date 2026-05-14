from __future__ import annotations

import json
import os
import subprocess
import threading
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import httpx
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from pydantic import BaseModel
from fastapi.responses import StreamingResponse

from transcritor.engine import (
    TranscriptionError,
    detect_device,
    get_duration_seconds,
    load_whisper_model,
    transcribe_file,
)
from transcritor.database import (
    init_db,
    Transcription as DbTranscription,
    Job as DbJob,
    save_transcription as db_save_transcription,
    save_job as db_save_job,
    update_job as db_update_job,
    update_transcription as db_update_transcription,
    update_ata as db_update_ata,
    list_unique_clients as db_list_unique_clients,
)

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")
DATA_DIR = BASE_DIR / "data"
UPLOAD_DIR = DATA_DIR / "uploads"
TRANSCRIPT_DIR = DATA_DIR / "transcriptions"
ATA_DIR = DATA_DIR / "atas"

for folder in (UPLOAD_DIR, TRANSCRIPT_DIR, ATA_DIR):
    folder.mkdir(parents=True, exist_ok=True)


@dataclass
class JobState:
    id: str
    status: str
    progress: float
    error: Optional[str]
    file_name: Optional[str]
    created_at: str


jobs: Dict[str, JobState] = {}
job_lock = threading.Lock()
transcribe_lock = threading.Lock()

# Use 'medium' model by default - good balance of accuracy and VRAM (~5GB)
# Options: tiny, base, small, medium, large (large needs ~10GB VRAM)
MODEL_NAME = os.getenv("TRANSCRIBE_MODEL", "medium")
COMPUTE_TYPE = os.getenv("TRANSCRIBE_COMPUTE_TYPE", "float16")
DEVICE = detect_device(os.getenv("TRANSCRIBE_DEVICE", "auto"))
DEVICE_INDEX = int(os.getenv("TRANSCRIBE_DEVICE_INDEX", "0"))
CPU_THREADS = int(os.getenv("TRANSCRIBE_CPU_THREADS", os.cpu_count() or 8))
NUM_WORKERS = int(os.getenv("TRANSCRIBE_NUM_WORKERS", "1"))
BEAM_SIZE = int(os.getenv("TRANSCRIBE_BEAM_SIZE", "5"))
BATCH_SIZE = int(os.getenv("TRANSCRIBE_BATCH_SIZE", "16"))
VAD_FILTER = os.getenv("TRANSCRIBE_VAD", "1") != "0"
VAD_MIN_SILENCE_MS = int(os.getenv("TRANSCRIBE_VAD_MIN_SILENCE_MS", "500"))
LANGUAGE = os.getenv("TRANSCRIBE_LANGUAGE", "pt")
HF_TOKEN = os.getenv("HF_TOKEN")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
ATA_PROVIDER_DEFAULT = os.getenv("ATA_PROVIDER", "openrouter")
ATA_MAX_CHARS = int(os.getenv("ATA_MAX_CHARS", "20000"))

_model = None
_model_lock = threading.Lock()


def get_model():
    global _model
    with _model_lock:
        if _model is None:
            _model = load_whisper_model(
                model_name=MODEL_NAME,
                device=DEVICE,
                device_index=DEVICE_INDEX,
                compute_type=COMPUTE_TYPE,
                cpu_threads=CPU_THREADS,
                num_workers=NUM_WORKERS,
            )
        return _model


class JobResponse(BaseModel):
    id: str


class JobStatusResponse(BaseModel):
    id: str
    status: str
    progress: float
    error: Optional[str]
    fileName: Optional[str]
    createdAt: str
    transcriptId: Optional[str]


class TranscriptionSummary(BaseModel):
    id: str
    fileName: str
    createdAt: str
    duration: str
    status: str
    client: Optional[str] = None


class RenameRequest(BaseModel):
    name: str


class ClientRequest(BaseModel):
    client: str


class AtaSummary(BaseModel):
    id: str
    title: str
    createdAt: str
    sourceId: str
    client: Optional[str] = None


class AtaRequest(BaseModel):
    transcriptionId: str
    prompt: str
    provider: Optional[str] = None
    model: Optional[str] = None


def job_update(job_id: str, **kwargs) -> None:
    with job_lock:
        job = jobs[job_id]
        for key, value in kwargs.items():
            setattr(job, key, value)


def human_duration(seconds: Optional[float]) -> str:
    if seconds is None:
        return "00:00:00"
    total = int(seconds)
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def _format_date_for_display(date_str: str) -> str:
    """Convert ISO date to Brazilian format for display, or return as-is if already formatted."""
    if isinstance(date_str, str) and "T" in date_str:
        try:
            dt = datetime.fromisoformat(date_str.replace("Z", "+00:00"))
            return dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            pass
    return date_str


def load_transcriptions() -> list[TranscriptionSummary]:
    items: list[TranscriptionSummary] = []
    for meta_path in TRANSCRIPT_DIR.glob("*.json"):
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        # Prefer a custom display name if present
        display_name = data.get("displayName") or data.get("fileName")
        created_at = _format_date_for_display(data.get("createdAt", ""))
        items.append(
            TranscriptionSummary(
                id=data["id"],
                fileName=display_name,
                createdAt=created_at,
                duration=data.get("duration", "00:00:00"),
                status=data.get("status", "Finalizado"),
                client=data.get("client"),
            )
        )
    items.sort(key=lambda item: item.createdAt, reverse=True)
    return items


def load_atas() -> list[AtaSummary]:
    items: list[AtaSummary] = []
    for meta_path in ATA_DIR.glob("*.json"):
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        created_at = _format_date_for_display(data.get("createdAt", ""))
        items.append(
            AtaSummary(
                id=data["id"],
                title=data["title"],
                createdAt=created_at,
                sourceId=data["sourceId"],
                client=data.get("client"),
            )
        )
    items.sort(key=lambda item: item.createdAt, reverse=True)
    return items


def select_provider(requested: Optional[str]) -> str:
    provider = (requested or ATA_PROVIDER_DEFAULT or "").lower()
    if provider not in {"openrouter", "openai"}:
        provider = "openrouter"
    if provider == "openrouter" and OPENROUTER_API_KEY:
        return provider
    if provider == "openai" and OPENAI_API_KEY:
        return provider
    if OPENROUTER_API_KEY:
        return "openrouter"
    if OPENAI_API_KEY:
        return "openai"
    raise HTTPException(status_code=400, detail="Nenhuma API key encontrada")


def select_model(provider: str, requested: Optional[str]) -> str:
    if requested:
        return requested
    return OPENROUTER_MODEL if provider == "openrouter" else OPENAI_MODEL


def build_ata_prompt(transcript_content: str, prompt: str) -> list[dict]:
    system = (
        "Voce e um assistente que gera ATAs em Markdown, em pt-BR, "
        "com foco em clareza e objetividade. Use seções: Objetivo, "
        "Participantes (se houver), Principais pontos, Decisoes, "
        "Pendencias e Proximos passos. Nao invente informacoes."
    )
    body = (
        f"Prompt do usuario:\n{prompt}\n\n"
        "Transcricao completa (pode estar truncada):\n"
        "```\n"
        f"{transcript_content}\n"
        "```"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": body},
    ]


def stream_chat_completions(url: str, headers: dict, payload: dict):
    with httpx.stream("POST", url, headers=headers, json=payload, timeout=180) as response:
        if response.status_code >= 300:
            raise HTTPException(status_code=502, detail=response.text)
        for line in response.iter_lines():
            if not line:
                continue
            if line.startswith("data:"):
                data = line[len("data:") :].strip()
            else:
                continue
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            choice = chunk.get("choices", [{}])[0]
            delta = choice.get("delta") or {}
            content = delta.get("content")
            if content:
                yield content


def stream_openrouter(messages: list[dict], model: str):
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "X-Title": "transcritor-local",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1200,
        "stream": True,
    }
    yield from stream_chat_completions(
        "https://openrouter.ai/api/v1/chat/completions",
        headers,
        payload,
    )


def stream_openai(messages: list[dict], model: str):
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": model,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1200,
        "stream": True,
    }
    yield from stream_chat_completions(
        "https://api.openai.com/v1/chat/completions",
        headers,
        payload,
    )


def call_openrouter(messages: list[dict]) -> str:
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "Content-Type": "application/json",
        "X-Title": "transcritor-local",
    }
    payload = {
        "model": OPENROUTER_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1200,
    }
    with httpx.Client(timeout=120) as client:
        response = client.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers=headers,
            json=payload,
        )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text)
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


def call_openai(messages: list[dict]) -> str:
    headers = {
        "Authorization": f"Bearer {OPENAI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": OPENAI_MODEL,
        "messages": messages,
        "temperature": 0.2,
        "max_tokens": 1200,
    }
    with httpx.Client(timeout=120) as client:
        response = client.post(
            "https://api.openai.com/v1/chat/completions",
            headers=headers,
            json=payload,
        )
    if response.status_code >= 300:
        raise HTTPException(status_code=502, detail=response.text)
    data = response.json()
    return data["choices"][0]["message"]["content"].strip()


def create_transcription_job(
    job_id: str,
    input_path: Path,
    file_name: str,
    diarize: bool,
) -> None:
    with transcribe_lock:
        output_path = TRANSCRIPT_DIR / f"{job_id}.md"
        meta_path = TRANSCRIPT_DIR / f"{job_id}.json"
        try:
            model = get_model()

            def on_progress(value: float) -> None:
                job_update(job_id, progress=max(min(value * 100, 100), 1))

            transcribe_file(
                input_path=input_path,
                output_path=output_path,
                model=model,
                model_name=MODEL_NAME,
                language=LANGUAGE,
                device=DEVICE,
                device_index=DEVICE_INDEX,
                compute_type=COMPUTE_TYPE,
                cpu_threads=CPU_THREADS,
                num_workers=NUM_WORKERS,
                beam_size=BEAM_SIZE,
                batch_size=BATCH_SIZE,
                vad_filter=VAD_FILTER,
                vad_min_silence_ms=VAD_MIN_SILENCE_MS,
                word_timestamps=False,
                diarize=diarize,
                hf_token=HF_TOKEN,
                merge_gap_s=0.7,
                keep_wav=False,
                on_progress=on_progress,
            )

            duration = get_duration_seconds(input_path)
            created_at = datetime.now().isoformat()

            # Read markdown content
            markdown_content = None
            if output_path.exists():
                with output_path.open("r", encoding="utf-8") as f:
                    markdown_content = f.read()

            # Save to database
            db_transcription = DbTranscription(
                id=job_id,
                file_name=file_name,
                created_at=created_at,
                duration=human_duration(duration),
                status="Finalizado",
                markdown_content=markdown_content,
            )
            db_save_transcription(db_transcription)

            # Also save JSON for backward compatibility
            meta = {
                "id": job_id,
                "fileName": file_name,
                "createdAt": created_at,
                "duration": human_duration(duration),
                "status": "Finalizado",
                "markdownPath": str(output_path),
            }
            with meta_path.open("w", encoding="utf-8") as handle:
                json.dump(meta, handle, ensure_ascii=False, indent=2)

            job_update(job_id, status="completed", progress=100)
            db_update_job(job_id, status="completed", progress=100, transcription_id=job_id)
        except TranscriptionError as exc:
            job_update(job_id, status="failed", error=str(exc))
            db_update_job(job_id, status="failed", error=str(exc))
        except Exception as exc:
            error_msg = f"Unexpected: {exc}"
            job_update(job_id, status="failed", error=error_msg)
            db_update_job(job_id, status="failed", error=error_msg)
        finally:
            try:
                if input_path.exists():
                    input_path.unlink()
            except Exception as cleanup_exc:
                # Do not fail the job if cleanup fails; just log it.
                print(f"Could not delete uploaded file {input_path}: {cleanup_exc}")


app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_event():
    """Initialize database connection."""
    init_db()


def sse(event: str, payload: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


@app.post("/api/transcriptions", response_model=JobResponse)
async def create_transcription(
    file: UploadFile = File(...),
    diarize: bool = Form(False),
) -> JobResponse:
    if not file.filename:
        raise HTTPException(status_code=400, detail="Arquivo invalido")

    job_id = uuid.uuid4().hex
    created_at = datetime.now().isoformat()
    job_state = JobState(
        id=job_id,
        status="queued",
        progress=0.0,
        error=None,
        file_name=file.filename,
        created_at=created_at,
    )
    with job_lock:
        jobs[job_id] = job_state

    # Save job to database
    db_job = DbJob(
        id=job_id,
        status="queued",
        progress=0.0,
        created_at=created_at,
        file_name=file.filename,
    )
    db_save_job(db_job)

    target_path = UPLOAD_DIR / f"{job_id}-{file.filename}"
    with target_path.open("wb") as handle:
        while True:
            chunk = await file.read(1024 * 1024)
            if not chunk:
                break
            handle.write(chunk)

    thread = threading.Thread(
        target=create_transcription_job,
        args=(job_id, target_path, file.filename, diarize),
        daemon=True,
    )
    job_update(job_id, status="running", progress=1)
    thread.start()

    return JobResponse(id=job_id)


@app.get("/api/transcriptions", response_model=list[TranscriptionSummary])
async def list_transcriptions() -> list[TranscriptionSummary]:
    return load_transcriptions()


@app.get("/api/transcriptions/{job_id}", response_model=JobStatusResponse)
async def get_transcription(job_id: str) -> JobStatusResponse:
    with job_lock:
        job = jobs.get(job_id)

    transcript_id = None
    if job is None:
        meta_path = TRANSCRIPT_DIR / f"{job_id}.json"
        if meta_path.exists():
            transcript_id = job_id
            with meta_path.open("r", encoding="utf-8") as handle:
                data = json.load(handle)
            return JobStatusResponse(
                id=job_id,
                status="completed",
                progress=100,
                error=None,
                fileName=data.get("fileName"),
                createdAt=data.get("createdAt", ""),
                transcriptId=transcript_id,
            )
        raise HTTPException(status_code=404, detail="Job nao encontrado")

    if job.status == "completed":
        transcript_id = job_id

    return JobStatusResponse(
        id=job.id,
        status=job.status,
        progress=job.progress,
        error=job.error,
        fileName=job.file_name,
        createdAt=job.created_at,
        transcriptId=transcript_id,
    )


@app.get("/api/transcriptions/{job_id}/markdown")
async def get_transcription_markdown(job_id: str) -> dict:
    meta_path = TRANSCRIPT_DIR / f"{job_id}.json"
    markdown_path = TRANSCRIPT_DIR / f"{job_id}.md"
    if meta_path.exists():
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        markdown_path = Path(data.get("markdownPath", markdown_path))

    if not markdown_path.exists():
        raise HTTPException(status_code=404, detail="Markdown nao encontrado")

    return {"content": markdown_path.read_text(encoding="utf-8")}


@app.delete("/api/transcriptions/{transcription_id}")
async def delete_transcription(transcription_id: str) -> dict:
    meta_path = TRANSCRIPT_DIR / f"{transcription_id}.json"
    markdown_path = TRANSCRIPT_DIR / f"{transcription_id}.md"
    print(f"[DELETE transcricao] meta_path={meta_path} exists={meta_path.exists()}")

    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Transcricao nao encontrada")

    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        markdown_path = Path(data.get("markdownPath", markdown_path))
    except Exception:
        # Proceed with default markdown path if metadata read fails
        pass

    if markdown_path.exists():
        try:
            markdown_path.unlink()
        except Exception:
            print(f"Could not delete markdown file {markdown_path}")

    try:
        meta_path.unlink()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao deletar transcricao: {exc}")

    return {"message": "Transcricao deletada"}


# Avoid path collision with job status endpoint by exposing an alternate route
@app.delete("/api/transcriptions/{transcription_id}/delete")
async def delete_transcription_alt(transcription_id: str) -> dict:
    return await delete_transcription(transcription_id)


@app.patch("/api/transcriptions/{transcription_id}/rename")
async def rename_transcription(transcription_id: str, payload: RenameRequest) -> dict:
    """Rename a transcription for display purposes.

    This updates the local JSON metadata (adds/updates `displayName`) and also
    persists the value into the database `metadata.displayName` field. It does
    not change the original uploaded file path.
    """
    meta_path = TRANSCRIPT_DIR / f"{transcription_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Transcricao nao encontrada")

    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao ler metadados")

    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Nome invalido")

    # Update local JSON meta
    meta["displayName"] = name
    try:
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao salvar metadados")

    # Update database metadata (best effort)
    try:
        db_update_transcription(transcription_id, metadata={"displayName": name})
    except Exception:
        # Non-fatal if DB update fails; local file remains source of truth for UI
        pass

    # Return updated summary so UI can refresh row optimistically
    return {
        "id": transcription_id,
        "fileName": name,
        "ok": True,
    }


@app.post("/api/atas", response_model=AtaSummary)
async def create_ata(payload: AtaRequest) -> AtaSummary:
    meta_path = TRANSCRIPT_DIR / f"{payload.transcriptionId}.json"
    markdown_path = TRANSCRIPT_DIR / f"{payload.transcriptionId}.md"
    if not meta_path.exists() or not markdown_path.exists():
        raise HTTPException(status_code=404, detail="Transcricao nao encontrada")

    with meta_path.open("r", encoding="utf-8") as handle:
        meta = json.load(handle)

    transcript_content = markdown_path.read_text(encoding="utf-8")
    provider = select_provider(payload.provider)
    model_name = select_model(provider, payload.model)
    trimmed = transcript_content[:ATA_MAX_CHARS]
    messages = build_ata_prompt(trimmed, payload.prompt)
    if len(transcript_content) > ATA_MAX_CHARS:
        messages.append(
            {
                "role": "user",
                "content": (f"Nota: a transcricao foi truncada para {ATA_MAX_CHARS} caracteres."),
            }
        )
    now = datetime.now().isoformat()
    ata_id = uuid.uuid4().hex
    base_name = meta.get("displayName") or meta.get("fileName", "Transcricao")
    title = f"ATA - {base_name.replace('.mp4', '')}"

    if provider == "openrouter":
        ata_body = call_openrouter(messages)
    else:
        ata_body = call_openai(messages)

    ata_markdown = (
        f"# {title}\n\n"
        f"## Metadados\n"
        f"- Provider: {provider}\n"
        f"- Modelo: {model_name}\n"
        f"- Data: {now}\n\n"
        f"## Prompt utilizado\n{payload.prompt}\n\n"
        f"## ATA\n\n{ata_body}\n"
    )

    ata_meta = {
        "id": ata_id,
        "title": title,
        "createdAt": now,
        "sourceId": payload.transcriptionId,
        "markdownPath": str(ATA_DIR / f"{ata_id}.md"),
        "provider": provider,
        "model": model_name,
        "prompt": payload.prompt,
    }

    (ATA_DIR / f"{ata_id}.md").write_text(ata_markdown, encoding="utf-8")
    (ATA_DIR / f"{ata_id}.json").write_text(
        json.dumps(ata_meta, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    return AtaSummary(
        id=ata_id,
        title=title,
        createdAt=now,
        sourceId=payload.transcriptionId,
    )


@app.post("/api/atas/stream")
async def create_ata_stream(payload: AtaRequest):
    meta_path = TRANSCRIPT_DIR / f"{payload.transcriptionId}.json"
    markdown_path = TRANSCRIPT_DIR / f"{payload.transcriptionId}.md"
    if not meta_path.exists() or not markdown_path.exists():
        raise HTTPException(status_code=404, detail="Transcricao nao encontrada")

    with meta_path.open("r", encoding="utf-8") as handle:
        meta = json.load(handle)

    transcript_content = markdown_path.read_text(encoding="utf-8")
    provider = select_provider(payload.provider)
    model_name = select_model(provider, payload.model)
    trimmed = transcript_content[:ATA_MAX_CHARS]
    messages = build_ata_prompt(trimmed, payload.prompt)
    if len(transcript_content) > ATA_MAX_CHARS:
        messages.append(
            {
                "role": "user",
                "content": (f"Nota: a transcricao foi truncada para {ATA_MAX_CHARS} caracteres."),
            }
        )

    now = datetime.now().isoformat()
    ata_id = uuid.uuid4().hex
    base_name = meta.get("displayName") or meta.get("fileName", "Transcricao")
    title = f"ATA - {base_name.replace('.mp4', '')}"

    def event_stream():
        chunks: list[str] = []
        try:
            if provider == "openrouter":
                stream_iter = stream_openrouter(messages, model_name)
            else:
                stream_iter = stream_openai(messages, model_name)

            for token in stream_iter:
                chunks.append(token)
                yield sse("chunk", {"t": token})

            ata_body = "".join(chunks).strip()
            if not ata_body:
                raise HTTPException(status_code=502, detail="Resposta vazia do LLM")

            ata_markdown = (
                f"# {title}\n\n"
                f"## Metadados\n"
                f"- Provider: {provider}\n"
                f"- Modelo: {model_name}\n"
                f"- Data: {now}\n\n"
                f"## Prompt utilizado\n{payload.prompt}\n\n"
                f"## ATA\n\n{ata_body}\n"
            )

            ata_meta = {
                "id": ata_id,
                "title": title,
                "createdAt": now,
                "sourceId": payload.transcriptionId,
                "markdownPath": str(ATA_DIR / f"{ata_id}.md"),
                "provider": provider,
                "model": model_name,
                "prompt": payload.prompt,
            }

            (ATA_DIR / f"{ata_id}.md").write_text(ata_markdown, encoding="utf-8")
            (ATA_DIR / f"{ata_id}.json").write_text(
                json.dumps(ata_meta, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            yield sse(
                "done",
                {
                    "id": ata_id,
                    "title": title,
                    "createdAt": now,
                    "sourceId": payload.transcriptionId,
                },
            )
        except HTTPException as exc:
            yield sse("error", {"message": exc.detail})
        except Exception as exc:
            yield sse("error", {"message": str(exc)})

    return StreamingResponse(event_stream(), media_type="text/event-stream")


@app.get("/api/atas", response_model=list[AtaSummary])
async def list_atas() -> list[AtaSummary]:
    return load_atas()


@app.get("/api/atas/{ata_id}/markdown")
async def get_ata_markdown(ata_id: str) -> dict:
    meta_path = ATA_DIR / f"{ata_id}.json"
    markdown_path = ATA_DIR / f"{ata_id}.md"
    if meta_path.exists():
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        markdown_path = Path(data.get("markdownPath", markdown_path))

    if not markdown_path.exists():
        raise HTTPException(status_code=404, detail="Markdown nao encontrado")

    return {"content": markdown_path.read_text(encoding="utf-8")}


@app.delete("/api/atas/{ata_id}")
async def delete_ata(ata_id: str) -> dict:
    meta_path = ATA_DIR / f"{ata_id}.json"
    markdown_path = ATA_DIR / f"{ata_id}.md"

    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="ATA nao encontrada")

    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
        markdown_path = Path(data.get("markdownPath", markdown_path))
    except Exception:
        # Proceed with default markdown path if metadata read fails
        pass

    if markdown_path.exists():
        try:
            markdown_path.unlink()
        except Exception:
            print(f"Could not delete markdown file {markdown_path}")

    try:
        meta_path.unlink()
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Falha ao deletar ATA: {exc}")

    return {"message": "ATA deletada"}


@app.get("/api/clients")
async def list_clients() -> list[str]:
    """List all unique clients from transcriptions and ATAs."""
    return db_list_unique_clients()


@app.patch("/api/transcriptions/{transcription_id}/client")
async def update_transcription_client(transcription_id: str, payload: ClientRequest) -> dict:
    """Update the client field of a transcription."""
    meta_path = TRANSCRIPT_DIR / f"{transcription_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="Transcricao nao encontrada")

    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao ler metadados")

    client_value = (payload.client or "").strip()
    # Allow empty string to clear the client
    meta["client"] = client_value if client_value else None

    try:
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao salvar metadados")

    # Update database (best effort)
    try:
        db_update_transcription(transcription_id, client=meta["client"])
    except Exception:
        pass

    return {
        "id": transcription_id,
        "client": meta["client"],
        "ok": True,
    }


@app.patch("/api/atas/{ata_id}/client")
async def update_ata_client(ata_id: str, payload: ClientRequest) -> dict:
    """Update the client field of an ATA."""
    meta_path = ATA_DIR / f"{ata_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="ATA nao encontrada")

    try:
        with meta_path.open("r", encoding="utf-8") as handle:
            meta = json.load(handle)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao ler metadados")

    client_value = (payload.client or "").strip()
    meta["client"] = client_value if client_value else None

    try:
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)
    except Exception:
        raise HTTPException(status_code=500, detail="Falha ao salvar metadados")

    # Update database (best effort)
    try:
        db_update_ata(ata_id, client=meta["client"])
    except Exception:
        pass

    return {
        "id": ata_id,
        "client": meta["client"],
        "ok": True,
    }


@app.get("/api/by-client/transcriptions")
async def list_transcriptions_by_client(client: Optional[str] = None) -> list[TranscriptionSummary]:
    """List transcriptions filtered by client. Use '__unassigned__' to get items without a client."""
    items: list[TranscriptionSummary] = []
    for meta_path in TRANSCRIPT_DIR.glob("*.json"):
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)

        item_client = data.get("client")

        # Filter logic
        if client == "__unassigned__":
            if item_client is not None and item_client != "":
                continue
        elif client:
            if item_client != client:
                continue

        display_name = data.get("displayName") or data.get("fileName")
        created_at = _format_date_for_display(data.get("createdAt", ""))
        items.append(
            TranscriptionSummary(
                id=data["id"],
                fileName=display_name,
                createdAt=created_at,
                duration=data.get("duration", "00:00:00"),
                status=data.get("status", "Finalizado"),
                client=item_client,
            )
        )
    items.sort(key=lambda item: item.createdAt, reverse=True)
    return items


@app.get("/api/by-client/atas")
async def list_atas_by_client(client: Optional[str] = None) -> list[AtaSummary]:
    """List ATAs filtered by client. Use '__unassigned__' to get items without a client."""
    items: list[AtaSummary] = []
    for meta_path in ATA_DIR.glob("*.json"):
        with meta_path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)

        item_client = data.get("client")

        # Filter logic
        if client == "__unassigned__":
            if item_client is not None and item_client != "":
                continue
        elif client:
            if item_client != client:
                continue

        created_at = _format_date_for_display(data.get("createdAt", ""))
        items.append(
            AtaSummary(
                id=data["id"],
                title=data["title"],
                createdAt=created_at,
                sourceId=data["sourceId"],
                client=item_client,
            )
        )
    items.sort(key=lambda item: item.createdAt, reverse=True)
    return items


@app.post("/api/shutdown")
async def shutdown_server() -> dict:
    """Executa o script stop.sh para encerrar o servidor."""
    stop_script = BASE_DIR / "stop.sh"

    if not stop_script.exists():
        raise HTTPException(status_code=404, detail="Script stop.sh não encontrado")

    try:
        # Executa o script em background para não bloquear a resposta
        subprocess.Popen([str(stop_script)], shell=False)
        return {"message": "Servidor será encerrado em breve"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao executar script: {str(e)}")
