# Copilot Instructions — Transcritor Local

## Stack

- Backend: FastAPI + threads in `transcritor/server.py`
- Transcription: `openai-whisper` in `transcritor/engine.py`
- Diarization: `pyannote.audio` (opt-in via `HF_TOKEN`)
- Frontend: Vite + React 19 SPA in `web/src/App.tsx`
- Persistence: Supabase (`transcriptions`, `jobs`, `atas`)

## Architecture rules

- The active transcription path uses `whisper.load_model(...)`. Don't treat `faster-whisper` as the primary engine.
- `server.py` is the source of truth for endpoints and job flow.
- `App.tsx` is the entire UI. There is no router.
- The UI computes `API_BASE` as `window.location.hostname:8001`.
- CORS currently allows `localhost` / `127.0.0.1` on ports `5173` and `5174`.
- Startup runs `init_db()`. No automatic file-to-DB migration.

## Run

```bash
# backend
source .venv/bin/activate
uvicorn transcritor.server:app --reload --host 127.0.0.1 --port 8001

# frontend
cd web && npm run dev -- --host 127.0.0.1 --port 5174
```

## CLI

```bash
python -m transcritor.cli video.mp4 --diarize
python -m transcritor.cli video.mp4 --model large-v3 --merge-gap 0.7
```

Notes:
- CLI defaults to `large-v3`
- The web server defaults to `TRANSCRIBE_MODEL=medium`
- `--compute-type` is kept for compatibility; the `openai-whisper` path doesn't really exercise it

## Environment

Use `.env` as the source of truth. See `.env.example` for the full list. Required:

- `SUPABASE_URL`
- `SUPABASE_KEY`
- `HF_TOKEN` (only for diarization)
- `OPENROUTER_API_KEY` / `OPENROUTER_MODEL`
- `OPENAI_API_KEY` / `OPENAI_MODEL`
- `ATA_PROVIDER`, `ATA_MAX_CHARS`
- `TRANSCRIBE_MODEL`, `TRANSCRIBE_DEVICE`, `TRANSCRIBE_DEVICE_INDEX`

Never reintroduce hardcoded credentials in `database.py` or anywhere else.

## Important endpoints

- `POST /api/transcriptions` / `GET /api/transcriptions/{id}` / `GET /api/transcriptions/{id}/markdown`
- `PATCH /api/transcriptions/{id}/rename`
- `PATCH /api/transcriptions/{id}/client`
- `POST /api/atas/stream`
- `GET /api/atas` / `GET /api/atas/{id}/markdown`
- `PATCH /api/atas/{id}/client`
- `GET /api/clients`
- `GET /api/by-client/transcriptions`
- `GET /api/by-client/atas`
- `POST /api/shutdown`

## Output and UX

- Final Markdown: `[HH:MM:SS] Participante N: text`
- `engine.py` merges same-speaker segments by configurable gap
- Frontend views: `transcribe`, `transcriptions`, `create-ata`, `atas`, `by-client`
