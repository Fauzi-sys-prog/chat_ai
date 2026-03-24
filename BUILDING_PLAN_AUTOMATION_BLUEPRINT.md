# Building Plan Automation Blueprint

Blueprint ini memosisikan project sebagai `AI-assisted building plan automation platform` untuk membantu menghasilkan layer MEP di atas plan arsitektur dengan kombinasi vision, code retrieval, dan routing engine.

## One-liner

Platform ini menerima denah arsitektur, mengenali ruang dan simbol penting, mencocokkannya dengan aturan bangunan yang relevan, lalu menghasilkan rekomendasi atau draft routing MEP yang bisa direview engineer.

## Posisi Produk

- `User utama`: engineer, drafter, estimator, atau tim technical operations
- `Masalah utama`: plan arsitektur dibaca manual, aturan kode dicek manual, dan koordinasi MEP memakan waktu
- `Nilai produk`: mempercepat review awal, memberi rekomendasi code-aware, dan menyiapkan draft rute MEP sebelum final review manusia

## Arsitektur 3 Lapis

### 1. Mata

Lapisan ini membaca file plan dan mengenali objek penting.

- input: `PDF`, `PNG`, `JPG`, atau export CAD raster
- output: dinding, pintu, ruang, toilet, sink, panel, peralatan, dan anotasi awal
- pendekatan MVP:
  - `Vision API multimodal` seperti OpenAI/Claude untuk parsing visual awal
  - rule-based geometry extraction untuk garis, room boundary, dan anchor points
- pendekatan tahap lanjut:
  - custom CV model untuk simbol MEP dan arsitektural
  - optional `TensorFlow` atau model detection/segmentation lain bila simbol sudah punya dataset internal

### 2. Otak

Lapisan ini mengubah hasil visual menjadi keputusan teknik yang bisa dijelaskan.

- input: hasil deteksi visual + metadata ruangan + dokumen kode
- output: aturan yang relevan, constraint desain, dan checklist per ruang/zone
- komponen:
  - `LLM`
  - `RAG` untuk FBC, NEC, dan dokumen standar internal
  - rule engine untuk batas-batas deterministik

Contoh:

- "Saya melihat bathroom dengan sink"
- "NEC mensyaratkan GFCI pada konteks ini"
- "FBC mensyaratkan ventilation minimum tertentu"

### 3. Tangan

Lapisan ini menggambar atau menghitung draft rute teknis.

- input: constraint dari lapisan otak
- output: candidate route untuk mechanical, electrical, atau plumbing
- teknik:
  - `A* pathfinding`
  - graph routing
  - collision avoidance
  - constraint checking terhadap forbidden zone, room type, shaft, dan equipment location

## Stack Yang Paling Masuk Akal

### App Layer

- Frontend: `Next.js + TypeScript`
- Backend orchestration: `FastAPI + Python`
- Database: `PostgreSQL`
- Vector store: `pgvector`
- Background jobs: `Celery` atau job queue ringan berbasis worker Python

### AI Layer

- Multimodal vision: `OpenAI Responses API` atau model vision setara
- LLM reasoning: `OpenAI` untuk rule explanation dan structured outputs
- RAG: embeddings + retrieval untuk code references
- Optional orchestration: `LangGraph` atau `LangChain` bila flow agentic benar-benar dibutuhkan

### Geometry / Plan Processing

- `OpenCV`
- `Shapely`
- `NetworkX`
- `NumPy`
- optional CAD/BIM parsers bila nanti masuk DWG/DXF/IFC pipeline

### ML Layer Tahap Lanjut

Dipakai hanya kalau memang ada dataset simbol sendiri.

- `TensorFlow / Keras`
- custom object detection / segmentation
- dataset simbol plan untuk outlet, fixture, panel, duct node, dsb

## Kenapa Bukan Full TensorFlow Dulu

Untuk recruiter dan MVP, yang paling kuat justru:

- vision API dulu untuk validasi use case
- RAG + rule engine untuk code reasoning
- routing algorithm untuk hasil yang bisa didemokan

Ini lebih cepat, lebih realistis, dan lebih jujur daripada mengklaim model CV custom kalau dataset belum ada.

TensorFlow tetap relevan, tapi idealnya masuk di fase kedua untuk:

- symbol detection yang lebih stabil
- room classification khusus domain plan
- segmentation yang lebih presisi

## Modul Inti Yang Harus Ada

### 1. Plan Intake

- upload file plan
- project metadata
- versioning plan
- parsing job queue

### 2. Vision Extraction

- deteksi room candidates
- ekstraksi fixtures
- ekstraksi wall/door/opening
- visual overlay preview

