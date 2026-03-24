# Building Plan Automation Workspace

AI-powered review workspace untuk membantu tim membaca plan, memuat referensi FBC atau NEC, dan mengubah hasil review menjadi checklist serta handoff teknis.

Dalam satu kalimat: ini adalah aplikasi web untuk menyatukan intake drawing, code knowledge, dan AI-assisted review ke dalam satu dashboard proyek yang lebih operasional.

Project ini lebih dekat ke `AI product engineering` daripada sekadar chat UI. Fokusnya ada di project intake, document-aware review, workspace isolation, observability, dan jalur deploy yang siap dinaikkan ke environment production.

## At a glance

- `Siapa user-nya`: tim arsitektur, MEP, reviewer kode, atau engineer operasional
- `Masalah yang diselesaikan`: review plan, lookup aturan bangunan, dan handoff teknis masih manual dan tersebar
- `Cara kerja inti`: upload plan dan referensi -> ajukan review prompt -> dapat checklist, temuan, dan action items

## Why this project matters

- Menyatukan intake drawing, lookup FBC atau NEC, dan review AI ke satu workspace proyek
- Menjaga alur kerja tetap stabil dengan `demo-safe mode` saat AI live belum aktif
- Menunjukkan full-stack capability: frontend, backend, database, auth, observability, dan AI integration
- Cocok untuk demo client, portfolio engineer, atau pondasi internal SaaS tool berbasis workflow teknis

## Product highlights

- `Building-plan review copilot`: bisa membaca konteks plan dan referensi proyek untuk menyusun review yang lebih grounded
- `Document-aware workflow`: upload `PDF`, `TXT`, atau `MD` untuk plan, code reference, atau spesifikasi
- `Project workspace system`: auth, team access, invite flow, API keys, dan shared review library
- `Operational visibility`: request logs, audit logs, usage analytics, invoice-style summaries
- `Resilient demo path`: fallback mode tetap menjaga UX walau billing atau AI live belum aktif
- `PostgreSQL-ready`: migration path via Alembic dan optional pgvector setup sudah tersedia

## Quick assets

- Positioning untuk CV, interview, dan tender: [POSITIONING.md](/Users/macbook/Documents/chat_ai/POSITIONING.md)
- Script demo presentasi: [DEMO_SCRIPT.md](/Users/macbook/Documents/chat_ai/DEMO_SCRIPT.md)
- Jawaban interview teknikal: [INTERVIEW_QA.md](/Users/macbook/Documents/chat_ai/INTERVIEW_QA.md)
- Panduan deploy dan production checklist: [DEPLOYMENT.md](/Users/macbook/Documents/chat_ai/DEPLOYMENT.md)
- Blueprint untuk role building-plan automation / architectural GPT: [BUILDING_PLAN_AUTOMATION_BLUEPRINT.md](/Users/macbook/Documents/chat_ai/BUILDING_PLAN_AUTOMATION_BLUEPRINT.md)

## Core capabilities

- Realtime review chat dengan multi-session sidebar
- Register/login, token auth, dan personal or shared project flow
- Upload plan atau referensi per session, lalu reuse knowledge lintas review dalam proyek
- Team invites, API keys, usage metrics, request logs, dan audit logs
- Billing-style dashboard, quota enforcement, invoice history, dan department budget alerts
- Email verification, password reset, dan queued email delivery path
- Demo fallback untuk chat dan embedding agar product flow tetap bisa ditunjukkan tanpa AI live

## Stack

