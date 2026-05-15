# Transcritor Local

Local-first GPU transcription pipeline for meeting recordings. Drop an MP4 in, get a timestamped Markdown transcript out — optionally with speaker diarization and an AI-generated meeting summary (ATA) on top.

Built for people who record on OBS and want their transcripts to stay on their own machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Features

- **GPU-first transcription** via OpenAI Whisper (CUDA), CPU fallback
- **Speaker diarization** via pyannote.audio (optional)
- **Web UI** for upload, progress, transcript browsing, ATA generation
- **ATA generation** with streaming via OpenRouter or OpenAI
- **Cloud persistence** via Supabase (free tier is enough)
- **CLI** for batch processing without the UI
- **Desktop launcher** template for Linux (GNOME `.desktop` entry)

## Architecture

```
┌─────────────┐  HTTP+SSE  ┌──────────────┐   CUDA   ┌──────────┐
│ React/Vite  │ ─────────► │   FastAPI    │ ───────► │ Whisper  │
│  :5174      │            │   :8001      │          │ pyannote │
└─────────────┘            └──────┬───────┘          └──────────┘
                                  │
                          ┌───────▼────────┐
                          │   Supabase     │
                          │  (PostgreSQL)  │
                          └────────────────┘
```

Three tables in Supabase: `transcriptions`, `atas`, `jobs`. Audio files are processed locally and the originals are deleted after transcription — only the Markdown lives in the DB.

## Requirements

- Linux (tested on Ubuntu 22.04+); should work on macOS and WSL with minor tweaks
- Python 3.11+
- Node.js 18+
- `ffmpeg` and `ffprobe` in `PATH`
- NVIDIA GPU with CUDA (optional; falls back to CPU)
- A free Supabase project
- An OpenRouter or OpenAI key (for ATA generation only — transcription works offline)

## Quick start

```bash
git clone https://github.com/<your-fork>/transcritor.git
cd transcritor

python3 -m venv .venv
source .venv/bin/activate

# Install PyTorch with CUDA *first*, picking the wheel for your CUDA version.
# Example for CUDA 12.8:
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128

# Then the rest
pip install -r requirements.txt
(cd web && npm install)

# Verify GPU is visible to PyTorch
python -c "import torch; print('CUDA:', torch.cuda.is_available())"
```

### Configure environment

```bash
cp .env.example .env
$EDITOR .env
```

Required keys: `SUPABASE_URL`, `SUPABASE_KEY`. Everything else is optional or has a default.

### Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open the SQL Editor and paste the contents of [`supabase/schema.sql`](supabase/schema.sql).
3. Copy your project URL and **anon** key into `.env`.

### Run

```bash
./start.sh
```

Opens `http://127.0.0.1:5174`. Stop with `./stop.sh`.

To start manually for development:

```bash
# Terminal 1
source .venv/bin/activate
uvicorn transcritor.server:app --reload --host 127.0.0.1 --port 8001

# Terminal 2
cd web && npm run dev -- --host 127.0.0.1 --port 5174
```

### Desktop launcher (Linux)

```bash
sed "s|__INSTALL_DIR__|$PWD|g" transcritor.desktop.template > ~/.local/share/applications/transcritor.desktop
update-desktop-database ~/.local/share/applications/
```

## CLI

```bash
# Single file, defaults to large-v3
python -m transcritor.cli path/to/video.mp4

# With diarization
python -m transcritor.cli path/to/video.mp4 --diarize

# Lighter / faster
python -m transcritor.cli path/to/video.mp4 --model medium

# Pick a specific GPU
python -m transcritor.cli path/to/video.mp4 --device cuda --device-index 1

# Output directory
python -m transcritor.cli path/to/video.mp4 --out-dir ./transcripts
```

All flags: `python -m transcritor.cli --help`.

## Configuration reference

See [`.env.example`](.env.example) for the full list.

### Whisper model presets

| Model | VRAM | Speed (10 min audio, RTX-class GPU) | Notes |
|-------|------|-------------------------------------|-------|
| `tiny` | ~1 GB | ~30 s | Drafts only |
| `small` | ~2 GB | ~1 min | Decent for clear audio |
| `medium` | ~5 GB | ~2 min | **Default — best tradeoff** |
| `large-v3` | ~10 GB | ~4 min | Highest accuracy |
| `distil-large-v3` | ~6 GB | ~2 min | Near-large quality, faster |

