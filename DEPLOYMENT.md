# Deployment Guide

Panduan ini dibuat untuk membawa app dari mode lokal/demo ke environment yang lebih production-ready.

## 1. Target arsitektur

Rekomendasi minimal:

- Frontend: `Next.js` dijalankan dengan `npm run build && npm run start`
- Backend: `uvicorn backend.main:app`
- Database: `PostgreSQL`
- Extension vector: `pgvector`
- Reverse proxy: `Nginx` atau platform proxy bawaan
- Process manager: `systemd`, `pm2`, Docker, atau platform managed runtime

## 2. Environment yang wajib diisi

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

Kalau live AI belum aktif, demo mode masih bisa dipakai sebagai fallback.

## 3. Database rollout

1. Jalankan PostgreSQL
2. Pastikan extension `vector` aktif
3. Jalankan migrasi:

```bash
alembic upgrade head
```

4. Cek health backend:

```bash
curl http://127.0.0.1:8000/health
```

## 4. Backend startup

Untuk server Linux sederhana:

```bash
source .venv/bin/activate
alembic upgrade head
uvicorn backend.main:app --host 0.0.0.0 --port 8000
```

Kalau mau lebih stabil, jalankan di bawah process manager.

## 5. Frontend startup

```bash
npm install
npm run build
npm run start
```

Untuk development lokal tetap bisa:

```bash
npm run dev
```

## 6. Pre-launch checklist

- `PostgreSQL` aktif dan bisa diakses backend
- `alembic upgrade head` sukses
- `OPENAI_API_KEY` valid atau demo mode sudah disetujui untuk presentasi
- `APP_BASE_URL` sesuai domain frontend
- `PYTHON_API_BASE_URL` sesuai URL backend
- endpoint `/health` merespons `200`
- register/login berhasil
- create conversation berhasil
- upload dokumen berhasil
- chat berhasil
- request log dan audit log muncul

## 7. Production hardening

Yang paling penting sebelum go-live:

- pakai domain HTTPS
- jangan simpan key di frontend
- isi `ADMIN_EMAILS` dengan email admin yang benar
- pakai PostgreSQL, jangan SQLite
- aktifkan backup database
- rotasi API key kalau pernah tersebar
- batasi akses admin analytics
- review quota token dan dokumen per workspace
- monitor request logs, audit logs, dan error rate

## 8. Demo-ready vs live-ready

Demo-ready:

- demo mode aktif
- OpenAI billing belum harus aktif
- fokus ke UX, alur dokumen, workspace, dan observability

Live-ready:

- billing/API OpenAI aktif
- rate limit sudah diperhitungkan
- email/SMTP siap
- backup dan monitoring jalan
- deployment pakai domain dan HTTPS

## 9. Narasi yang bisa dipakai saat presentasi

`Aplikasi ini sudah berjalan end-to-end untuk auth, workspace isolation, document ingestion, observability, dan AI-assisted chat. Untuk demo, sistem punya safe fallback mode. Untuk production, arsitekturnya sudah siap dinaikkan ke PostgreSQL, pgvector, dan live AI provider.`
