# Building Plan Automation Workspace

An AI-assisted review workspace for teams that need to intake plans, load FBC or NEC references, and convert review findings into technical checklists and handoff notes.

In one sentence: this app brings drawing intake, code knowledge, and AI-assisted review into a more operational project dashboard.

This project is closer to `AI product engineering` than a simple chat UI. The focus is on project intake, document-aware review, workspace isolation, observability, and a deployment path that can be elevated to a production-style environment.

## Recruiter preview

`30-second pitch`

This project demonstrates how an AI-assisted product can support building-plan review workflows instead of acting as a generic chatbot. The app combines plan intake, code-reference retrieval, structured review chat, project collaboration, and operational visibility inside one product surface.

`What this shows`

- Product thinking: the workflow is designed around a real review process, not only around a model response
- Full-stack execution: the product includes frontend UX, backend APIs, database flows, auth, document handling, and observability
- Operational realism: the app includes audit logs, usage tracking, fallback AI behavior, and a multi-project workspace model

`Recommended screenshot order`

1. Landing or sign-in screen
   Show that the purpose is immediately clear: plan intake, code knowledge, and coordinated MEP review.
2. Project dashboard
   Show the active project summary, readiness board, and the broader operational framing of the product.
3. Plan intake and reference files
   Show uploaded plans, code references, and the document-aware review flow.
4. Review chat and action output
   Show how the assistant turns plan context into findings, checklists, and next actions.
5. Audit or usage panel
   Show request logs, analytics, or team usage to highlight production-minded design.

`Walkthrough emphasis`

- Start with the business problem, not the tech stack
- Show one complete workflow from project intake to review output
- End with observability, collaboration, or fallback behavior to reinforce engineering maturity

## At a glance

- `Primary users`: architecture teams, MEP reviewers, code reviewers, estimators, or technical operations teams
- `Problem solved`: plan review, code lookup, and technical handoff are still manual and fragmented
- `Core workflow`: upload plans and references -> ask for a review -> get checklists, findings, and action items

## Why this project matters

- It brings drawing intake, FBC or NEC lookup, and AI review into one project workspace
- It keeps the workflow stable through a `demo-safe mode` when live AI is not available
- It demonstrates full-stack ownership across frontend, backend, database, auth, observability, and AI integration
- It is usable for recruiter demos, engineering portfolios, and internal SaaS-style workflow prototypes

## Product highlights

- `Building-plan review copilot`: uses plan context and project references to produce more grounded reviews
- `Document-aware workflow`: upload `PDF`, `TXT`, or `MD` references for plans, code, or specifications
- `Project workspace system`: auth, team access, invite flow, API keys, and a shared review library
- `Operational visibility`: request logs, audit logs, usage analytics, and invoice-style summaries
- `Resilient demo path`: a fallback mode keeps the UX stable even when billing or live AI is unavailable
- `PostgreSQL-ready`: Alembic migrations and optional pgvector setup are already in place

## Quick assets

- Positioning for CV, interviews, and client pitches: [POSITIONING.md](./POSITIONING.md)
- Demo presentation script: [DEMO_SCRIPT.md](./DEMO_SCRIPT.md)
- Interview answers: [INTERVIEW_QA.md](./INTERVIEW_QA.md)
- Deployment and production checklist: [DEPLOYMENT.md](./DEPLOYMENT.md)
- Product blueprint for the building-plan automation direction: [BUILDING_PLAN_AUTOMATION_BLUEPRINT.md](./BUILDING_PLAN_AUTOMATION_BLUEPRINT.md)

## Core capabilities

- Realtime review chat with a multi-session sidebar
- Register, sign in, token auth, and personal or shared project flows
- Upload plans and references per session, then reuse knowledge across reviews inside the same project
- Team invites, API keys, usage metrics, request logs, and audit logs
- Billing-style dashboards, quota enforcement, invoice history, and department budget alerts
- Email verification, password reset, and queued email delivery
- Demo fallback for chat and embeddings so the product flow still works without live AI

## Stack

- Frontend: `Next.js 15`, `React 19`, `TypeScript`
- Web server and API proxy: `Next.js Route Handler`
- AI backend: `FastAPI`, `Python`, `OpenAI SDK`
- Database layer: `SQLAlchemy`
- Auth: token-based session auth
- Retrieval: embeddings plus semantic chunk search
- Ops: analytics-ready backend plus pgvector Docker setup
- Billing signal: estimated tokens and estimated cost
- Collaboration: project teams plus member invite flow
- Permissions: owner, admin, member
- Admin controls: audit logs and member management
- Shared knowledge: workspace document library across conversations
- Billing integration path: mock checkout plus a Stripe-style webhook endpoint
- Delivery path: SMTP invite email plus invite landing page
- Platform controls: API keys, auth throttling, and worker-style email processing
- Operational depth: request logs, migration tooling, and budget alerts

