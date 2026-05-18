<p align="center">
  <img src="docs/assets/aiquery-logo.png" alt="AIquery logo" width="220" />
</p>

<h1 align="center">The first free and open source Text to SQL platform for enterprises production. Query your data from Slack Channel in seconds.</h1>

<p align="center">
  Ask questions in natural language. Get SQL, results, charts, and answers from your connected data.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#supported-data-sources">Data sources</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="#project-structure">Structure</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="SECURITY.md">Security</a>
</p>

---

AIquery is an open-source, full-stack application for querying connected data sources with natural language. It generates SQL (or SQL-like queries where needed), executes read-only queries against your databases and warehouses, and returns narrative answers, data tables, and charts.

Use it self-hosted for your team, or extend it with new connectors, LLM providers, and integrations.

## Features

- **Natural-language chat → SQL** — Interpret questions, generate queries, run them, and summarize results
- **RAG knowledge bases** — Build schema-aware indexes from discovered tables and columns to improve SQL quality
- **Multi-source support** — Connect warehouses, SQL databases, Airtable, and more from the UI
- **Charts** — LLM picks chart type and fields; charts render server-side as PNG (TypeScript + SVG, no Python setup)
- **Team workspaces** — Shared workspaces, members, and per-workspace configuration
- **Integrations** — Slack and Microsoft Teams for querying in chat
- **Chat history** — Question-level history with selective deletion
- **Billing (optional)** — Stripe subscriptions and plan limits when configured

## Supported data sources

| Source | Notes |
|--------|--------|
| Google BigQuery | Service account or inline JSON credentials |
| Snowflake | Connection test, schema discovery, query execution |
| Amazon Redshift | |
| Azure SQL | |
| MySQL | |
| PostgreSQL | |
| Databricks | REST fallback and platform-specific options |
| Airtable | Cached rows; aggregation-style SQL-like queries |

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Node.js 18+, Express, TypeScript |
| Frontend | React 18, Vite, TypeScript |
| App database | PostgreSQL (auto-created on first startup) |
| LLM providers | OpenAI, Google Gemini, Anthropic |
| Charts | TypeScript — LLM chart plan + SVG + `sharp` → PNG |
| Integrations | Slack, Microsoft Teams |
| Payments (optional) | Stripe |

## Quick start

### Prerequisites

- **Node.js** 18+
- **pnpm**
- **PostgreSQL** 12+ (running locally or reachable over the network)
- At least one **LLM API key** (`OPENAI_API_KEY`, `GEMINI_API_KEY`, and/or Anthropic via workspace settings)

No Python installation is required.

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/aiquery.git
cd aiquery
pnpm install
cd frontend && pnpm install && cd ..
```

### 2. PostgreSQL

Install and start PostgreSQL. On first backend startup, AIquery will:

1. Create the `aiquery` database if it does not exist (`ensureDatabaseExists`)
2. Create and migrate all application tables (`initializeDatabase`)

Set `DB_AUTO_CREATE=false` if your host already provisions the database (e.g. managed Postgres).

### 3. Environment

Copy or create `.env` in the repository root (never commit real secrets):

```env
# LLM (at least one for default provider)
OPENAI_API_KEY=
# GEMINI_API_KEY=

# PostgreSQL (database + tables auto-created on first `pnpm dev` unless DB_AUTO_CREATE=false)
DATABASE_URL=postgresql://user:pass@localhost:5432/aiquery
# DB_AUTO_CREATE=true
# DB_MAINTENANCE_DATABASE=postgres

# Auth — use a long random value in production
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d

# Server
PORT=3000
FRONTEND_URL=http://localhost:5173

# Optional: Slack / Teams
# SLACK_BOT_TOKEN=
# SLACK_SIGNING_SECRET=
# TEAMS_APP_ID=
# TEAMS_APP_PASSWORD=

# Optional: Stripe
# STRIPE_SECRET_KEY=
# STRIPE_WEBHOOK_SECRET=

