# Prototype

Prototype of a multi-agent AI system that supports Requirements Engineering. Users upload customer documents to a project, talk to a conversational **Analyst**, and let the system draft and review three requirements artifacts (`01`, `02`, `03`). A **Reviewer** and an **Explorer** comment on drafts; the user accepts, edits or rejects each comment and finally approves the artifact. All customer documents are injected in full into the prompt (no retrieval).

| Service  | Tech                                                    | Port |
|----------|---------------------------------------------------------|------|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS   | 3000 |
| Backend  | FastAPI, Python 3.11, async SQLAlchemy, Alembic, LiteLLM | 8000 |
| Database | PostgreSQL 15                                           | 5433 (host) |
| LLM      | Anthropic Claude (API key required)                     | —    |

## Quick Start

You only need **Docker** (with Docker Compose) and an **Anthropic API key**. Node.js and Python are not required.

1. Install Docker Desktop (or, on macOS, [Colima](https://github.com/abiosoft/colima) plus the Docker CLI) and make sure it is running.
2. Get an API key from the [Anthropic Console](https://console.anthropic.com/) (`sk-ant-…`).
3. Clone the repository and configure it:

   ```bash
   git clone https://github.com/markus-222/sparring-with-ai-digital-appendix.git
   cd sparring-with-ai-digital-appendix/3_artifact/source
   cp .env.example .env
   ```

4. Open `.env` and replace the placeholder in `ANTHROPIC_AUTH_TOKEN=your-token-here` with your key. Leave everything else as it is; `ANTHROPIC_MODEL` sets the model used by all roles.
5. Build and start everything (the first build takes a few minutes):

   ```bash
   docker compose up -d --build
   ```

6. Open http://localhost:3000, choose a username and a password (at least 8 characters) to create an account, and log in.

The database schema is created automatically on start. The ports 3000, 8000 and 5433 must be free.

### First steps in the app

1. Create a project.
2. Upload one or more customer documents (PDF, DOCX, TXT or Markdown). They are injected in full into every prompt, so keep them reasonably short.
3. Chat with the Analyst, or use a starter prompt, to create a draft of artifact `01`. Drafting and reviewing run in the background; progress is shown in the chat.
4. Open the draft, request a review, and work through the Reviewer's and Explorer's comments (accept, edit, reject, or ask in the chat).
5. Approve the artifact, then continue with `02` and `03`.

### Stopping and resetting

```bash
docker compose stop                # stop, keep data
docker compose up -d               # start again
docker compose down -v             # stop and delete all data (fresh database)
```

### If something does not work

| Problem | Fix |
|---------|-----|
| Port already in use | Stop the other service using 3000, 8000 or 5433. |
| App starts, but chat or drafts fail | The key in `.env` is missing or invalid. Fix it and run `docker compose up -d` again; `docker compose logs backend` shows the error. |
| Model not found | Set `ANTHROPIC_MODEL` in `.env` to a model your key can use and run `docker compose up -d` again. |

## Architecture

```
backend/app/
├── api/v1/      REST routes
├── services/    business logic: chat, runs, approvals, edits, documents
├── agents/      Analyst, Reviewer, Explorer, and their prompts
├── infra/       LLM client
├── models/      database models
├── schemas/     request and response schemas
├── migrations/  database migrations
└── tests/
frontend/        Next.js app
```

| Role | Responsibility |
|------|----------------|
| **Analyst** | The single conversational agent. Answers project questions with citations, writes drafts, and acts through guarded tools (`start_draft`, `start_review`, `read_artifact`, `edit_artifact`, …). |
| **Reviewer** | Critical review of an artifact: errors, contradictions, missing sources, shallow analysis. Writes comments only. |
| **Explorer** | Other perspectives: missing stakeholders, alternative framings, unspoken assumptions. Writes comments only. |

Drafting and reviewing run as background runs, one per project at a time.

## License

Submitted as part of a master thesis. All rights reserved by the author unless stated otherwise.
