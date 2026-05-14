from __future__ import annotations

import datetime as dt
import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Callable, Dict, Iterable, List, Optional


class TranscriptionError(RuntimeError):
    pass


def _run_cmd(cmd: List[str]) -> str:
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if result.returncode != 0:
        raise TranscriptionError(f"Command failed: {' '.join(cmd)}\n{result.stderr.strip()}")
    return result.stdout.strip()


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise TranscriptionError("ffmpeg not found in PATH")
    if shutil.which("ffprobe") is None:
        raise TranscriptionError("ffprobe not found in PATH")


def extract_audio(input_path: Path, wav_path: Path) -> None:
    cmd = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        "-f",
        "wav",
        str(wav_path),
    ]
    _run_cmd(cmd)


def get_duration_seconds(input_path: Path) -> Optional[float]:
    try:
        output = _run_cmd(
            [
                "ffprobe",
                "-v",
                "error",
                "-show_entries",
                "format=duration",
                "-of",
                "default=nk=1:nw=1",
                str(input_path),
            ]
        )
        return float(output)
    except Exception:
        return None


def detect_device(requested: str) -> str:
    if requested != "auto":
        return requested
    try:
        import torch

        if torch.cuda.is_available():
            return "cuda"
    except Exception:
        pass
    return "cpu"


def load_whisper_model(
    model_name: str,
    device: str,
    device_index: int,
    compute_type: str,
    cpu_threads: int,
    num_workers: int,
):
    """Load OpenAI Whisper model with GPU support."""
    import whisper

    # Map model names (faster-whisper uses different names)
    model_map = {
        "distil-large-v3": "large",
        "large-v3": "large",
        "large-v2": "large",
    }
    whisper_model_name = model_map.get(model_name, model_name)

    print(f"🚀 Carregando modelo Whisper '{whisper_model_name}' na {device.upper()}...")
    model = whisper.load_model(whisper_model_name, device=device, in_memory=True)
    print("✅ Modelo carregado com sucesso!")
    return model


def transcribe_audio(
    model,
    audio_path: Path,
    language: str,
    beam_size: int,
    batch_size: int,
    vad_filter: bool,
    vad_min_silence_ms: int,
    word_timestamps: bool,
    duration_s: Optional[float] = None,
    on_progress: Optional[Callable[[float], None]] = None,
) -> Dict[str, object]:
    """Transcribe audio using OpenAI Whisper with simulated progress."""
    import threading
    import time

    # Use FP16 on CUDA for faster processing
    use_fp16 = str(model.device) != "cpu"

    # Estimate transcription time: ~0.1x realtime on GPU, ~1x on CPU
    is_gpu = str(model.device) != "cpu"
    speed_factor = 0.1 if is_gpu else 0.8  # GPU is ~10x faster than realtime
    estimated_time = (duration_s or 60) * speed_factor

    # Progress simulation thread
    result_holder = {"done": False, "result": None}

    def progress_updater():
        start_time = time.time()
        while not result_holder["done"]:
            elapsed = time.time() - start_time
            # Progress from 3% to 90% during transcription
            progress = min(0.03 + (elapsed / estimated_time) * 0.87, 0.90)
            if on_progress:
                on_progress(progress)
            time.sleep(0.5)

    # Start progress thread
    progress_thread = None
    if on_progress:
        on_progress(0.03)  # Initial progress
        progress_thread = threading.Thread(target=progress_updater, daemon=True)
        progress_thread.start()

    try:
        result = model.transcribe(
            str(audio_path),
            language=language,
            task="transcribe",
            beam_size=beam_size,
            fp16=use_fp16,
            word_timestamps=word_timestamps,
            condition_on_previous_text=True,
            verbose=False,
        )
    finally:
        result_holder["done"] = True
        if progress_thread:
            progress_thread.join(timeout=1)

    if on_progress:
        on_progress(0.92)  # Transcription done, processing segments

    items = []
    for segment in result.get("segments", []):
        text = (segment.get("text") or "").strip()
        if not text:
            continue
        items.append({"start": float(segment["start"]), "end": float(segment["end"]), "text": text})

    if on_progress:
        on_progress(0.95)  # Segments processed

    return {"segments": items, "info": result}


def run_diarization(audio_path: Path, hf_token: str, device: str) -> List[Dict[str, object]]:
    from pyannote.audio import Pipeline
    import torch

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1",
        token=hf_token,
    )

    torch_device = "cpu"
    if device == "cuda" and torch.cuda.is_available():
        torch_device = "cuda"

    pipeline.to(torch.device(torch_device))
    result = pipeline(str(audio_path))

    # pyannote.audio 4.x returns DiarizeOutput, extract the Annotation
    if hasattr(result, "speaker_diarization"):
        diarization = result.speaker_diarization
    else:
        # Fallback for older versions that return Annotation directly
        diarization = result

    turns = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        turns.append(
            {
                "start": float(turn.start),
                "end": float(turn.end),
                "speaker": speaker,
            }
        )

    return turns