- Frontend: `Next.js 15`, `React 19`, `TypeScript`
- Web server/API proxy: `Next.js Route Handler`
- AI backend: `FastAPI`, `Python`, `OpenAI SDK`
- Database layer: `SQLAlchemy`
- Auth: token-based session auth
- Retrieval: embeddings + semantic chunk search
- Ops: analytics-ready backend + pgvector docker setup
- Billing signal: estimated tokens dan estimated cost
- Collaboration: workspace team + member invite
- Permissions: owner/admin/member
- Admin controls: audit log workspace + member management
- Collaboration flow: pending invite -> accept/reject
- Shared knowledge: workspace document library lintas conversation
- Billing integration path: mock checkout + Stripe-style webhook endpoint
- Delivery path: SMTP invite email + invite landing page
- Ops surface: workspace settings + member usage + email retry queue
- Auth hardening: email verify + password reset + worker-like email processor
- Platform controls: API keys + auth throttling + scheduler-style email worker
- Operational depth: request logs + migration tooling
- Security shape: per-endpoint human/API-key access control
- Cost governance: department budget cap + alert signal

## Quick start

1. Install dependency frontend

```bash
npm install
```

2. Siapkan backend Python

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

3. Copy environment file

```bash
cp .env.example .env.local
cp .env.example backend/.env
```

4. Isi `OPENAI_API_KEY` di `backend/.env`

Opsional:
isi `PYTHON_API_BASE_URL` di `.env.local` kalau URL backend Python kamu beda dari default `http://127.0.0.1:8000`
isi `NEXT_PUBLIC_GOOGLE_CLIENT_ID` di `.env.local` dan `GOOGLE_CLIENT_ID` di `backend/.env` kalau mau mengaktifkan Google login

5. Jalankan backend Python

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload
```

6. Opsional: jalankan email worker terpisah kalau mau queue lebih mirip production

```bash
source .venv/bin/activate
python backend/worker.py
```

7. Jalankan frontend Next.js di terminal lain

```bash
npm run dev
```

8. Buka `http://localhost:3000`

## Demo mode

Kalau billing OpenAI belum aktif, app tetap bisa dipresentasikan dengan aman lewat fallback demo mode.

- Chat tetap jalan
- Upload dokumen tetap jalan
- Retrieval dokumen tetap dipakai
- UI tetap menunjukkan alur produk secara realistis

Ini membuat repo tetap berguna untuk portfolio, demo recruiter, dan validasi UX tanpa bergantung penuh pada provider AI live.

## Catatan

