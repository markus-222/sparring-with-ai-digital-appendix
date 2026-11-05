# Artifact

The prototype described in Chapter 5 of the thesis: a multi-agent system with the agent roles Analyst, Reviewer, and Explorer, working on a shared Project Sandbox. The code is the version used in the Round 2 sessions.

| Folder | Content |
|---|---|
| [`source/`](source/) | Source code (FastAPI backend, Next.js frontend, PostgreSQL). [`source/README.md`](source/README.md) explains how to run it with Docker and an Anthropic API key |
| [`agent_instructions/`](agent_instructions/) | Instructions of the Analyst for the chat (`analyst_chat.md`) and for drafting (`analyst_draft.md`), of the Reviewer, and of the Explorer; copies of `source/backend/app/agents/prompts/` |
| [`structure_files/`](structure_files/) | Structure files of the three work products (problem and scope definition, stakeholder analysis, open issues and questions; in the code `01.md`–`03.md`) and their template entries (`artifact_templates.py`) |
