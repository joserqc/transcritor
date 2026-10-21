# Security policy

## Reporting a vulnerability

If you find a security issue — credential exposure, RCE, SSRF, an injection in the SSE/streaming path, anything that could harm users — **do not open a public GitHub issue.**

Instead, open a [private security advisory](https://github.com/joserqc/transcritor/security/advisories/new) on this repository, or contact the maintainer directly via GitHub.

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

O projeto foi desenvolvido para **uso local por uma pessoa**. O instalador
Supabase habilita RLS e concede somente leitura e escrita de registros a
`service_role`. `anon` e `authenticated` não recebem acesso às tabelas. A chave
secreta ou a chave legada `service_role` fica exclusivamente no backend.

`service_role` ignora RLS. Por isso, habilitar RLS não torna a API local adequada
automaticamente para múltiplos usuários ou para exposição à internet. Para esse uso:

1. Adicione autenticação e autorização por usuário ao FastAPI ou ao proxy.
2. Defina isolamento dos dados e políticas coerentes com o papel usado em cada requisição.
3. Restrinja CORS em `server.py` à origem real do frontend.
4. Proteja a credencial do backend e faça sua rotação em caso de exposição.

## Local CSRF caveat

Even bound to `127.0.0.1`, the FastAPI server is reachable from any web page open in your browser. CORS prevents another origin from *reading* responses, but it does **not** block side-effecting "simple" requests (multipart `POST`, header-less `POST`, `GET`). Without mitigation, a malicious page you visit could in principle:

- call `POST /api/shutdown` and stop the server;
- call `POST /api/transcriptions` and upload arbitrary bytes to your machine;
- trigger other state-changing endpoints.

Mitigations in place:

- Every mutating endpoint (`POST` / `PATCH` / `DELETE`) requires the custom `X-Transcritor-Client` header. Cross-origin, that header forces a CORS preflight, so the "simple request" attacks above are rejected with `403`.
- Stop the server with `./stop.sh` when you are not using it.
- Run the server only inside a profile/browser session that does not browse the open web.
