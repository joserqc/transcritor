#!/usr/bin/env python3
"""Reparo de metadados das transcrições (datas e nomes de exibição).

Regras aplicadas a cada registro em data/transcriptions/*.json:

1. Data (createdAt):
   - Se o nome do arquivo embute o timestamp de gravação (padrão OBS
     "YYYY-MM-DD HH-MM-SS"), usa esse timestamp — a coluna "Data" deve
     refletir quando a reunião aconteceu, não quando foi transcrita.
   - Senão, se a data armazenada está no futuro, assume a transposição
     dia/mês conhecida (ex.: 2026-12-01 era 2026-01-12) e troca de volta,
     desde que o resultado fique no passado.

2. Nome (displayName):
   - Registros sem displayName cujo fileName é apenas um timestamp recebem
     um título gerado por LLM a partir do conteúdo da transcrição.
   - Duplicatas exatas de um arquivo já nomeado copiam o nome do irmão.

As mudanças são gravadas nos JSONs locais e espelhadas no Supabase
(created_at e metadata.displayName). Use --dry-run para pré-visualizar.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BASE_DIR))

from transcritor.titling import extract_recorded_at, generate_meeting_title  # noqa: E402

TRANSCRIPT_DIR = BASE_DIR / "data" / "transcriptions"
TZ_BR = timezone(timedelta(hours=-3))
TIMESTAMP_ONLY_RE = re.compile(r"^\d{4}-\d{2}-\d{2}[ _]\d{2}-\d{2}-\d{2}\.\w+$")


def parse_stored(raw: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(raw)
    except (TypeError, ValueError):
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ_BR)
    return dt


def fixed_created_at(meta: dict) -> str | None:
    """Return the corrected ISO createdAt, or None when no change is needed."""
    stored = parse_stored(meta.get("createdAt") or "")
    recorded = extract_recorded_at(meta.get("fileName") or "")
    if recorded:
        new = recorded.replace(tzinfo=TZ_BR)
        if stored is None or new != stored:
            return new.isoformat()
        return None
    if stored is None:
        return None
    now = datetime.now(TZ_BR)
    if stored <= now:
        return None
    try:
        swapped = stored.replace(month=stored.day, day=stored.month)
    except ValueError:
        return None
    if swapped <= now:
        return swapped.isoformat()
    return None


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="apenas mostra o que mudaria")
    args = parser.parse_args()

    metas: dict[str, dict] = {}
    for meta_path in sorted(TRANSCRIPT_DIR.glob("*.json")):
        with meta_path.open("r", encoding="utf-8") as handle:
            metas[meta_path.stem] = json.load(handle)

    # Nomes já definidos por arquivo, para copiar em duplicatas exatas.
    named_by_file: dict[str, str] = {}
    for meta in metas.values():
        if meta.get("displayName"):
            named_by_file.setdefault(meta["fileName"], meta["displayName"])

    changes: list[tuple[str, dict]] = []
    for tid, meta in metas.items():
        update: dict = {}

        new_created = fixed_created_at(meta)
        if new_created:
            update["createdAt"] = new_created

        if not meta.get("displayName") and TIMESTAMP_ONLY_RE.match(meta.get("fileName") or ""):
            sibling = named_by_file.get(meta["fileName"])
            if sibling:
                update["displayName"] = sibling
            elif args.dry_run:
                update["displayName"] = "<será gerado via LLM>"
            else:
                md_path = TRANSCRIPT_DIR / f"{tid}.md"
                content = md_path.read_text(encoding="utf-8") if md_path.exists() else ""
                title = generate_meeting_title(content, meta["fileName"])
                if title:
                    update["displayName"] = title

        if update:
            changes.append((tid, update))

    if not changes:
        print("Nada a corrigir.")
        return

    for tid, update in changes:
        meta = metas[tid]
        label = meta.get("displayName") or meta.get("fileName")
        print(f"- {tid[:8]} | {label}")
        if "createdAt" in update:
            print(f"    data: {meta.get('createdAt')} -> {update['createdAt']}")
        if "displayName" in update:
            print(f"    nome: {meta.get('displayName')} -> {update['displayName']}")

    if args.dry_run:
        print(f"\n[dry-run] {len(changes)} registro(s) seriam atualizados.")
        return

    from transcritor.database import _get_client

    sb = _get_client()
    for tid, update in changes:
        meta = metas[tid]
        meta.update(update)
        meta_path = TRANSCRIPT_DIR / f"{tid}.json"
        with meta_path.open("w", encoding="utf-8") as handle:
            json.dump(meta, handle, ensure_ascii=False, indent=2)

        payload: dict = {}
        if "createdAt" in update:
            payload["created_at"] = update["createdAt"]
        if "displayName" in update:
            row = sb.table("transcriptions").select("metadata").eq("id", tid).execute()
            existing = (row.data[0].get("metadata") if row.data else None) or {}
            payload["metadata"] = {**existing, "displayName": update["displayName"]}
        if payload:
            sb.table("transcriptions").update(payload).eq("id", tid).execute()

    print(f"\n{len(changes)} registro(s) atualizados (JSON local + Supabase).")


if __name__ == "__main__":
    main()
