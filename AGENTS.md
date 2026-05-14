# AGENTS.md — Transcritor Local

Short operational guide for coding agents working in this repo.

## Snapshot

- Backend: FastAPI in `transcritor/server.py`
- Transcription engine: `openai-whisper` in `transcritor/engine.py`
- Frontend: Vite + React 19 in `web/`
- Persistence: Supabase tables `transcriptions`, `jobs`, `atas`
- Backend port: `8001`
- Frontend port (launcher default): `5174`
- CORS allows `5173` and `5174`

## Ground truths

- The active transcription path uses `whisper.load_model(...)`. **Do not** reintroduce `faster-whisper` / `ctranslate2` as the main path without confirming GPU compatibility (older versions broke on Blackwell `sm_120`).
- `TRANSCRIBE_COMPUTE_TYPE` and `--compute-type` exist for compat; the current `openai-whisper` path doesn't really use them.
- `database.py` requires `SUPABASE_URL` / `SUPABASE_KEY` from `.env` — no hardcoded fallbacks. Treat `.env` as the only source.
- Startup runs `init_db()` only. There is no automatic file → DB migration.

## Common commands

### Backend

```bash
source .venv/bin/activate
uvicorn transcritor.server:app --reload --host 127.0.0.1 --port 8001
```

### Frontend

```bash
cd web
npm run dev -- --host 127.0.0.1 --port 5174
npm run build
npm run lint
```

### Local launcher

```bash
./start.sh    # auto-detects project dir; logs to /tmp by default
./stop.sh
```

`start.sh` honors `TRANSCRITOR_BACKEND_PORT`, `TRANSCRITOR_FRONTEND_PORT`, `TRANSCRITOR_BACKEND_LOG`, `TRANSCRITOR_FRONTEND_LOG`.

### CLI

```bash
source .venv/bin/activate
python -m transcritor.cli video.mp4 --diarize
python -m transcritor.cli video.mp4 --model large-v3 --out-dir data/transcriptions
```

## CLI behavior

- CLI default: `--model large-v3`
- Web server default: `TRANSCRIBE_MODEL=medium`
- Flags: `--output`, `--out-dir`, `--device`, `--device-index`, `--merge-gap`, `--no-merge`, `--keep-wav`
- Accepts multiple input paths

## Environment variables

See `.env.example` for the full list. Required: `SUPABASE_URL`, `SUPABASE_KEY`. Required for ATA generation: at least one of `OPENROUTER_API_KEY` / `OPENAI_API_KEY`. Required for diarization: `HF_TOKEN`.

## Sources of truth

- `transcritor/engine.py` — audio extraction, Whisper, diarization, speaker merge, Markdown output
- `transcritor/server.py` — REST/SSE contracts and job lifecycle
- `transcritor/database.py` — CRUD for `transcriptions`, `jobs`, `atas`
- `transcritor/cli.py` — batch / terminal interface
- `web/src/App.tsx` — entire SPA (no router)

## Request flow

1. MP4 upload to `POST /api/transcriptions`
2. Backend creates job, dispatches daemon thread
3. `engine.py` extracts WAV via ffmpeg, transcribes, optionally diarizes, merges segments by speaker/gap
4. Final Markdown: `[HH:MM:SS] Participante N: text`
5. Original upload is deleted on completion (success or failure)
6. Frontend polls job state and renders transcript / ATA on demand

## Active endpoints

### Transcriptions
- `POST /api/transcriptions`
- `GET /api/transcriptions`
- `GET /api/transcriptions/{id}`
- `GET /api/transcriptions/{id}/markdown`
- `DELETE /api/transcriptions/{id}`
- `PATCH /api/transcriptions/{id}/rename`
- `PATCH /api/transcriptions/{id}/client`

### ATAs
- `POST /api/atas`
- `POST /api/atas/stream`
- `GET /api/atas`
- `GET /api/atas/{id}/markdown`
- `DELETE /api/atas/{id}`
- `PATCH /api/atas/{id}/client`

### Client filtering and utilities
- `GET /api/clients`
- `GET /api/by-client/transcriptions`
- `GET /api/by-client/atas`
- `POST /api/shutdown`

## Frontend

`web/src/App.tsx` is a single-file SPA with five views:

- `transcribe`
- `transcriptions`
- `create-ata`
- `atas`
- `by-client`

The API base URL is `window.location.hostname:8001` — meaning if you access the UI from another LAN host, CORS will block it. Adjust `server.py` CORS list if you need that.

## Guardrails

- Don't reintroduce `faster-whisper` as the default for modern NVIDIA GPUs without verifying CUDA arch support.
- Preserve CORS entries for `5173` and `5174` when editing the backend.
- When touching transcription, verify the change works in **both** the CLI and the web API.
- Never commit `.env` or anything in `data/`. The `.gitignore` covers both.