## Quick start

1. Install frontend dependencies

```bash
npm install
```

2. Set up the Python backend

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt
```

3. Copy the environment files

```bash
cp .env.example .env.local
cp .env.example backend/.env
```

4. Update `backend/.env`

At minimum:

```env
OPENAI_API_KEY=your_key_here
OPENAI_MODEL=gpt-4o-mini
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
```

Optional:

- set `PYTHON_API_BASE_URL` in `.env.local` if your Python backend is not running at `http://127.0.0.1:8000`
- set `NEXT_PUBLIC_GOOGLE_CLIENT_ID` in `.env.local` and `GOOGLE_CLIENT_ID` in `backend/.env` to enable Google sign-in

5. Start the Python backend

```bash
source .venv/bin/activate
uvicorn backend.main:app --reload
```

6. Optional: run the email worker in a separate terminal

```bash
source .venv/bin/activate
python backend/worker.py
```

7. Start the Next.js frontend in another terminal

```bash
npm run dev
```

8. Open `http://localhost:3000`

## Demo mode

If OpenAI billing is not active yet, the app can still be presented safely through the fallback demo mode.

- Chat still works
- Document upload still works
- Document retrieval is still used
- The UX still shows a realistic product workflow

This keeps the repo useful for portfolio demos, recruiter walkthroughs, and UX validation without depending entirely on a live AI provider.

## Notes

- The default local database uses `SQLite` via `DATABASE_URL=sqlite:///backend/app.db`
- For a more production-ready setup, use `PostgreSQL` plus `Alembic`
- Supported uploads today: `.pdf`, `.txt`, `.md`
- Default embeddings use `OPENAI_EMBEDDING_MODEL=text-embedding-3-small`
- Emails listed in `ADMIN_EMAILS` can access global admin analytics
- Cost estimation can be tuned with `CHAT_INPUT_COST_PER_1K`, `CHAT_OUTPUT_COST_PER_1K`, and `EMBEDDING_COST_PER_1K`
- Team workspaces support project creation, member invites by email, and mock billing summaries
- Invites remain pending until the recipient accepts or rejects them
- Workspace API keys support non-user access through the `X-API-Key` header
- Uploads are stored in the workspace knowledge layer and can be reused across conversations in the same workspace
- Mock checkout populates placeholder Stripe customer and subscription ids to make the billing UI more realistic
- Subscription summaries show monthly token and document quotas
- Quotas are enforced in the backend, not only displayed in the UI
- Mock Stripe webhooks are available at `POST /billing/webhooks/stripe` using `Stripe-Signature`
- Sensitive endpoints such as settings, audit logs, billing, email jobs, member management, and admin analytics require direct user login, not `X-API-Key`
- API key usage also shows estimated token usage, cost, and top paths
- The billing panel includes current-period invoice summaries and CSV export
- The app includes six months of invoice history and request log filters by auth mode, status, and path
- The UI shows warnings when token or document quotas approach their limits
- Request log filters are stored locally in the browser, and the log viewer supports pagination
- Invoice usage includes a member-level breakdown for the active period
- Owners and admins can add `department` and `cost_center` metadata for member-level budget visibility
- `USE_NATIVE_PGVECTOR=1` enables native pgvector write and query paths when PostgreSQL is used

## Alembic

The repo already includes an initial Alembic baseline and can be used as the official migration path.

Example:

```bash
alembic upgrade head
```

## Smoke audit

To verify the main backend flow without relying on live OpenAI responses:

```bash
source .venv/bin/activate
python backend/smoke_audit.py
```

This script tests key flows such as register, login, workspace creation, member invites, settings, document upload, chat, API keys, mock billing, and conversation cleanup.

For lighter regression coverage focused on demo mode and document upload:

```bash
source .venv/bin/activate
python -m unittest discover -s backend -p 'test_*.py'
```

If the data model changes later:

```bash
alembic revision --autogenerate -m "describe_the_change"
alembic upgrade head
```

## PostgreSQL / pgvector

To prepare a more production-like local database:

```bash
docker compose -f docker-compose.pgvector.yml up -d
```

Install backend dependencies first so the PostgreSQL driver is available:

```bash
pip install -r backend/requirements.txt
```

Then update `DATABASE_URL` in `backend/.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/chat_ai
```

After that, run the migrations:

```bash
alembic upgrade head
```

The compose file already uses the `pgvector/pgvector` image, and the vector extension is enabled automatically through `docker/postgres/init/01-enable-pgvector.sql`.

## Next steps

- Move retrieval fully to PostgreSQL plus pgvector for larger-scale usage
- Add deeper RBAC, invite governance, and a real Stripe billing flow
- Expand observability, audit controls, and admin tooling
