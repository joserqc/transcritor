"""
Helpers for meeting titles and recording dates.

Kept free of heavy imports (torch/whisper) so maintenance scripts can use it
without loading the transcription engine.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
OPENROUTER_MODEL = os.getenv("OPENROUTER_MODEL", "anthropic/claude-3.5-sonnet")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# OBS-style recording timestamp embedded in file names: "2026-06-10 10-23-50"
_FULL_TS_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})")
_DATE_ONLY_RE = re.compile(r"(\d{4})-(\d{2})-(\d{2})")


def extract_recorded_at(file_name: str) -> Optional[datetime]:
    """Parse the recording timestamp embedded in the file name, if any.

    Returns a naive local datetime, or None when the name has no plausible
    (past, year >= 2020) timestamp.
    """
    if not file_name:
        return None
    now = datetime.now()
    match = _FULL_TS_RE.search(file_name)
    if match:
        try:
            dt = datetime(*(int(g) for g in match.groups()))
            if 2020 <= dt.year and dt <= now:
                return dt
        except ValueError:
            pass
    match = _DATE_ONLY_RE.search(file_name)
    if match:
        try:
            dt = datetime(*(int(g) for g in match.groups()))
            if 2020 <= dt.year and dt <= now:
                return dt
        except ValueError:
            pass
    return None


_TITLE_SYSTEM_PROMPT = (
    "Você cria títulos curtos para reuniões transcritas, em português do Brasil. "
    "Responda APENAS com o título, sem aspas nem ponto final, com no máximo 60 caracteres. "
    "Prefira o formato 'Tema principal - Participantes ou cliente'. "
    "Use somente nomes e assuntos presentes na transcrição; não invente informações."
)


def _chat(url: str, api_key: str, model: str, messages: list[dict]) -> str:
    headers = {"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"}
    if "openrouter" in url:
        headers["X-Title"] = "transcritor-local"
    payload = {"model": model, "messages": messages, "temperature": 0.3, "max_tokens": 80}
    # Provedores ocasionalmente devolvem content nulo/vazio em respostas 200;
    # uma nova tentativa simples resolve a maioria desses casos.
    for attempt in (1, 2):
        with httpx.Client(timeout=60) as client:
            response = client.post(url, headers=headers, json=payload)
        response.raise_for_status()
        content = response.json()["choices"][0]["message"].get("content")
        if content:
            return content
    return ""


def generate_meeting_title(transcript_content: str, file_name: str = "") -> Optional[str]:
    """Generate a short pt-BR title for a transcript via LLM. Best-effort.

    Returns None when no API key is configured, the transcript is empty, or
    the provider call fails — callers must treat the title as optional.
    """
    excerpt = (transcript_content or "").strip()
    if not excerpt:
        return None
    excerpt = excerpt[:6000]
    messages = [
        {"role": "system", "content": _TITLE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": f"Arquivo original: {file_name}\n\nInício da transcrição:\n{excerpt}",
        },
    ]
    try:
        if OPENROUTER_API_KEY:
            raw = _chat(
                "https://openrouter.ai/api/v1/chat/completions",
                OPENROUTER_API_KEY,
                OPENROUTER_MODEL,
                messages,
            )
        elif OPENAI_API_KEY:
            raw = _chat(
                "https://api.openai.com/v1/chat/completions",
                OPENAI_API_KEY,
                OPENAI_MODEL,
                messages,
            )
        else:
            return None
    except Exception as exc:
        print(f"[auto-title] geração de título falhou: {exc}")
        return None
    if not raw:
        return None
    title = raw.strip().strip('"').strip("'").splitlines()[0].strip()
    return title[:80] or None
