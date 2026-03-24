# Building Plan Automation Blueprint

This blueprint positions the project as an `AI-assisted building plan automation platform` that helps teams generate MEP review support on top of architectural plans through a combination of vision, code retrieval, and routing logic.

## One-liner

The platform accepts an architectural floor plan, identifies important rooms and symbols, matches them to relevant building-code rules, and then produces review recommendations or draft MEP routing that can be reviewed by an engineer.

## Product position

- `Primary users`: engineers, drafters, estimators, and technical operations teams
- `Core problem`: architectural plans are still read manually, code references are still checked manually, and MEP coordination takes too much time
- `Product value`: speed up first-pass review, provide code-aware recommendations, and prepare draft MEP routing before final human review

## The three-layer architecture

### 1. Eyes

This layer reads plan files and detects important objects.

- Input: `PDF`, `PNG`, `JPG`, or rasterized CAD exports
- Output: walls, doors, rooms, toilets, sinks, panels, equipment, and initial annotations
- MVP approach:
  - multimodal vision APIs such as OpenAI or Claude for initial visual parsing
  - rule-based geometry extraction for lines, room boundaries, and anchor points
- Later-stage approach:
  - custom computer-vision models for MEP and architectural symbols
  - optional `TensorFlow` or other detection and segmentation models once a domain dataset exists

### 2. Brain

This layer converts visual findings into explainable engineering decisions.

- Input: detected entities, room metadata, and code references
- Output: relevant rules, design constraints, and per-room or per-zone checklists
- Components:
  - `LLM`
  - `RAG` over FBC, NEC, and internal standard documents
  - a rule engine for deterministic constraints

Example reasoning:

- "I see a bathroom with a sink"
- "NEC requires GFCI protection in this context"
- "FBC requires minimum ventilation in this room type"

### 3. Hands

This layer draws or calculates technical draft routes.

- Input: constraints from the reasoning layer
- Output: candidate routes for mechanical, electrical, or plumbing systems
- Techniques:
  - `A* pathfinding`
  - graph routing
  - collision avoidance
  - constraint checking against forbidden zones, room types, shafts, and equipment locations

## Recommended stack

### Application layer

- Frontend: `Next.js + TypeScript`
- Backend orchestration: `FastAPI + Python`
- Database: `PostgreSQL`
- Vector storage: `pgvector`
- Background jobs: `Celery` or a lightweight Python worker queue

### AI layer

- Multimodal vision: `OpenAI Responses API` or a comparable vision-capable model
- LLM reasoning: `OpenAI` for rule explanations and structured outputs
- RAG: embeddings plus retrieval over code references
- Optional orchestration: `LangGraph` or `LangChain` if a more agentic flow becomes necessary

### Geometry and plan processing

- `OpenCV`
- `Shapely`
- `NetworkX`
- `NumPy`
- optional CAD or BIM parsers if the pipeline later needs `DWG`, `DXF`, or `IFC`

### Advanced ML layer

Only add this once a real internal symbol dataset exists:

- `TensorFlow / Keras`
- custom object detection or segmentation
- a plan-symbol dataset for outlets, fixtures, panels, duct nodes, and related elements

## Why not start with full TensorFlow

For both recruiter value and MVP velocity, the strongest path is:

- use a vision API first to validate the workflow
- use RAG plus a rule engine for code reasoning
- use a routing algorithm for something concrete and demonstrable

This is faster, more honest, and more realistic than claiming a custom vision model before a proper dataset exists.

TensorFlow still matters, but it fits better in phase two for:

- more stable symbol detection
- domain-specific room classification
- more precise segmentation

## Core modules

### 1. Plan intake

- plan upload
- project metadata
- plan versioning
- parsing job queue

### 2. Vision extraction

- room candidate detection
- fixture extraction
- wall, door, and opening extraction
- visual overlay preview

### 3. Code knowledge layer

- ingest FBC references
- ingest NEC references
- store metadata by chapter, topic, and trade
- support citation-ready retrieval

Note:

- `NEC` has licensing considerations. For a public demo, do not ingest proprietary code content without clear usage rights.

### 4. Rule engine

- trade-specific rule templates:
  - electrical
  - plumbing
  - mechanical
- deterministic checks
- structured constraint output

### 5. Routing engine

- pathfinding graph
- obstacle map
- start and end anchors
- candidate route scoring

### 6. Review UI

- plan viewer
- detected entities
- suggested rules
- generated route candidates
- issue list and warnings

### 7. Operations layer

- audit logs
- request logs
- job runs
- retry and failure states
- per-project processing status

## Suggested data model

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

## MVP stages recruiters will respect

Do not start with "generate a full Florida-compliant MEP plan." Start with a believable MVP:

### MVP-1: Plan review assistant

- upload one architectural floor plan
- detect basic room types
- retrieve relevant FBC and NEC guidance
- output a code-aware checklist by room

### MVP-2: Electrical draft helper

- detect bathrooms, kitchens, and room layout
- suggest outlet or GFCI positions through rule-based logic
- show a simple visual overlay

### MVP-3: Routing draft

- select two points
- generate a candidate path with A*
- display a path that avoids walls and forbidden areas

If those three flows work, the demo is already strong for this category of role.

## What can be reused from the current app

The current project already includes useful foundations:

- auth
- workspace or project scoping
- document ingestion
- an RAG-friendly backend
- audit trails
- request logs
- a PostgreSQL-ready foundation

Suggested mapping:

- `workspace` -> `project` or `client account`
- `documents` -> `plans`, `code references`, or `specifications`
- `chat` -> `review assistant panel`
- `request logs` -> `workflow and pipeline telemetry`
- `audit logs` -> `review actions and engineering traceability`

## What still needs to be built

- plan viewer with overlays
- detected room and fixture entities
- a formal code-reference ingestion flow
- rule evaluation results by room or system
- routing candidate visualization
- processing job timelines

## Positioning for a recruiter

The safest and strongest framing is:

`AI-assisted building plan review workspace that combines plan intake, code retrieval, and structured engineering review into one operational product.`

That is better than overselling it as "a fully autonomous MEP generator" before the domain logic, datasets, and review layers are truly production-grade.

## Interview-safe summary

If someone asks what this project demonstrates, answer:

`It demonstrates how I think about AI product engineering in a technical domain: start from a real workflow, layer in vision, retrieval, and deterministic logic where each one is appropriate, and make the system observable and reviewable instead of pretending the model alone solves everything.`
