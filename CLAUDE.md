# Transcritor Local — Claude AI guide

> Project memory for Claude Code. See [`AGENTS.md`](AGENTS.md) for the short operational guide and [`README.md`](README.md) for end-user docs.

## Architecture in one glance

```
Frontend (React/Vite) ←→ FastAPI Backend ←→ Whisper (GPU) + Supabase
    :5174                      :8001          CUDA + PostgreSQL
```

**Stack:**
- Backend: Python 3.11+ | FastAPI | OpenAI Whisper | PyTorch CUDA
- Frontend: React 19 | TypeScript | Vite | shadcn/ui | Tailwind
- Database: Supabase (PostgreSQL cloud)
- Hardware: any NVIDIA GPU with CUDA, CPU fallback supported

## Code layout

```
transcritor/
├── transcritor/              # Backend Python package
│   ├── cli.py               # CLI entry point
│   ├── engine.py            # Whisper + pyannote (transcription core)
│   ├── server.py            # FastAPI REST + SSE
│   └── database.py          # Supabase CRUD
├── web/src/
│   ├── App.tsx              # SPA — all views in one file by design
│   ├── components/ui/       # shadcn/ui components
│   └── lib/utils.ts
├── supabase/
│   └── schema.sql           # Database schema
├── data/                    # Runtime data (gitignored)
│   ├── uploads/             # MP4s in flight; deleted after transcription
│   ├── transcriptions/      # legacy
│   └── atas/                # legacy
├── .env.example             # Template — copy to .env
├── start.sh / stop.sh       # Local launcher
└── transcritor.desktop.template
```

## Critical files

### `transcritor/engine.py`
Transcription engine.

Key functions:
- `detect_device()` — picks CUDA or CPU
- `load_whisper_model(model_name, device)` — loads the model once
- `transcribe_file(mp4_path, ...)` — full pipeline:
  1. Extract audio via ffmpeg (mono 16 kHz)
  2. Run Whisper with a progress-simulation thread
  3. Optional diarization (pyannote.audio)
  4. Emit timestamped Markdown

**Progress estimation:** Whisper doesn't expose real-time progress, so a separate thread estimates it from audio duration. GPU ≈ 0.1× realtime, CPU ≈ 0.8× realtime.

### `transcritor/server.py`
REST API + SSE streaming.

Endpoints summary in `AGENTS.md`. Concurrency:
- `transcribe_lock` — serializes GPU jobs (avoid VRAM OOM)
- `job_lock` — protects in-memory job state
- Daemon threads per job
- **Auto-cleanup:** uploaded MP4 is deleted after each job in the `finally` block

### `transcritor/database.py`
Supabase client + CRUD.

Tables: `transcriptions`, `atas`, `jobs` (schema in `supabase/schema.sql`).

Functions:
- `update_transcription(**updates)` — partial update with metadata merge
- `list_active_jobs()` — non-completed/failed jobs
- No fallback credentials — `.env` is the only source.

### `web/src/App.tsx`
Single-file SPA with five views: `transcribe`, `transcriptions`, `create-ata`, `atas`, `by-client`.

Notable patterns:
- Inline rename via pencil icon → `PATCH` API
- ATA streaming via `EventSource` (SSE) → progressive `ReactMarkdown`
- API base derives from `window.location.hostname:8001`

## Data flows

### Transcription
```
User uploads MP4
  → POST /api/transcriptions (multipart)
  → Backend writes data/uploads/{uuid}.mp4
  → Creates Job in Supabase (status: pending)
  → Daemon thread runs transcribe_file()
  → Frontend polls GET /api/transcriptions/{job_id} every 2s
  → Progress: 3% → 5-90% → 95% → 100%
  → Result saved to Supabase transcriptions
  → Job updated (status: completed, transcription_id)
  → finally: data/uploads/{uuid}.mp4 deleted
```

### Rename
```
PATCH /api/transcriptions/{id}/rename {"name": "new"}
  → Validates non-empty
  → Updates transcriptions.metadata.displayName
  → Returns {id, fileName, ok}
```

### ATA streaming
```
POST /api/atas/stream (SSE)
  → Backend fetches transcript Markdown
  → Truncates if > ATA_MAX_CHARS
  → POSTs to OpenRouter/OpenAI with stream=true
  → Yields SSE chunks: {"type": "chunk", "content": "..."}
  → Frontend appends to ReactMarkdown progressively
  → Final: saves to Supabase atas
  → Yields {"type": "done", "ataId": "..."}
```

## Required environment