# Optional: site admin (comma-separated numeric user IDs)
# ADMIN_USER_IDS=1
```

Data source credentials (BigQuery keys, warehouse passwords, etc.) are configured in the UI and stored per user/workspace — not in this file.

### 4. Run in development

Terminal 1 — backend:

```bash
pnpm dev
```

Terminal 2 — frontend:

```bash
cd frontend
pnpm dev
```

| Service | URL |
|---------|-----|
| Backend API | http://localhost:3000 |
| Frontend | http://localhost:5173 |

Sign up in the UI, connect a data source, and open the chat workspace.

### Production build

```bash
pnpm build
pnpm start
```

Frontend static build (served by the backend when `frontend/dist` exists):

```bash
cd frontend
pnpm build
```

Docker deployment: [`docs/CLOUD_RUN_DEPLOYMENT.md`](docs/CLOUD_RUN_DEPLOYMENT.md) and [`deployment/`](deployment/).

## Project structure

```text
aiquery/
├── backend/
│   ├── server.ts              # Express entry — routes, webhooks, startup
│   ├── middleware/            # JWT auth, optional auth, admin guard
│   ├── routes/                # Stripe router and related route modules
│   ├── helpers/               # LLM config helpers, shared utilities
│   ├── lib/                   # Cross-cutting helpers (e.g. execution steps)
│   ├── types/                 # Shared TypeScript types
│   ├── services/
│   │   ├── connection/        # Saved connections, LLM settings, Slack/Teams config
│   │   ├── data_sources/      # BigQuery, Snowflake, Postgres, Airtable, …
│   │   ├── llm/               # Providers, prompts, SQL generation
│   │   ├── query/             # Execution, cache, chat history
│   │   ├── rag_service/       # Schema discovery, KB indexes
│   │   ├── visualization/     # LLM chart plans, SVG render, PNG export
│   │   ├── slack/             # Events, interactions, file uploads
│   │   ├── workspace/         # Workspaces and membership
│   │   ├── user_account/      # Users, auth, subscriptions, usage
│   │   ├── payment/           # Stripe customer records
│   │   ├── email/             # Transactional email (Resend)
│   │   └── crawler/           # Website content for onboarding flows
│   └── rag-indices/           # On-disk RAG JSON indexes (per user/workspace)
├── frontend/
│   ├── public/                # Static assets (logos, marketing images)
│   └── src/
│       ├── components/        # Chat, RAG, connections, settings, admin, landing
│       ├── contexts/          # React context providers
│       ├── hooks/
│       └── utils/
├── docs/                      # Guides (data sources, RAG, Slack, deploy, …)
│   └── assets/                # Brand assets (e.g. README logo)
├── deployment/                # Docker and production artifacts
├── CONTRIBUTING.md
├── SECURITY.md
├── LICENSE
└── README.md
```

### Where to look for common tasks

| Task | Start here |
|------|------------|
| Add a data source | `backend/services/data_sources/`, `backend/services/rag_service/schema-discovery.ts`, `frontend/src/components/ConnectionConfigModal.tsx` |
| Change SQL generation | `backend/services/llm/` |
| Read-only SQL guard | `backend/services/query/sqlSafety.ts` |
| Chart behavior | `backend/services/visualization/` |
| DB schema / migrations | `backend/services/database.ts` |
| Auth | `backend/middleware/auth.ts`, `backend/services/user_account/` |

See [`docs/DEVELOPER_MANUAL.md`](docs/DEVELOPER_MANUAL.md) for architecture diagrams and deeper extension guides.

## Documentation

| Topic | Location |
|-------|----------|
| Developer manual | [`docs/DEVELOPER_MANUAL.md`](docs/DEVELOPER_MANUAL.md) |
| Database | [`docs/DATABASE_IMPLEMENTATION.md`](docs/DATABASE_IMPLEMENTATION.md) |
| Data source setup | [`docs/data_source/`](docs/data_source/) |
| RAG behavior | [`docs/rag/`](docs/rag/) |
| Slack integration | [`docs/slack/`](docs/slack/) |
| Payments / Stripe | [`docs/PAYMENT_SYSTEM.md`](docs/PAYMENT_SYSTEM.md) |
| Cloud Run deploy | [`docs/CLOUD_RUN_DEPLOYMENT.md`](docs/CLOUD_RUN_DEPLOYMENT.md) |

## Contributing

We welcome issues, bug reports, and pull requests. Please read [**CONTRIBUTING.md**](CONTRIBUTING.md) for development setup, architecture notes, and PR expectations.

## Security

If you discover a vulnerability, please read [**SECURITY.md**](SECURITY.md) for our reporting scope and process. **Do not** open public GitHub issues for security-sensitive findings.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| `EADDRINUSE` on port 3000 | Stop the existing process or change `PORT` |
| Database does not exist / connection refused | PostgreSQL is running; `DATABASE_URL` or `DB_*` credentials; DB user has `CREATEDB` if using auto-create |
| Tables missing / Slack init warnings | Restart backend after Postgres is up; check logs for `[DB]` errors |
| Connection test fails | Credentials, network, and IAM/database permissions for the target source |
| RAG creation fails | Table/view access and LLM API key |
| Charts not appearing | Query returned tabular rows; check backend logs under `visualization` |
| Slack actions fail | Bot token scopes and workspace app installation |

## License

This project is licensed under the [MIT License](LICENSE).

Copyright © 2026 [Liai Tech Corporation](LICENSE).
