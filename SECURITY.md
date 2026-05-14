# Security policy

## Reporting a vulnerability

If you find a security issue — credential exposure, RCE, SSRF, an injection in the SSE/streaming path, anything that could harm users — **do not open a public GitHub issue.**

Instead, open a [private security advisory](https://github.com/joserqc/transcritor-cuda/security/advisories/new) on this repository, or contact the maintainer directly via GitHub.

Please include:
- A description of the issue and its impact
- Steps to reproduce
- Affected versions / commit SHAs if known
- Any proof-of-concept

We aim to acknowledge within 72 hours and to publish a fix or mitigation within 30 days for confirmed issues.

## Scope

In scope:
- The Python backend (`transcritor/`)
- The web frontend (`web/`)
- The Supabase schema in `supabase/schema.sql`
- The launcher scripts (`start.sh`, `stop.sh`)

Out of scope:
- Vulnerabilities in upstream dependencies (report to them directly; we'll bump versions once a fix is published)
- Configuration mistakes in your own deployment (e.g., exposing the backend to the public internet without auth)
- Issues that require physical access to the host

## Notes on deployment

This project is designed for **single-user local deployment**. The Supabase schema runs with RLS disabled and the anon role granted full table access. If you intend to expose the API to multiple users or to the public internet:

1. Enable RLS and write proper policies.
2. Add authentication in front of the FastAPI app (reverse proxy with auth, or app-level middleware).
3. Restrict CORS in `server.py` to your actual frontend origin.
4. Consider rotating your Supabase anon key periodically.