### 3. Code Knowledge Layer

- ingestion dokumen FBC
- ingestion NEC
- metadata by chapter/topic/trade
- citation-ready retrieval

Catatan:
- `NEC` punya isu lisensi. Untuk versi publik/demo, jangan sembarang ingest full proprietary content tanpa hak penggunaan yang jelas.

### 4. Rule Engine

- rule templates by trade:
  - electrical
  - plumbing
  - mechanical
- deterministic checks
- structured constraint output

### 5. Routing Engine

- pathfinding graph
- obstacle map
- start/end anchor
- candidate route scoring

### 6. Review UI

- plan viewer
- detected entities
- suggested rules
- generated route candidates
- issue list / warnings

### 7. Ops Layer

- audit logs
- request logs
- job runs
- retry / failure states
- per-project processing status

## Data Model Yang Perlu Ada

- `projects`
- `building_plans`
- `plan_pages`
- `detected_entities`
- `rooms`
- `fixtures`
- `code_documents`
- `code_chunks`
- `rule_evaluations`
- `routing_jobs`
- `routing_candidates`
- `review_comments`
- `processing_runs`
- `audit_logs`

## MVP Yang Recruiter Akan Hargai

Jangan mulai dari "generate full Florida MEP plan". Mulai dari MVP yang believable:

### MVP-1: Plan Review Assistant

- upload 1 denah arsitektur
- AI deteksi room type dasar
- RAG cari aturan FBC/NEC yang relevan
- keluarkan checklist code-aware per room

### MVP-2: Electrical Draft Helper

- deteksi bathroom / kitchen / room layout
- sarankan titik outlet/GFCI secara rule-based
- tampilkan overlay visual sederhana

### MVP-3: Routing Draft

- pilih dua titik
- generate candidate path dengan A*
- tampilkan path yang menghindari dinding / forbidden area

Kalau tiga flow ini jalan, kamu sudah punya demo yang sangat kuat buat role seperti itu.

## Apa Yang Bisa Dipakai Dari App Kamu Sekarang

Project kamu yang sekarang sudah punya fondasi yang berguna:

- auth
- workspace / project scoping
- document ingestion
- RAG-friendly backend
- audit trail
- request logs
- PostgreSQL-ready foundation

Mapping-nya:

- `workspace` -> `project / client / building job`
- `documents` -> `code references, project notes, specification sheets`
- `chat` -> `plan review assistant`
- `audit logs` -> `processing and reviewer activity`
- `request logs` -> `job/debug observability`

## Roadmap Implementasi

### Fase 1

- project intake
- upload plan image/PDF
- code document library
- room/fixture extraction mock + review panel

### Fase 2

- structured RAG for FBC/NEC
- rule evaluation output
- room-level recommendations

### Fase 3

- routing engine
- path candidate overlay
- issue scoring

### Fase 4

- custom vision model
- batch processing
- project dashboard
- QA / approval workflow

## Stack Yang Dijual Ke Recruiter

Kalau kamu mau positioning yang kuat, jelaskan seperti ini:

`I am building an AI-assisted building-plan automation platform that combines multimodal plan understanding, code-aware retrieval over FBC/NEC references, and path-routing algorithms to generate reviewable MEP recommendations on top of architectural drawings.`

Versi Indonesianya:

`Saya membangun platform otomasi rencana bangunan berbasis AI yang menggabungkan pembacaan denah visual, retrieval aturan bangunan, dan algoritma routing untuk menghasilkan rekomendasi MEP yang bisa direview engineer.`

## Tech Stack Recommendation

- `Frontend`: Next.js, TypeScript
- `Backend`: FastAPI, Python
- `Database`: PostgreSQL
- `Vector Search`: pgvector
- `AI`: OpenAI multimodal + embeddings
- `Geometry`: OpenCV, Shapely, NumPy, NetworkX
- `ML tahap lanjut`: TensorFlow/Keras
- `Infra`: AWS

## Yang Akan Dinilai Recruiter

- apakah kamu paham memecah masalah teknik besar jadi MVP realistis
- apakah kamu bisa menggabungkan AI + backend + geometry + review UI
- apakah kamu paham perbedaan reasoning probabilistik vs rule-based constraints
- apakah kamu punya data model dan observability yang masuk akal
- apakah kamu jujur soal batas AI dan tetap mendesain human review loop

## Prinsip Penting

- jangan klaim full autonomous engineering kalau sistemmu masih assistant-level
- tunjukkan `human-in-the-loop`
- prioritaskan explainability dan citation
- prioritaskan reviewability daripada sekadar "AI generated"

