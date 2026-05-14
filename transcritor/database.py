"""
Database module for persisting transcriptions, jobs, and ATAs.
Uses Supabase for cloud storage.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

# Load .env from project root
BASE_DIR = Path(__file__).resolve().parents[1]
load_dotenv(BASE_DIR / ".env")

# Supabase configuration (required — see .env.example)
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_KEY")

_client = None


def _get_client():
    """Get or create Supabase client."""
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_KEY:
            raise RuntimeError(
                "SUPABASE_URL and SUPABASE_KEY are required. "
                "Copy .env.example to .env and fill in your credentials."
            )
        try:
            from supabase import create_client

            _client = create_client(SUPABASE_URL, SUPABASE_KEY)
        except ImportError:
            raise ImportError("supabase package not installed. Run: pip install supabase")
    return _client


def init_db():
    """Initialize database connection."""
    _get_client()
    print(f"✅ Connected to Supabase: {SUPABASE_URL}")


# ==================== Transcription CRUD ====================


@dataclass
class Transcription:
    id: str
    file_name: str
    created_at: str
    duration: Optional[str] = None
    status: str = "Finalizado"
    markdown_content: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    updated_at: Optional[str] = None
    client: Optional[str] = None


def save_transcription(transcription: Transcription) -> None:
    """Save or update a transcription."""
    db_client = _get_client()
    data = {
        "id": transcription.id,
        "file_name": transcription.file_name,
        "created_at": transcription.created_at,
        "duration": transcription.duration,
        "status": transcription.status,
        "markdown_content": transcription.markdown_content,
        "metadata": transcription.metadata,
        "client": transcription.client,
    }
    db_client.table("transcriptions").upsert(data).execute()


def get_transcription(transcription_id: str) -> Optional[Transcription]:
    """Get a transcription by ID."""
    client = _get_client()
    response = client.table("transcriptions").select("*").eq("id", transcription_id).execute()
    if not response.data:
        return None
    return _dict_to_transcription(response.data[0])


def list_transcriptions(limit: int = 100, offset: int = 0) -> List[Transcription]:
    """List all transcriptions, ordered by creation date (newest first)."""
    client = _get_client()
    response = (
        client.table("transcriptions")
        .select("*")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [_dict_to_transcription(row) for row in response.data]


def delete_transcription(transcription_id: str) -> bool:
    """Delete a transcription."""
    client = _get_client()
    response = client.table("transcriptions").delete().eq("id", transcription_id).execute()
    return len(response.data) > 0


def update_transcription(transcription_id: str, **updates) -> bool:
    """Update specific fields of a transcription.

    Allowed fields: file_name, status, duration, markdown_content, metadata, client.
    If metadata is provided as a dict, it will be shallow-merged with the
    existing metadata on the record (when possible).
    """
    if not updates:
        return False

    allowed = {"file_name", "status", "duration", "markdown_content", "metadata", "client"}
    payload = {k: v for k, v in updates.items() if k in allowed}
    if not payload:
        return False

    # If we are updating metadata, try to merge with existing
    if "metadata" in payload and isinstance(payload["metadata"], dict):
        try:
            existing = get_transcription(transcription_id)
            if existing and isinstance(existing.metadata, dict):
                merged = {**existing.metadata, **payload["metadata"]}
                payload["metadata"] = merged
        except Exception:
            # Best-effort merge; if it fails, fall back to provided metadata
            pass

    client = _get_client()
    response = client.table("transcriptions").update(payload).eq("id", transcription_id).execute()
    return len(response.data) > 0


def _dict_to_transcription(d: Dict[str, Any]) -> Transcription:
    """Convert dict to Transcription object."""
    created_at = d.get("created_at", "")
    if isinstance(created_at, str) and "T" in created_at:
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            created_at = dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            pass

    return Transcription(
        id=d["id"],
        file_name=d["file_name"],
        created_at=created_at,
        duration=d.get("duration"),
        status=d.get("status", "Finalizado"),
        markdown_content=d.get("markdown_content"),
        metadata=d.get("metadata"),
        updated_at=d.get("updated_at"),
        client=d.get("client"),
    )


# ==================== Job CRUD ====================


@dataclass
class Job:
    id: str
    status: str
    progress: float
    created_at: str
    file_name: Optional[str] = None
    error: Optional[str] = None
    transcription_id: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


def save_job(job: Job) -> None:
    """Save or update a job."""
    client = _get_client()
    data = {
        "id": job.id,
        "status": job.status,
        "progress": job.progress,
        "error": job.error,
        "file_name": job.file_name,
        "created_at": job.created_at,
        "transcription_id": job.transcription_id,
        "metadata": job.metadata,
    }
    client.table("jobs").upsert(data).execute()


def get_job(job_id: str) -> Optional[Job]:
    """Get a job by ID."""
    client = _get_client()
    response = client.table("jobs").select("*").eq("id", job_id).execute()
    if not response.data:
        return None
    return _dict_to_job(response.data[0])


def update_job(job_id: str, **updates) -> bool:
    """Update specific fields of a job."""
    if not updates:
        return False

    valid_fields = {"status", "progress", "error", "transcription_id", "metadata"}
    filtered_updates = {k: v for k, v in updates.items() if k in valid_fields}

    if not filtered_updates:
        return False

    client = _get_client()
    response = client.table("jobs").update(filtered_updates).eq("id", job_id).execute()
    return len(response.data) > 0


def list_active_jobs() -> List[Job]:
    """List all active (non-completed, non-failed) jobs."""
    client = _get_client()
    response = (
        client.table("jobs")
        .select("*")
        .not_.in_("status", ["completed", "failed"])
        .order("created_at", desc=True)
        .execute()
    )
    return [_dict_to_job(row) for row in response.data]


def _dict_to_job(d: Dict[str, Any]) -> Job:
    """Convert dict to Job object."""
    created_at = d.get("created_at", "")
    if isinstance(created_at, str) and "T" in created_at:
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            created_at = dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            pass

    return Job(
        id=d["id"],
        status=d["status"],
        progress=d.get("progress", 0),
        error=d.get("error"),
        file_name=d.get("file_name"),
        created_at=created_at,
        transcription_id=d.get("transcription_id"),
        metadata=d.get("metadata"),
    )


# ==================== ATA CRUD ====================


@dataclass
class Ata:
    id: str
    title: str
    created_at: str
    source_id: str
    content: Optional[str] = None
    prompt: Optional[str] = None
    provider: Optional[str] = None
    model: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    client: Optional[str] = None


def save_ata(ata: Ata) -> None:
    """Save or update an ATA."""
    db_client = _get_client()
    data = {
        "id": ata.id,
        "title": ata.title,
        "created_at": ata.created_at,
        "source_id": ata.source_id,
        "content": ata.content,
        "prompt": ata.prompt,
        "provider": ata.provider,
        "model": ata.model,
        "metadata": ata.metadata,
        "client": ata.client,
    }
    db_client.table("atas").upsert(data).execute()


def get_ata(ata_id: str) -> Optional[Ata]:
    """Get an ATA by ID."""
    client = _get_client()
    response = client.table("atas").select("*").eq("id", ata_id).execute()
    if not response.data:
        return None
    return _dict_to_ata(response.data[0])


def list_atas(limit: int = 100, offset: int = 0) -> List[Ata]:
    """List all ATAs, ordered by creation date (newest first)."""
    client = _get_client()
    response = (
        client.table("atas")
        .select("*")
        .order("created_at", desc=True)
        .range(offset, offset + limit - 1)
        .execute()
    )
    return [_dict_to_ata(row) for row in response.data]


def delete_ata(ata_id: str) -> bool:
    """Delete an ATA."""
    db_client = _get_client()
    response = db_client.table("atas").delete().eq("id", ata_id).execute()
    return len(response.data) > 0


def update_ata(ata_id: str, **updates) -> bool:
    """Update specific fields of an ATA.

    Allowed fields: title, content, prompt, provider, model, metadata, client.
    """
    if not updates:
        return False

    allowed = {"title", "content", "prompt", "provider", "model", "metadata", "client"}
    payload = {k: v for k, v in updates.items() if k in allowed}
    if not payload:
        return False

    db_client = _get_client()
    response = db_client.table("atas").update(payload).eq("id", ata_id).execute()
    return len(response.data) > 0


def list_unique_clients() -> List[str]:
    """List all unique clients from transcriptions and ATAs."""
    db_client = _get_client()
    clients = set()

    # Get clients from transcriptions
    response = (
        db_client.table("transcriptions").select("client").not_.is_("client", "null").execute()
    )
    for row in response.data:
        if row.get("client"):
            clients.add(row["client"])

    # Get clients from ATAs
    response = db_client.table("atas").select("client").not_.is_("client", "null").execute()
    for row in response.data:
        if row.get("client"):
            clients.add(row["client"])

    return sorted(list(clients))


def list_transcriptions_by_client(
    client_filter: Optional[str] = None, limit: int = 100, offset: int = 0
) -> List[Transcription]:
    """List transcriptions, optionally filtered by client."""
    db_client = _get_client()
    query = db_client.table("transcriptions").select("*")

    if client_filter == "__unassigned__":
        query = query.is_("client", "null")
    elif client_filter:
        query = query.eq("client", client_filter)

    response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return [_dict_to_transcription(row) for row in response.data]


def list_atas_by_client(
    client_filter: Optional[str] = None, limit: int = 100, offset: int = 0
) -> List[Ata]:
    """List ATAs, optionally filtered by client."""
    db_client = _get_client()
    query = db_client.table("atas").select("*")

    if client_filter == "__unassigned__":
        query = query.is_("client", "null")
    elif client_filter:
        query = query.eq("client", client_filter)

    response = query.order("created_at", desc=True).range(offset, offset + limit - 1).execute()
    return [_dict_to_ata(row) for row in response.data]


def _dict_to_ata(d: Dict[str, Any]) -> Ata:
    """Convert dict to Ata object."""
    created_at = d.get("created_at", "")
    if isinstance(created_at, str) and "T" in created_at:
        try:
            dt = datetime.fromisoformat(created_at.replace("Z", "+00:00"))
            created_at = dt.strftime("%d/%m/%Y %H:%M")
        except Exception:
            pass

    return Ata(
        id=d["id"],
        title=d["title"],
        created_at=created_at,
        source_id=d["source_id"],
        content=d.get("content"),
        prompt=d.get("prompt"),
        provider=d.get("provider"),
        model=d.get("model"),
        metadata=d.get("metadata"),
        client=d.get("client"),
    )


# ==================== Migration from local files ====================


def migrate_from_files(transcript_dir: Path, ata_dir: Path) -> int:
    """Migrate existing JSON/MD files to Supabase."""
    import json

    count = 0

    # Migrate transcriptions
    for meta_path in transcript_dir.glob("*.json"):
        try:
            with meta_path.open("r", encoding="utf-8") as f:
                data = json.load(f)

            # Check if already exists
            if get_transcription(data["id"]):
                continue

            # Read markdown content
            md_path = meta_path.with_suffix(".md")
            markdown_content = None
            if md_path.exists():
                with md_path.open("r", encoding="utf-8") as f:
                    markdown_content = f.read()

            transcription = Transcription(
                id=data["id"],
                file_name=data["fileName"],
                created_at=data["createdAt"],
                duration=data.get("duration"),
                status=data.get("status", "Finalizado"),
                markdown_content=markdown_content,
            )
            save_transcription(transcription)
            count += 1
            print(f"  ✓ Migrated transcription: {data['fileName']}")
        except Exception as e:
            print(f"  ✗ Error migrating {meta_path}: {e}")

    # Migrate ATAs
    for meta_path in ata_dir.glob("*.json"):
        try:
            with meta_path.open("r", encoding="utf-8") as f:
                data = json.load(f)

            # Check if already exists
            if get_ata(data["id"]):
                continue

            # Read markdown content
            md_path = meta_path.with_suffix(".md")
            content = None
            if md_path.exists():
                with md_path.open("r", encoding="utf-8") as f:
                    content = f.read()

            ata = Ata(
                id=data["id"],
                title=data["title"],
                created_at=data["createdAt"],
                source_id=data["sourceId"],
                content=content,
            )
            save_ata(ata)
            count += 1
            print(f"  ✓ Migrated ATA: {data['title']}")
        except Exception as e:
            print(f"  ✗ Error migrating {meta_path}: {e}")

    return count
