<p align="center">
  <img src="docs/assets/aiquery-logo.png" alt="AIquery logo" width="220" />
</p>

<h1 align="center">AIquery</h1>

<p align="center">
  Ask questions in natural language. Get SQL, results, charts, and answers from your connected data.
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#supported-data-sources">Data sources</a> ·
  <a href="#quick-start">Quick start</a> ·
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
- **Visualizations** — Chart generation via the Python visualization pipeline
- **Team workspaces** — Shared workspaces, members, and per-workspace configuration
- **Integrations** — Slack and Microsoft Teams bots for querying in chat
- **Chat history** — Question-level history with selective deletion

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
| Backend | Node.js, Express, TypeScript |
| Frontend | React, Vite, TypeScript |
| App database | PostgreSQL |
| LLM providers | OpenAI, Google Gemini, Anthropic |
| Integrations | Slack, Microsoft Teams |
| Charts | Python (matplotlib / seaborn) |

## Quick start

### Prerequisites

- **Node.js** 18+
- **pnpm**
- **PostgreSQL** 12+
- **Python** 3.8+ (for chart generation)
- At least one **LLM API key** (OpenAI or Gemini)

### 1. Clone and install

```bash
git clone https://github.com/YOUR_ORG/aiquery.git
cd aiquery
pnpm install
cd frontend && pnpm install && cd ..
```

### 2. Python visualization dependencies

```bash
# Unix / macOS
chmod +x backend/visualization/setup_python_deps.sh
./backend/visualization/setup_python_deps.sh

# Windows
backend\visualization\setup_python_deps.bat
```

### 3. Database

```sql
CREATE DATABASE aiquery;
```

### 4. Environment

Copy or create `.env` in the repository root (never commit real secrets):

```env
# LLM (at least one)
OPENAI_API_KEY=
# GEMINI_API_KEY=

# PostgreSQL
DATABASE_URL=postgresql://user:pass@localhost:5432/aiquery

# Auth — use a long random value in production
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=7d

# Server
PORT=3000

# Optional: Slack / Teams
# SLACK_BOT_TOKEN=
# SLACK_SIGNING_SECRET=
# TEAMS_APP_ID=
# TEAMS_APP_PASSWORD=

# Optional: site admin (comma-separated user IDs)
# ADMIN_USER_IDS=1
```

Data source credentials (BigQuery keys, warehouse passwords, etc.) are configured in the UI and stored per user/workspace — not in this file.

### 5. Run in development

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

### Production build

```bash
pnpm build
pnpm start
```

Frontend static build:

```bash
cd frontend
pnpm build
```

Docker deployment is documented in [`docs/CLOUD_RUN_DEPLOYMENT.md`](docs/CLOUD_RUN_DEPLOYMENT.md) and [`deployment/`](deployment/).

## Project structure

```text
aiquery/
├── backend/           # Express API, services, middleware
│   ├── middleware/    # Auth (JWT), validation
│   ├── routes/
│   ├── services/      # data_sources, llm, query, rag_service, slack, …
│   ├── visualization/ # Python chart scripts
│   └── server.ts
├── frontend/          # React + Vite UI
│   └── src/
├── docs/              # Developer manual, source guides, deployment
├── deployment/        # Docker and production artifacts
├── CONTRIBUTING.md
├── SECURITY.md
└── README.md
```

See [`docs/DEVELOPER_MANUAL.md`](docs/DEVELOPER_MANUAL.md) for architecture diagrams, database schema, and extension guides.

## Documentation

| Topic | Location |
|-------|----------|
| Developer manual | [`docs/DEVELOPER_MANUAL.md`](docs/DEVELOPER_MANUAL.md) |
| Data source setup | [`docs/data_source/`](docs/data_source/) |
| RAG behavior | [`docs/rag/`](docs/rag/) |
| Slack integration | [`docs/slack/`](docs/slack/) |
| Payments / Stripe | [`docs/PAYMENT_SYSTEM.md`](docs/PAYMENT_SYSTEM.md) |
| Cloud Run deploy | [`docs/CLOUD_RUN_DEPLOYMENT.md`](docs/CLOUD_RUN_DEPLOYMENT.md) |

## Contributing

We welcome issues, bug reports, and pull requests. Please read [**CONTRIBUTING.md**](CONTRIBUTING.md) for:

- Development environment setup
- Architecture overview and where to add features
- How to choose and scope work
- PR and review expectations

## Security

If you discover a vulnerability, please read [**SECURITY.md**](SECURITY.md) for our reporting scope and process. **Do not** open public GitHub issues for security-sensitive findings.

## Troubleshooting

| Symptom | What to check |
|---------|----------------|
| `EADDRINUSE` on port 3000 | Stop the existing process or change `PORT` |
| Connection test fails | Credentials, network, and IAM/database permissions |
| RAG creation fails | Table/view access and LLM API key |
| Slack actions fail | Bot token scopes and workspace app installation |

## License

This project is licensed under the [MIT License](LICENSE).