See `.env.example`. Essentials:
- `SUPABASE_URL` + `SUPABASE_KEY` (anon JWT, not personal token)
- `OPENROUTER_API_KEY` or `OPENAI_API_KEY` (for ATA generation)
- `HF_TOKEN` (only if using diarization)
- `TRANSCRIBE_MODEL` (default: `medium`)

## How to run

### Recommended: launcher
```bash
./start.sh   # auto-detects directory, opens browser
./stop.sh
```

### Manual (dev mode)
```bash
# Terminal 1
source .venv/bin/activate
uvicorn transcritor.server:app --reload --host 127.0.0.1 --port 8001

# Terminal 2
cd web && npm run dev -- --host 127.0.0.1 --port 5174
```

### CLI only
```bash
python -m transcritor.cli path/to/video.mp4 --diarize
```

Logs:
- Backend: `/tmp/transcritor-backend.log`
- Frontend: `/tmp/transcritor-frontend.log`

## Debugging cheatsheet

```bash
# GPU
nvidia-smi
python -c "import torch; print(torch.cuda.is_available())"

# Ports
lsof -i :8001
lsof -i :5174

# Supabase round-trip
python -c "from transcritor.database import init_db; init_db()"

# Live logs
tail -f /tmp/transcritor-backend.log
```

## Common development contexts

### Adding a new API endpoint
1. Route in `server.py`
2. Pydantic request/response models
3. Use `transcribe_lock` or DB calls as appropriate
4. Add `fetch` call in `App.tsx`

### Modifying UI
1. Components in `web/src/components/ui/`
2. New shadcn component: `npx shadcn@latest add <name>`
3. Tailwind for styling

### New column in a table
1. Migrate the Supabase schema (and update `supabase/schema.sql`)
2. Update dataclass in `database.py`
3. Adjust save/update functions
4. Update frontend types

### Debugging the progress bar
- Logs: `/tmp/transcritor-backend.log`
- Look for the `progress_updater` thread in `engine.py`
- Threshold labels are in `App.tsx`

## Performance & limits

### VRAM by Whisper model (12 GB-class GPU)
| Model | VRAM | 10 min audio on GPU |
|-------|------|---------------------|
| tiny | ~1 GB | ~30 s |
| small | ~2 GB | ~1 min |
| **medium** | **~5 GB** | **~2 min** (default) |
| large-v3 | ~10 GB | ~4 min |
| distil-large-v3 | ~6 GB | ~2 min |

### Supabase free tier
- 500 MB storage, 2 GB egress/month
- Roughly 10k transcripts (~50 KB Markdown + ~2 KB metadata each)

## Known issues

### GPU not detected
```bash
pip uninstall torch torchvision torchaudio
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

### `faster-whisper` and newer NVIDIA arches
- CTranslate2 historically lacked sm_120 (Blackwell) support
- Active code uses `openai-whisper` for this reason
- See `AGENTS.md` guardrails before reintroducing it

### Supabase "permission denied"
- Run `supabase/schema.sql` (includes `GRANT ALL` + `DISABLE RLS`)
- Confirm you're using the **anon** key, not a personal access token

## Conventions

- Python: PEP 8, type hints, docstrings on public functions
- TypeScript: function components, hooks, `async/await`
- Commits: conventional (`feat:`, `fix:`, `refactor:`)
- Naming: `snake_case` in Python and DB; `camelCase` in TS/React

## Patterns

- Backend: threaded workers + locks for GPU serialization
- Frontend: single-file SPA, state lifting, controlled components
- Database: thin repository pattern via `database.py`
- API: REST + SSE for streaming (no WebSockets)

## Where to look

- Transcription dispatch: `transcritor/server.py` (search for the upload route)
- Progress updates: `progress_updater` thread in `transcritor/engine.py`
- Rename handler: `PATCH /api/transcriptions/{id}/rename` in `server.py`
- ATA streaming: `POST /api/atas/stream` in `server.py`
- Table component: `<Table>` references in `web/src/App.tsx`

## Notes for Claude

1. **Read whole files before editing.** Use `path:line` references when citing code.
2. **Threading:** transcription is thread-unsafe; always hold `transcribe_lock`. Job dict needs `job_lock`.
3. **Database:** metadata updates auto-merge; anon role has `GRANT ALL` (RLS disabled).
4. **Frontend:** `App.tsx` is single-file by design. Don't split unless asked.
5. **GPU:** prefer `openai-whisper` for newer NVIDIA arches; don't suggest `faster-whisper` as default without checking CUDA arch support.
