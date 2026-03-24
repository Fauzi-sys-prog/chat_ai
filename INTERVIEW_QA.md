## Interview Q&A

### Explain this project briefly

`I built an AI-assisted building plan review workspace to help teams intake plans, load FBC or NEC references, and turn review findings into technical action items faster. The stack uses Next.js and TypeScript on the frontend, FastAPI and SQLAlchemy on the backend, PostgreSQL for the core data layer, and an OpenAI-ready AI path with demo fallback so the system remains stable when external dependencies are unavailable.`

### Why did you choose FastAPI instead of a Node backend?

`I wanted a backend that is strong for APIs, document processing, and AI integration. FastAPI gives a fast, type-aware structure that fits this kind of service very well.`

### Why move to PostgreSQL?

`The application already outgrew the shape of a lightweight local prototype. It has auth, projects, documents, logs, usage tracking, and relational data that are better handled by PostgreSQL than SQLite.`

### Why not use Prisma?

`Because this backend is Python-based. SQLAlchemy and Alembic are more natural here, stay consistent with the rest of the backend, and avoid introducing a second ORM layer that is not needed.`

### How does the AI flow work in this project?

`The user sends a review prompt, the backend stores the message, and if project documents exist, the system builds context from document chunks. That context is then sent to the AI model to make the response more relevant. If the live AI path is unavailable, the backend automatically falls back to demo mode so the product flow stays stable for testing and presentations.`

### What was the hardest part?

`Keeping the product usable even when a third-party AI provider can fail because of billing, rate limits, or connectivity. That is why I added a demo fallback, clearer error handling, and observability so the problem can be isolated quickly.`

### What proves this is not just a chatbot?

- It has workspace isolation
- It includes document ingestion and chunking
- It includes usage tracking and cost estimation
- It includes request logs and audit logs
- It includes API-key access for internal or B2B integrations

### What part are you most proud of?

`I am most proud of the architecture and product judgment. I did not only make chat work. I made sure the system stays usable when live AI fails, so the product still feels credible to users and stakeholders.`

### What would be the next step for the project?

- Turn on live AI with active billing or an alternative provider
- Improve document-grounded retrieval so review output is even more specific
- Add deeper governance and analytics
- Prepare a true staging or production deployment environment
