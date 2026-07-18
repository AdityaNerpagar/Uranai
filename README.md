# Uranai 占 — Chinese Divination Oracle

A password-protected fortune-telling web app with three methods: I Ching (易經),
Ba Zi (八字), and Zi Wei Dou Shu (紫微斗數).

Static frontend (`index.html`) + Vercel serverless functions (`api/`). All secrets —
passwords, AI provider keys, and system prompts — live server-side in environment
variables. The password check happens on the server, which issues an HMAC-signed
session token that `/api/reading` verifies on every request.

## Access model

- **Admin** signs in with `ADMIN_PASSWORD` and gets unlimited readings plus an
  "Oracle Keys" panel on the home screen.
- **Users** sign in with a key (e.g. `XKQ2-9FMT-C4RD`) that the admin generates
  and hands out. The admin chooses how many readings each key carries when
  forging it (1–99, default 1). Uses are enforced server-side in Redis:
  `/api/reading` claims one use with an atomic decrement when a reading is
  delivered, and gives it back if the AI call fails. An exhausted key can't
  sign in again; the lock screen accepts a fresh key or the admin password.

## Environment variables (required)

Copy `.env.example` to `.env` for local development (`vercel dev` picks it up;
`.env` is gitignored). For production, set the same variables in the Vercel
dashboard (Project → Settings → Environment Variables) or with `vercel env add`:

| Variable | Purpose |
|---|---|
| `ADMIN_PASSWORD` | Admin password (unlimited readings, key management) |
| `SESSION_SECRET` | Random string used to sign session tokens — e.g. `openssl rand -hex 32` |
| `AI_PROVIDER` | `gemini` (default), `claude`, or `groq` |
| `GEMINI_API_KEY` | Required if provider is `gemini` |
| `ANTHROPIC_API_KEY` | Required if provider is `claude` |
| `GROQ_API_KEY` | Required if provider is `groq` |

Optional model overrides: `GEMINI_MODEL`, `CLAUDE_MODEL`, `GROQ_MODEL`.

### Key store (Upstash Redis)

One-time keys live in Upstash Redis. Install it from the Vercel Marketplace
(Dashboard → Storage → Create Database → Upstash for Redis, free tier is fine)
and connect it to this project — that auto-provisions the required env vars
(`KV_REST_API_URL` / `KV_REST_API_TOKEN`, or the `UPSTASH_REDIS_REST_*` pair;
either naming works). No npm dependency is needed; the functions call the
Upstash REST API directly.

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

## Abuse protection

- Every consultation requires a valid session and, for key-holders, spends one
  key use — there is no unauthenticated AI access. Direct questions go through
  the I Ching form's question field.
- Per-IP rate limits in Redis: 10 sign-in attempts/min (brute-force
  protection), 8 readings/min, 30 key operations/min. Limits fail open if
  Redis is unreachable so an outage can't lock the admin out; key-use
  accounting still gates users independently.
- Question length is capped client- and server-side; only allowlisted fields
  reach the model, and responses are capped at 2048 output tokens on all
  providers.
- Every persona prompt ends with a guard clause: the seeker's text is treated
  as a question, not instructions — requests to change roles, dump the prompt,
  or do non-divination work are declined in character.

## Notes

- Key codes are stored in plaintext in Redis so the admin panel can show and
  re-copy them. They only gate a single AI reading, so this is a deliberate
  convenience trade-off.
- Wrong-password responses are uniform and compared in constant time.
