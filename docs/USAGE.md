# Usage Guide

End-to-end walkthrough of the Transcritor Local pipeline: record → transcribe → generate ATA → organize.

> If you haven't set up the project yet, read [`../README.md`](../README.md) first.

## Table of contents

1. [The workflow](#the-workflow)
2. [Web UI tour](#web-ui-tour)
3. [CLI cookbook](#cli-cookbook)
4. [Generating ATAs (meeting summaries)](#generating-atas-meeting-summaries)
5. [Working with clients/tags](#working-with-clientstags)
6. [Recording with OBS](#recording-with-obs)
7. [Tips & tricks](#tips--tricks)
8. [FAQ](#faq)

---

## The workflow

```
┌──────────┐    ┌────────────┐    ┌──────────┐    ┌────────────┐
│   OBS    │ ─► │ Transcribe │ ─► │ Edit /   │ ─► │ Generate   │
│ recording│    │ (Whisper)  │    │ rename   │    │ ATA (LLM)  │
└──────────┘    └────────────┘    └──────────┘    └────────────┘
                       │
                       ▼
              Optional diarization
              (pyannote — who said what)
```

Everything except the LLM step happens on your machine. The original MP4 is deleted from the server right after transcription completes — only the Markdown text persists in Supabase.

---

## Web UI tour

Open `http://127.0.0.1:5174` after running `./start.sh`. The sidebar has five views.

### 1. Transcrever Vídeo

The upload screen.

| Field | What it does |
|-------|--------------|
| File picker | Accepts MP4. Drag and drop also works. |
| **Diarização** toggle | When on, runs pyannote after Whisper to label speakers (`Participante 1`, `Participante 2`, ...). Requires `HF_TOKEN`. |
| Iniciar | Starts the job. |

While the job runs you'll see:
- A progress bar (estimated — Whisper itself doesn't emit progress)
- A label showing the phase: `Extraindo áudio` → `Transcrevendo com GPU` → `Processando segmentos` → `Gerando Markdown`

When it finishes you get a "Baixar Markdown" button.

**One job at a time.** The backend serializes transcription to keep VRAM usage bounded. Queue is implicit — if you submit a second job while one runs, the second waits.

### 2. Visualizar Transcrições

The list of everything you've transcribed.

| Action | How |
|--------|-----|
| View Markdown | Click the row — opens a dialog with the full transcript |
| Rename | Click the pencil icon next to the name, type new name, press Enter |
| Tag with a client | Click the tag icon, type a client name |
| Download | "Baixar" button on each row |
| Delete | Trash icon (with confirmation) |

Renaming only changes the display name (the original filename is preserved in metadata).

### 3. Criar ATA

Generate an AI-written meeting summary ("ATA" in Portuguese — *Ata de Reunião*).

| Field | What it does |
|-------|--------------|
| Transcrição base | Pick which transcript to summarize |
| Provider | `openrouter` or `openai` (both need an API key in `.env`) |
| Modelo | Specific model ID (defaults to `claude-3.5-sonnet` for OpenRouter, `gpt-4o-mini` for OpenAI) |
| Prompt | Free text instructions for the LLM — what to focus on, audience, format |

When you click "Gerar ATA", the response streams in via SSE. You'll see the Markdown appear live as the model writes it. When it's done, a "Salvo" badge appears and you can download it from view 4.

The system prompt enforces sections: Objetivo, Participantes, Principais pontos, Decisões, Pendências, Próximos passos. Your prompt customizes the rest.

### 4. Visualizar ATAS

Same shape as Transcrições. List, view, tag with client, delete.

Each ATA stores its source transcription ID, the prompt used, the provider, and the model — so you can audit later.

### 5. Por Cliente

Organize by client tag.

- Select a client from the dropdown (or "(sem cliente)" for untagged items)
- See all transcriptions and ATAs for that client side by side
- Useful for billing, project review, or recap

Tags are free text. The dropdown is built dynamically from whatever tags you've used.

---

## CLI cookbook

For batch processing or when you don't need the UI.

```bash
source .venv/bin/activate
```

### Single file with defaults

```bash
python -m transcritor.cli path/to/video.mp4
```

Defaults: `large-v3` model, auto device, diarization off, output to `data/transcriptions/`.

### With speaker diarization

```bash
python -m transcritor.cli video.mp4 --diarize
```

Requires `HF_TOKEN` in `.env` and accepting the pyannote model terms on Hugging Face.

### Lighter / faster

```bash
python -m transcritor.cli video.mp4 --model medium
python -m transcritor.cli video.mp4 --model small
python -m transcritor.cli video.mp4 --model distil-large-v3
```

### Pick a specific GPU

```bash
python -m transcritor.cli video.mp4 --device cuda --device-index 1
```

### Force CPU

```bash
python -m transcritor.cli video.mp4 --device cpu
```

Useful when sharing the GPU with another task. Expect ~8× slower than GPU.

### Custom output location

```bash
python -m transcritor.cli video.mp4 --out-dir ./transcripts
python -m transcritor.cli video.mp4 --output ./transcripts/meeting.md
```

### Multiple files

```bash
python -m transcritor.cli a.mp4 b.mp4 c.mp4 --diarize
```

Runs sequentially.

### Tighter speaker merging

By default, adjacent segments from the same speaker get merged if the gap is small. Tune with `--merge-gap` (seconds):

```bash
python -m transcritor.cli video.mp4 --diarize --merge-gap 0.7   # default
python -m transcritor.cli video.mp4 --diarize --merge-gap 1.5   # more aggressive merging
python -m transcritor.cli video.mp4 --diarize --no-merge        # disable
```

### Keep the intermediate WAV

```bash
python -m transcritor.cli video.mp4 --keep-wav
```

Useful for debugging audio extraction.

### All flags

```bash
python -m transcritor.cli --help
```

---

## Generating ATAs (meeting summaries)

Tips for getting good output:

### Prompt patterns

**Simple recap:**
```
Crie uma ATA objetiva com decisões, pendências e próximos passos.
```

**Sales-focused:**
```
Esta é uma reunião comercial com {Cliente}. Foque em:
- Objeções levantadas
- Necessidades específicas mencionadas
- Próximos passos acordados
- Valor ou ticket discutido (se houver)
- Prazos
Indique claramente o que ainda precisa ser confirmado.
```

**Technical / engineering:**
```
Transcrição de uma reunião técnica. Extraia:
- Decisões de arquitetura
- Trade-offs discutidos
- Action items por responsável
- Riscos identificados
- Próxima sync sugerida
Linguagem objetiva, sem repetir o que ficou em aberto sem decisão.
```

**Coaching / 1:1:**
```
Reunião 1:1 entre gestor e colaborador. Resuma:
- Pontos altos e desafios da semana
- Pedidos de feedback
- Bloqueios reportados
- Compromissos para a próxima semana
Tom respeitoso, sem julgamentos.
```

### Choosing a model

| Provider | Model | When to use |
|----------|-------|-------------|
| OpenRouter | `anthropic/claude-3.5-sonnet` | Best default for nuanced Portuguese summaries |
| OpenRouter | `anthropic/claude-3-opus` | Higher quality, slower, more expensive |
| OpenRouter | `openai/gpt-4o` | Comparable to Claude 3.5, faster |
| OpenRouter | `openai/gpt-4o-mini` | Cheap and fast for low-stakes recaps |
| OpenAI | `gpt-4o-mini` | Direct from OpenAI, no router fee |

### Truncation

The transcript is truncated to `ATA_MAX_CHARS` (default 20000) before being sent to the LLM. Long meetings get clipped. Raise `ATA_MAX_CHARS` in `.env` if you need more, but watch your provider's context window and pricing.

---

## Working with clients/tags

The `client` field is a free-text tag on both transcriptions and ATAs.

- **Setting:** click the tag icon in the row → type → press Enter
- **Filtering:** use the "Por Cliente" view
- **Listing all clients:** the dropdown auto-populates from existing tags
- **Untagging:** click the icon → clear the input → press Enter

Tags are case-sensitive — "Acme" and "acme" are different clients. Pick a convention and stick with it.

There's no notion of "projects within a client" — if you need that, prefix your tags (`acme/onboarding`, `acme/billing`).

---

## Recording with OBS

A typical setup that works well with Transcritor:

### Output settings
- **Format:** MP4
- **Encoder:** any (NVENC if you have it)
- **Video bitrate:** doesn't really matter for transcription — audio is what we use
- **Resolution:** anything (we don't process video)

### Audio settings
- **Sample rate:** 48 kHz (Transcritor downsamples to 16 kHz mono anyway)
- **Audio bitrate:** 192 kbps or higher
- **Channels:** stereo (gets folded to mono)

### Sources for meeting recordings
- **Desktop audio** captures the other participants
- **Microphone** captures you
- For diarization to work well, both sources should be clearly audible

### Tips
- Use **separate audio tracks** in OBS if you might want to remix later (Settings → Audio → Audio Monitoring)
- For online meetings, record the meeting client's audio output as desktop audio
- If your audio is muffled or noisy, transcription quality drops sharply — invest in a decent mic before tuning model parameters

---

## Tips & tricks

### Speed up a long transcription

- Use `distil-large-v3` instead of `large-v3` (similar quality, ~2× faster)
- Disable diarization if you don't need speaker labels (it adds 20-40%)
- Make sure your GPU isn't being shared with another workload

### Better speaker labels

- Diarization needs clean audio separation. If you can record participants on separate tracks and merge later, results improve substantially.
- Adjusting `--merge-gap` smooths over short pauses where the diarizer flickered.
- Diarization is statistical — it can swap speaker labels mid-meeting if voices are similar.

### Better ATA quality

- Always provide context in the prompt (who, what, the goal of the meeting)
- Specify the audience: "para a equipe técnica", "para o cliente", "para registro interno"
- If the LLM hallucinates names or facts, lower `ATA_MAX_CHARS` so it focuses on a smaller, cleaner chunk
- Try the same transcript with two models and pick the better output — both are saved

### Move between machines

The transcripts and ATAs are stored in Supabase, not locally. Same `.env` on two machines = same data visible on both.

The audio files live in `data/uploads/` only while a job is running. They're deleted after. Nothing to migrate.

### Export everything

There's no one-click "export all" yet. Options:

```bash
# Backend exposes raw markdown
curl http://127.0.0.1:8001/api/transcriptions/{id}/markdown > transcript.md
curl http://127.0.0.1:8001/api/atas/{id}/markdown > ata.md
```

Or query Supabase directly (e.g. via Supabase's CSV export in the dashboard).

### Stop the server from the UI

The web UI has a "Encerrar" button (top right of the header). It calls `POST /api/shutdown`, which invokes `stop.sh`. Useful if you started via the desktop launcher and don't want to open a terminal.

---

## FAQ

**Q: Can I use it without a GPU?**
Yes. Set `TRANSCRIBE_DEVICE=cpu` (or just leave it on `auto` and don't have CUDA). Expect ~8× slower transcription.

**Q: Can I run it without Supabase?**
Not currently. The persistence layer assumes Supabase. A SQLite/Postgres-local backend would be a welcome PR.

**Q: What languages does it support?**
Whisper supports ~100 languages. Set `TRANSCRIBE_LANGUAGE` to the ISO 639-1 code (e.g. `en`, `es`, `pt`) or leave it blank for auto-detect. The ATA generation prompts default to Portuguese — for other languages, write your prompts in the target language.

**Q: Can I expose this on the internet?**
Technically yes (change the CORS list in `server.py` and front it with a reverse proxy with auth), but **read `SECURITY.md` first**. RLS is disabled on the Supabase tables by default — that's fine for single-user local but unsafe for multi-tenant.

**Q: Does it handle long meetings (3+ hours)?**
Yes, but:
- Whisper itself processes the audio in chunks, so memory is bounded
- The Markdown can get large — Supabase rows have a TOAST limit but you'd need to hit several MB to bump into it
- ATA generation truncates to `ATA_MAX_CHARS` — you may want to chunk the transcript yourself and generate multiple ATAs

**Q: Can I edit the transcript after the fact?**
Not from the UI yet. You can:
- Update Supabase directly (the `markdown_content` column on `transcriptions`)
- Download, edit, then re-upload via `update_transcription` in the API

**Q: Where do uploads go?**
`data/uploads/{uuid}.mp4` while in flight, then deleted. They never leave your machine.