- Default database sekarang pakai `SQLite` lokal lewat `DATABASE_URL=sqlite:///backend/app.db`
- Untuk mode yang lebih production-ready, pakai `PostgreSQL` + `Alembic`
- Upload yang didukung saat ini: `.pdf`, `.txt`, `.md`
- Embedding default pakai `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- Email yang ada di `ADMIN_EMAILS` bisa buka admin analytics global
- Cost estimation default bisa di-tuning via `CHAT_INPUT_COST_PER_1K`, `CHAT_OUTPUT_COST_PER_1K`, dan `EMBEDDING_COST_PER_1K`
- Workspace tim sekarang mendukung create workspace, invite member by email, dan billing summary mock per workspace
- Owner/admin bisa lihat audit log workspace, owner bisa ubah role, dan owner/admin bisa remove member
- Invite sekarang bersifat pending sampai user accept/reject dari inbox undangan
- Invite response sekarang juga punya `accept_url` yang siap dipakai sebagai link undangan
- Kalau `SMTP_HOST` diisi, backend akan mencoba kirim email invite otomatis
- Register sekarang membuat token verifikasi email dan login panel punya request reset password
- Workspace sekarang bisa punya API key sendiri untuk akses non-user via header `X-API-Key`
- Workspace settings sekarang juga menampilkan observability snapshot dan usage API key
- Upload dokumen sekarang masuk ke knowledge workspace dan bisa dipakai lintas conversation dalam workspace yang sama
- Endpoint mock checkout menyiapkan `stripe_customer_id` dan `stripe_subscription_id` palsu supaya UI billing lebih realistis
- Subscription summary sekarang menampilkan quota bulanan token/dokumen
- Quota token dan dokumen sekarang juga ditegakkan di backend, bukan cuma ditampilkan
- Mock Stripe webhook tersedia di `POST /billing/webhooks/stripe` dan memakai header `Stripe-Signature` yang harus cocok dengan `STRIPE_WEBHOOK_SECRET`
- Processor email jobs tersedia di `POST /system/process-email-jobs` untuk admin, jadi queue email bisa diproses seperti worker ringan
- Auth endpoints sekarang dibatasi rate limit sederhana via env `AUTH_RATE_LIMIT_WINDOW_SECONDS` dan `AUTH_RATE_LIMIT_MAX_ATTEMPTS`
- Auto worker email jobs bisa diaktifkan dengan `AUTO_PROCESS_EMAIL_JOBS=1`
- Kalau mau worker terpisah, pakai `python backend/worker.py`; queue sekarang punya status `processing`, retry lease, dan attempt counter
- Request log middleware sekarang menyimpan jejak request workspace untuk observability dasar
- Endpoint sensitif seperti settings, audit log, billing, email jobs, member management, dan admin analytics sekarang hanya bisa diakses lewat login user langsung, bukan `X-API-Key`
- API key usage sekarang juga menampilkan perkiraan token/cost dan path yang paling sering dipakai
- Workspace sekarang punya endpoint detail request logs dan export CSV untuk observability yang lebih operasional
- Billing panel sekarang punya invoice usage periode aktif dan bisa diexport ke CSV
- Workspace sekarang juga punya histori invoice 6 bulan terakhir dan filter request logs by auth/status/path
- UI sekarang menampilkan warning saat quota token atau dokumen mulai mendekati limit
- Filter request logs sekarang disimpan lokal di browser, dan log viewer sudah punya pagination
- Invoice usage sekarang juga punya breakdown per member di periode aktif
- Owner/admin sekarang bisa menambahkan `department` dan `cost_center` ke member buat baca billing per tim lebih enak
- `USE_NATIVE_PGVECTOR=1` akan mencoba write/query path native pgvector saat database pakai PostgreSQL

## Alembic

Repo sekarang sudah punya baseline Alembic awal dan bisa dipakai sebagai jalur migrasi resmi.

Contoh pakai:

```bash
alembic upgrade head
```

## Smoke audit

Untuk cek fitur utama backend tanpa bergantung ke OpenAI sungguhan:

```bash
source .venv/bin/activate
python backend/smoke_audit.py
```

Script ini menguji flow utama seperti register/login, workspace, invite member, settings, upload dokumen, chat, API key, billing mock, dan cleanup conversation.

Untuk regression test yang lebih ringan dan fokus ke mode demo + upload dokumen:

```bash
source .venv/bin/activate
python -m unittest discover -s backend -p 'test_*.py'
```

Kalau nanti ada perubahan model baru:

```bash
alembic revision --autogenerate -m "deskripsi_perubahan"
alembic upgrade head
```

## PostgreSQL / pgvector

Untuk siapin database production lokal:

```bash
docker compose -f docker-compose.pgvector.yml up -d
```

Install dependency backend dulu agar driver PostgreSQL tersedia:

```bash
pip install -r backend/requirements.txt
```

Lalu ganti `DATABASE_URL` di `backend/.env` menjadi:

```bash
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/chat_ai
```

Sesudah itu jalankan migrasi:

```bash
alembic upgrade head
```

File compose ini sudah pakai image `pgvector/pgvector`, jadi jalur migrasi ke retrieval production-grade sudah disiapkan dari sekarang.
Init SQL juga sudah menyalakan extension `vector` otomatis lewat [docker/postgres/init/01-enable-pgvector.sql](/Users/macbook/Documents/chat_ai/docker/postgres/init/01-enable-pgvector.sql).

## Langkah berikutnya

- Migrasi retrieval ke pgvector/PostgreSQL penuh untuk production scale
- Tambah RBAC yang lebih detail, invite acceptance flow, dan Stripe billing beneran
- Tambah observability, audit log, dan admin controls yang lebih lengkap