### Diarization

Diarization is opt-in. To enable it:

1. Create a Hugging Face token at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens).
2. Accept the terms for `pyannote/speaker-diarization-3.1`.
3. Set `HF_TOKEN` in `.env`.
4. Pass `--diarize` to the CLI, or toggle it in the web UI.

## API

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/api/transcriptions` | Upload MP4, returns `job_id` |
| `GET` | `/api/transcriptions` | List transcriptions |
| `GET` | `/api/transcriptions/{id}` | Job/transcription status |
| `GET` | `/api/transcriptions/{id}/markdown` | Download Markdown |
| `PATCH` | `/api/transcriptions/{id}/rename` | Rename |
| `PATCH` | `/api/transcriptions/{id}/client` | Tag client |
| `DELETE` | `/api/transcriptions/{id}` | Delete |
| `POST` | `/api/atas/stream` | Generate ATA (SSE stream) |
| `GET` | `/api/atas` | List ATAs |
| `GET` | `/api/atas/{id}/markdown` | Download ATA |
| `PATCH` | `/api/atas/{id}/client` | Tag client |
| `DELETE` | `/api/atas/{id}` | Delete |
| `GET` | `/api/clients` | List unique client tags |
| `GET` | `/api/by-client/transcriptions` | Filter by client |
| `GET` | `/api/by-client/atas` | Filter by client |
| `POST` | `/api/shutdown` | Stop services (calls `stop.sh`) |

## Project layout

```
transcritor/
├── transcritor/          # Python package
│   ├── cli.py            # CLI entry point
│   ├── engine.py         # Whisper + pyannote pipeline
│   ├── server.py         # FastAPI app
│   └── database.py       # Supabase CRUD
├── web/                  # React/Vite SPA
│   └── src/App.tsx       # Single-file UI
├── supabase/
│   └── schema.sql        # Database schema
├── start.sh / stop.sh    # Local launcher
├── transcritor.desktop.template
├── .env.example
└── requirements.txt
```

## Troubleshooting

**`CUDA: False`** — PyTorch was installed without CUDA wheels. Reinstall:
```bash
pip uninstall -y torch torchvision torchaudio
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128
```

**Supabase permission denied** — confirm you ran `supabase/schema.sql` and the `GRANT` statements at the bottom executed without error. Also confirm you're using the **anon** key, not a personal access token.

**Browser doesn't open after `start.sh`** — make sure `xdg-open` is installed (`sudo apt install xdg-utils`) and you're in a desktop session.

**`pyannote` model download fails** — your `HF_TOKEN` is missing or you haven't accepted the model terms. Visit the model page on Hugging Face and click "Agree".

## Performance notes

- Whisper itself doesn't emit real-time progress; the progress bar uses an estimator based on audio duration and detected device.
- The backend serializes transcription jobs (`transcribe_lock`) to avoid VRAM contention. One job at a time.
- Uploaded MP4s are deleted from `data/uploads/` after transcription completes (success or failure).

## Why not faster-whisper?

This project originally used `faster-whisper`, but its CTranslate2 backend didn't support newer GPU architectures (e.g. Blackwell `sm_120`) at the time of the rewrite. The code now uses `openai-whisper` directly. Re-introducing `faster-whisper` is welcome if it covers your target hardware — see [`AGENTS.md`](AGENTS.md) for architectural guardrails.

## Documentation

- [`docs/USAGE.md`](docs/USAGE.md) — full usage walkthrough (UI tour, CLI cookbook, ATA prompt patterns)
- [`AGENTS.md`](AGENTS.md) — operational guide for contributors / coding agents
- [`CLAUDE.md`](CLAUDE.md) — Claude AI guide / deeper code map
- [`SECURITY.md`](SECURITY.md) — vulnerability reporting and deployment caveats
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — PR guidelines

## Contributing

PRs welcome. Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first. For security issues, see [`SECURITY.md`](SECURITY.md).

## License

[MIT](LICENSE)
