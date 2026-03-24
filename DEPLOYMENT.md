# Deployment Guide

This guide is intended to move the app from local or demo mode into a more production-ready environment.

## 1. Target architecture

Minimum recommended setup:

- Frontend: `Next.js` running with `npm run build && npm run start`
- Backend: `uvicorn backend.main:app`
- Database: `PostgreSQL`
- Vector extension: `pgvector`
- Reverse proxy: `Nginx` or the platform's built-in proxy
- Process manager: `systemd`, `pm2`, Docker, or a managed runtime

## 2. Required environment variables

Backend:

```env
OPENAI_API_KEY=sk-proj-REAL_KEY
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/chat_ai
APP_BASE_URL=https://your-domain.com
ADMIN_EMAILS=ops@example.com,owner@example.com
STRIPE_WEBHOOK_SECRET=whsec_real_secret_if_used
USE_NATIVE_PGVECTOR=1
```

Frontend:

```env
PYTHON_API_BASE_URL=https://api.your-domain.com
```

If live AI is not active yet, the demo fallback can still be used.

## 3. Database rollout

1. Start PostgreSQL
2. Make sure the `vector` extension is enabled
3. Run migrations:

```bash
alembic upgrade head
```

4. Check backend health:

```bash
curl http://127.0.0.1:8000/health
```

## 4. Backend startup

For a simple Linux server:

```bash
source .venv/bin/activate
alembic upgrade head
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

For more stability, run it under a process manager.

## 5. Frontend startup

```bash
npm install
npm run build
npm run start
```

For local development:

```bash
npm run dev
```

## 6. Pre-launch checklist

- `PostgreSQL` is running and reachable by the backend
- `alembic upgrade head` succeeds
- `OPENAI_API_KEY` is valid, or demo mode has been approved for presentations
- `APP_BASE_URL` matches the frontend domain
- `PYTHON_API_BASE_URL` matches the backend URL
- `/health` returns `200`
- register and sign-in work
- creating a conversation works
- document upload works
- chat works
- request logs and audit logs are visible

## 7. Production hardening

Most important tasks before go-live:

- use an HTTPS domain
- never expose secrets in the frontend
- set `ADMIN_EMAILS` correctly
- use PostgreSQL, not SQLite
- enable database backups
- rotate API keys if they were ever exposed
- restrict admin analytics access
- review token and document quotas per workspace
- monitor request logs, audit logs, and error rates

## 8. Demo-ready vs live-ready

Demo-ready:

- demo mode is active
- OpenAI billing does not need to be active yet
- the focus is on UX, document flow, workspace controls, and observability

Live-ready:

- OpenAI billing and API access are active
- rate limits have been considered
- email and SMTP are configured
- backups and monitoring are in place
- deployment uses a domain and HTTPS

## 9. Presentation narrative

`This application already works end to end for auth, workspace isolation, document ingestion, observability, and AI-assisted review chat. For demos, the system includes a safe fallback mode. For production, the architecture is already prepared for PostgreSQL, pgvector, and a live AI provider.`
