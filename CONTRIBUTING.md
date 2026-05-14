# Contributing to Transcritor Local

Thanks for considering a contribution! This is a small, focused project — keep PRs scoped and pragmatic.

## Before opening a PR

1. **Open an issue first** for anything bigger than a typo or one-line bug fix. Saves both sides time if the direction is wrong.
2. **No secrets in commits.** Use `.env` (gitignored) and document new variables in `.env.example`.
3. **Test the path you changed.** The web UI and the CLI share the engine — if you touched `engine.py`, exercise both.

## Dev setup

```bash
git clone https://github.com/<your-fork>/transcritor.git
cd transcritor
python3 -m venv .venv
source .venv/bin/activate
pip install torch torchvision torchaudio --index-url https://download.pytorch.org/whl/cu128  # adjust for your CUDA
pip install -r requirements.txt
(cd web && npm install)
cp .env.example .env  # fill in your own creds
```

Run schema setup on a fresh Supabase project: paste `supabase/schema.sql` in the SQL editor.

## Style

- **Python:** PEP 8, type hints on public functions. No global state outside the existing locks/clients.
- **TypeScript:** keep the SPA single-file (`web/src/App.tsx`) unless a split is genuinely earning its keep.
- **Commits:** conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`). Imperative mood.
- **Don't add comments that restate the code.** Add one only when the *why* is non-obvious.

## What to avoid

- Reintroducing `faster-whisper` as the default without verifying it works on modern NVIDIA arches (Blackwell `sm_120` historically broke).
- Backwards-compat shims, dead `// removed` comments, or "just in case" error handlers.
- Hardcoding model IDs, paths, ports, or credentials. All of these belong in env vars or `.env.example`.
- Adding a router/state library to the frontend without a clear reason.

## Architecture invariants

See [`AGENTS.md`](AGENTS.md) for the operational truths the codebase relies on. Don't break them silently.

## Reporting bugs

Include:
- OS + GPU model (if relevant)
- `python --version`, `node --version`
- `torch.__version__` and `torch.cuda.is_available()`
- Steps to reproduce
- Relevant lines from `/tmp/transcritor-backend.log`

## Security

For security-sensitive reports (vulnerability, credential exposure, etc.) **do not open a public issue.** See [`SECURITY.md`](SECURITY.md).
