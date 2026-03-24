## Interview Q&A

### Jelaskan project ini secara singkat

`Saya membangun internal AI knowledge workspace untuk membantu tim mencari SOP, merangkum dokumen, dan menjawab pertanyaan operasional lebih cepat. Stack-nya memakai Next.js dan TypeScript di frontend, FastAPI dan SQLAlchemy di backend, PostgreSQL untuk data utama, dan jalur AI yang siap ke OpenAI dengan fallback demo mode agar sistem tetap stabil saat dependency eksternal bermasalah.`

### Kenapa pakai FastAPI dan bukan Node backend?

`Karena saya ingin backend yang kuat untuk API, pemrosesan dokumen, dan integrasi AI. FastAPI memberi struktur yang cepat, type-aware, dan enak untuk service semacam ini.`

### Kenapa pindah ke PostgreSQL?

`Karena kebutuhan aplikasinya sudah lebih dari sekadar prototype lokal. Ada auth, workspace, documents, logs, usage tracking, dan data relasional yang lebih cocok dikelola dengan PostgreSQL daripada SQLite.`

### Kenapa tidak pakai Prisma?

`Karena backend ini berbasis Python. SQLAlchemy dan Alembic lebih natural, lebih konsisten, dan tidak menambah lapisan ORM kedua yang tidak perlu.`

### Bagaimana alur AI di project ini?

`User mengirim prompt, backend menyimpan message, lalu jika ada dokumen workspace sistem membangun context dari chunks dokumen. Context itu dikirim ke model AI agar jawaban lebih relevan. Jika layanan AI live tidak tersedia, backend otomatis berpindah ke demo mode agar flow produk tetap aman untuk diuji atau dipresentasikan.`

### Apa tantangan terbesarnya?

`Menjaga pengalaman aplikasi tetap stabil walaupun third-party AI provider bisa gagal karena billing, rate limit, atau koneksi. Karena itu saya tambahkan fallback demo mode, error handling yang lebih jelas, dan observability supaya masalahnya cepat diisolasi.`

### Apa yang menunjukkan ini bukan sekadar chatbot?

- Ada workspace isolation.
- Ada document ingestion dan chunking.
- Ada usage tracking dan cost estimation.
- Ada request logs dan audit logs.
- Ada API-key access untuk integrasi B2B/internal.

### Kalau ditanya “bagian apa yang paling kamu banggakan?”

`Saya paling bangga pada arsitektur dan product judgment-nya. Saya tidak hanya membuat chat bekerja, tetapi juga memastikan sistem tetap bisa digunakan saat AI live gagal, sehingga produk tetap credible untuk user dan stakeholder.`

### Kalau ditanya “apa next step project ini?”

- Menyalakan AI live dengan billing aktif atau provider alternatif.
- Meningkatkan retrieval berbasis dokumen agar jawaban lebih grounded.
- Menambah role-based governance dan analytics yang lebih dalam.
- Menyiapkan deployment environment untuk staging/production.
