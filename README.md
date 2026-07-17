# Uranai 占 — Chinese Divination Oracle

A password-protected fortune-telling web app with three methods: I Ching (易經),
Ba Zi (八字), and Zi Wei Dou Shu (紫微斗數).

Static frontend (`index.html`) + Vercel serverless functions (`api/`). All secrets —
passwords, AI provider keys, and system prompts — live server-side in environment
variables. The password check happens on the server, which issues an HMAC-signed
session token that `/api/reading` verifies on every request.

## Environment variables (required)

Set these in the Vercel dashboard (Project → Settings → Environment Variables)
or with `vercel env add`:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Admin password (unlimited readings) |
| `USER_PASSWORD` | User password (one free reading) |
| `SESSION_SECRET` | Random string used to sign session tokens — e.g. `openssl rand -hex 32` |
| `AI_PROVIDER` | `gemini` (default), `claude`, or `groq` |
| `GEMINI_API_KEY` | Required if provider is `gemini` |
| `ANTHROPIC_API_KEY` | Required if provider is `claude` |
| `GROQ_API_KEY` | Required if provider is `groq` |

Optional model overrides: `GEMINI_MODEL`, `CLAUDE_MODEL`, `GROQ_MODEL`.

## Deploy

```sh
npm i -g vercel
vercel          # preview deploy
vercel --prod   # production
```

Local development (the frontend needs the API routes, so open it via the dev
server, not as a file):

```sh
vercel dev
```

## Notes

- The one-free-reading limit is enforced server-side by reissuing the user's
  token as "used" after a successful reading. It is stateless (no database), so
  someone who saves their original token or clears localStorage and re-enters
  the user password can read again. Good enough for casual sharing; add a
  KV/Redis store if you need a hard limit.
- Wrong-password responses are uniform and compared in constant time.