def assign_speakers(
    segments: List[Dict[str, object]],
    diarization_turns: List[Dict[str, object]],
) -> None:
    if not diarization_turns:
        for segment in segments:
            segment["speaker"] = "Participante 1"
        return

    for segment in segments:
        seg_start = float(segment["start"])
        seg_end = float(segment["end"])
        best_speaker = None
        best_overlap = 0.0

        for turn in diarization_turns:
            turn_start = float(turn["start"])
            turn_end = float(turn["end"])
            overlap = min(seg_end, turn_end) - max(seg_start, turn_start)
            if overlap > best_overlap:
                best_overlap = overlap
                best_speaker = turn["speaker"]

        segment["speaker_raw"] = best_speaker or "UNKNOWN"

    mapping: Dict[str, str] = {}
    counter = 0
    for segment in segments:
        raw = segment.get("speaker_raw", "UNKNOWN")
        if raw not in mapping:
            counter += 1
            mapping[raw] = f"Participante {counter}"
        segment["speaker"] = mapping[raw]


def merge_segments(
    segments: List[Dict[str, object]],
    merge_gap_s: float,
) -> List[Dict[str, object]]:
    if not segments:
        return []

    merged: List[Dict[str, object]] = []
    for segment in segments:
        if not merged:
            merged.append(segment.copy())
            continue

        last = merged[-1]
        gap = float(segment["start"]) - float(last["end"])
        if segment.get("speaker") == last.get("speaker") and gap <= merge_gap_s:
            last["end"] = float(segment["end"])
            last["text"] = f"{last['text'].rstrip()} {segment['text'].lstrip()}".strip()
        else:
            merged.append(segment.copy())

    return merged


def format_timestamp(seconds: float) -> str:
    total = int(seconds)
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def write_markdown(
    output_path: Path,
    source_path: Path,
    metadata: Dict[str, object],
    segments: Iterable[Dict[str, object]],
) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)

    with output_path.open("w", encoding="utf-8") as handle:
        handle.write(f"# Transcricao: {source_path.name}\n\n")
        handle.write("## Metadados\n\n")
        handle.write(f"- Arquivo: {source_path}\n")
        handle.write(f"- Data: {metadata.get('processed_at')}\n")
        duration = metadata.get("duration")
        if duration is not None:
            handle.write(f"- Duracao: {duration:.1f}s\n")
        handle.write(f"- Modelo: {metadata.get('model')}\n")
        handle.write(f"- Idioma: {metadata.get('language')}\n")
        handle.write(f"- Dispositivo: {metadata.get('device')}\n")
        handle.write(f"- Diarizacao: {metadata.get('diarization')}\n")
        handle.write("\n## Transcricao\n\n")

        for segment in segments:
            speaker = segment.get("speaker", "Participante 1")
            text = segment.get("text", "").strip()
            if not text:
                continue
            timestamp = format_timestamp(float(segment["start"]))
            handle.write(f"[{timestamp}] {speaker}: {text}\n\n")


def transcribe_file(
    input_path: Path,
    output_path: Path,
    model,
    model_name: str,
    language: str,
    device: str,
    device_index: int,
    compute_type: str,
    cpu_threads: int,
    num_workers: int,
    beam_size: int,
    batch_size: int,
    vad_filter: bool,
    vad_min_silence_ms: int,
    word_timestamps: bool,
    diarize: bool,
    hf_token: Optional[str],
    merge_gap_s: float,
    keep_wav: bool,
    on_progress: Optional[Callable[[float], None]] = None,
) -> Path:
    ensure_ffmpeg()
    input_path = input_path.resolve()
    duration_s = get_duration_seconds(input_path)

    if model is None:
        model = load_whisper_model(
            model_name=model_name,
            device=device,
            device_index=device_index,
            compute_type=compute_type,
            cpu_threads=cpu_threads,
            num_workers=num_workers,
        )

    temp_dir = None
    if keep_wav:
        wav_path = output_path.with_suffix(".wav")
        wav_path.parent.mkdir(parents=True, exist_ok=True)
    else:
        temp_dir = tempfile.TemporaryDirectory()
        wav_path = Path(temp_dir.name) / f"{input_path.stem}.wav"

    extract_audio(input_path, wav_path)

    result = transcribe_audio(
        model=model,
        audio_path=wav_path,
        language=language,
        beam_size=beam_size,
        batch_size=batch_size,
        vad_filter=vad_filter,
        vad_min_silence_ms=vad_min_silence_ms,
        word_timestamps=word_timestamps,
        duration_s=duration_s,
        on_progress=on_progress,
    )

    segments = result["segments"]

    diarization_turns: List[Dict[str, object]] = []
    if diarize:
        token = hf_token or os.getenv("HF_TOKEN")
        if not token:
            # Warn but don't fail - save transcription without diarization
            import sys

            print(
                "⚠️  Diarização habilitada mas HF_TOKEN não encontrado. Salvando sem diarização.",
                file=sys.stderr,
            )
            assign_speakers(segments, [])
        else:
            diarization_turns = run_diarization(wav_path, token, device)
            assign_speakers(segments, diarization_turns)
    else:
        assign_speakers(segments, [])

    if merge_gap_s >= 0:
        segments = merge_segments(segments, merge_gap_s)

    metadata = {
        "processed_at": dt.datetime.now().isoformat(timespec="seconds"),
        "duration": duration_s,
        "model": model_name,
        "language": language,
        "device": device,
        "diarization": "on" if diarize else "off",
    }

    write_markdown(output_path, input_path, metadata, segments)

    if temp_dir is not None:
        temp_dir.cleanup()

    return output_path
