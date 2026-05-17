# Contributing to AIquery

Thank you for your interest in contributing. This guide covers everything you need to get started: setting up your dev environment, understanding the architecture, deciding what to build, and getting your pull request merged.

## Table of contents

1. [Code of conduct](#code-of-conduct)
2. [Ways to contribute](#ways-to-contribute)
3. [Development environment](#development-environment)
4. [Architecture overview](#architecture-overview)
5. [Project layout](#project-layout)
6. [Deciding what to build](#deciding-what-to-build)
7. [Development workflow](#development-workflow)
8. [Coding standards](#coding-standards)
9. [Testing](#testing)
10. [Pull requests](#pull-requests)
11. [Getting help](#getting-help)

---

## Code of conduct

Be respectful and constructive in issues, reviews, and discussions. Harassment and discriminatory behavior are not tolerated. Maintainers may remove content or block participants who violate these expectations.

---

## Ways to contribute

You do not need to write code to help:

- **Report bugs** — Include reproduction steps, expected vs actual behavior, and environment details.
- **Suggest features** — Describe the use case and why it fits AIquery’s scope.
- **Improve documentation** — Fix typos, clarify setup steps, or add source-specific notes under `docs/`.
- **Submit code** — Bug fixes, new data sources, LLM providers, UI improvements, tests, and performance work.

Before large features, open an issue or discuss in an existing one so maintainers can align on approach and avoid duplicate work.

---

## Development environment

### Prerequisites

| Tool | Version / notes |
|------|-----------------|
| Node.js | 18+ |
| pnpm | Latest recommended |
| PostgreSQL | 12+ |
| Python | 3.8+ (visualization scripts) |
| Git | For branching and PRs |

### Setup steps

1. **Fork and clone** the repository, then create a branch:

   ```bash
   git clone https://github.com/YOUR_USERNAME/aiquery.git
   cd aiquery
   git checkout -b feature/short-description
   ```

2. **Install dependencies**:

   ```bash
   pnpm install
   cd frontend && pnpm install && cd ..
   ```

3. **Python chart dependencies**:

   ```bash
   # Unix / macOS
   ./backend/visualization/setup_python_deps.sh

   # Windows
   backend\visualization\setup_python_deps.bat
   ```

4. **Create the database**:

   ```sql
   CREATE DATABASE aiquery;
   ```

5. **Configure `.env`** at the repo root (see [README.md](README.md#quick-start)). Never commit `.env` or real API keys.

6. **Start dev servers** (two terminals):

   ```bash
   # Terminal 1 — backend (http://localhost:3000)
   pnpm dev

   # Terminal 2 — frontend (http://localhost:5173)
   cd frontend && pnpm dev
   ```

7. **Optional — site admin**: Add your numeric user ID to `ADMIN_USER_IDS` in `.env` and restart the backend to access `/admin`. Find your ID via `GET /api/auth/me` after sign-in.

For deeper reference, see [`docs/DEVELOPER_MANUAL.md`](docs/DEVELOPER_MANUAL.md).

---

## Architecture overview

AIquery is a full-stack app: a React SPA talks to an Express API, which orchestrates LLMs, stores app state in PostgreSQL, and runs queries against **external** data sources using credentials saved per user/workspace.

```
┌─────────────────┐
│   Web Browser   │
│   (React/Vite)  │
└────────┬────────┘
         │ HTTP + JWT (Bearer)
┌────────▼─────────────────────────┐
│      Express.js (server.ts)       │
│  authenticateToken / requireAdmin   │
│  Routes: /api/chat, /api/rag, …    │
│  Services: llm, query, rag, …       │
└────────┬───────────────────────────┘
         │
    ┌────┴────┬──────────────┬─────────────┐
    │         │              │             │
┌───▼───┐ ┌──▼──┐    ┌─────▼─────┐  ┌────▼────┐
│PostgreSQL│ │LLM APIs│ │Data Sources│ │Python   │
│ (app DB) │ │        │ │(customer)  │ │charts   │
└─────────┘ └───────┘ └───────────┘ └─────────┘
```

### Main request flows

**Chat / query**

```
User question → POST /api/chat → LLM (SQL generation)
→ sqlSafety check → data source adapter → results
→ optional visualization → JSON response
```

**RAG knowledge base**

```
UI selection → schema discovery → LLM descriptions
→ JSON index under backend/rag-indices/
→ retrieval during chat for grounded SQL
```

**Authentication**

- JWT in `Authorization: Bearer <token>`
- Middleware: `backend/middleware/auth.ts` (`authenticateToken`, `requireAdmin`)
- Protected routes set `req.userId` from the verified token

### Read-only SQL guard

Before executing generated SQL, the backend uses `backend/services/query/sqlSafety.ts` (`isProhibitedSQL`) to block statements that **start with** prohibited keywords (`ALTER`, `DELETE`, `DROP`, `INSERT`, `TRUNCATE`, `UPDATE`). This is defense-in-depth; database credentials should still use least-privilege roles.

---

## Project layout

| Path | Responsibility |
|------|----------------|
| `backend/server.ts` | HTTP server, route mounting |
| `backend/middleware/` | Auth, validation |
| `backend/services/data_sources/` | Per-source connection, schema, execution |
| `backend/services/llm/` | Providers, prompts, SQL generation |
| `backend/services/query/` | Execution orchestration, cache, chat history |
| `backend/services/rag_service/` | Schema discovery, KB index lifecycle |
| `backend/services/connection/` | Persisted connection configs |
| `backend/services/workspace/` | Workspaces and membership |
| `backend/services/slack/`, `microsoft-teams/` | Bot integrations |
| `backend/rag-indices/` | On-disk RAG JSON indexes (per user/workspace) |
| `frontend/src/components/` | Pages: chat, RAG, connections, settings, admin |
| `frontend/src/contexts/`, `hooks/`, `utils/` | Shared client logic |
| `docs/` | Extended documentation |

---

## Deciding what to build

Good first contributions:

- Documentation fixes and clearer error messages
- Tests for `sqlSafety`, parsers, or small pure functions
- UI polish that matches existing components and CSS
- Bug fixes with a clear reproduction case

Larger efforts (coordinate via issue first):

| Goal | Touch points |
|------|----------------|
| New data source | `backend/services/data_sources/`, `schema-discovery.ts`, `ConnectionConfigModal.tsx`, `/api/test-connection` |
| New LLM provider | `backend/services/llm/`, factory in `llm.service.ts`, settings UI |
| New API endpoint | `backend/server.ts` or `backend/routes/`, service layer, frontend `axios` calls |
| RAG improvements | `backend/services/rag_service/`, `docs/rag/` |
| Slack / Teams | `backend/services/slack/`, `backend/services/microsoft-teams/` |

**Out of scope** for most PRs unless discussed:

- Unrelated refactors or mass formatting-only changes
- Committing secrets, `.env` files, or personal `rag-indices/` / `frontend/temp/` data
- Breaking API changes without migration notes

---

## Development workflow

1. Sync with `main` (or the default branch) before starting.
2. Create a focused branch: `feature/`, `fix/`, or `docs/`.
3. Make incremental commits with clear messages.
4. Run tests and manual smoke checks (see below).
5. Update docs if behavior, env vars, or APIs change.
6. Open a PR against the default branch and fill out the description template (if present).

### Commit messages

Use the imperative mood and a short subject line:

- `Add Snowflake connection timeout option`
- `Fix chat history delete for grounded messages`
- `Document Databricks REST fallback in data_source guide`

Reference issue numbers when applicable: `Fix RAG index path collision (#42)`.

---

## Coding standards

- **TypeScript** everywhere in `backend/` and `frontend/src/`.
- **Match existing style** — naming, file placement, and patterns in neighboring code.
- **Minimal scope** — only change what the PR needs; avoid drive-by refactors.
- **No secrets in code** — use environment variables; data source secrets belong in the DB via the connection UI.
- **Auth on sensitive routes** — use `authenticateToken` (and `requireAdmin` where appropriate).
- **SQL safety** — route execution through `isProhibitedSQL` / `isSafeToRun` for user-generated SQL.
- **User scoping** — queries for `connection_configs`, chat history, and RAG assets must filter by `req.userId` (and workspace membership where applicable).

---

## Testing

```bash
# From repository root
pnpm test
```

Jest is configured in `jest.config.ts` to match `**/tests/**/*.test.ts`. Add tests alongside new logic when practical, especially for:

- `backend/services/query/sqlSafety.ts`
- Parsers and pure helpers
- API contracts you introduce or change

If no automated test exists yet, describe manual verification in your PR (e.g. “Tested connection to local Postgres, ran chat query, saw table in UI”).

---

## Pull requests

### Before opening

- [ ] Branch is up to date with the default branch
- [ ] `pnpm test` passes (or you explain failures)
- [ ] No `.env`, keys, or personal data in the diff
- [ ] README / `docs/` updated if user-facing behavior changed

### PR description

Include:

1. **What** changed (one paragraph)
2. **Why** (issue link or motivation)
3. **How to test** — steps a reviewer can follow
4. **Screenshots** for UI changes

### Review process

- Maintainers will review for correctness, security (tenant isolation, auth), and scope.
- Address feedback with new commits or fixup commits; avoid force-pushing unless asked.
- Once approved, a maintainer merges. Squash or merge style depends on repository settings.

### Security issues

Do **not** file public issues for vulnerabilities. See [SECURITY.md](SECURITY.md).

---

## Getting help

1. Search [existing issues](https://github.com/YOUR_ORG/aiquery/issues).
2. Read [`docs/DEVELOPER_MANUAL.md`](docs/DEVELOPER_MANUAL.md) and topic folders under `docs/`.
3. Open a **question** or **bug** issue with full context if you are stuck.

Replace `YOUR_ORG` with the actual GitHub organization or username when the repository is published.

Thank you for helping make AIquery better for everyone.
