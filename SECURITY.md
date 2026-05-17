# Security Policy

## Load-bearing security boundary

AIquery’s critical security boundary is **authenticated per-account and per-workspace isolation**.

Every code path that reads or writes sensitive tenant data must ensure the authenticated principal (JWT `userId`, and workspace membership where shared resources apply) is authorized for **that** resource only. This boundary protects:

| Asset | Storage / location |
|-------|---------------------|
| Data source credentials | `connection_configs` (PostgreSQL) |
| Third-party tokens (Slack, Teams) | `third_party_connections` |
| LLM API keys (per user/workspace) | `llm_settings` |
| RAG knowledge base indexes | `backend/rag-indices/` (filesystem) |
| Chat history and sessions | `chat_history`, `chat_sessions` |
| Query results returned to clients | API responses |

A failure of this boundary—for example, an IDOR that lets user A load user B’s connection config, RAG index, or chat history—is treated as a **critical** vulnerability because it can expose customer database credentials and business data.

Supporting controls (important but secondary to isolation):

- **JWT authentication** (`authenticateToken` in `backend/middleware/auth.ts`) on protected API routes
- **Read-only SQL guard** (`isProhibitedSQL` in `backend/services/query/sqlSafety.ts`) before executing LLM-generated SQL against connected sources
- **Admin allowlist** via `ADMIN_USER_IDS` for site-admin routes

Operators should still use least-privilege database roles on connected warehouses; the SQL guard is not a substitute for credential scoping at the database layer.

---

## Supported versions

Security fixes are applied to the **default branch** (`main` or as labeled by maintainers). Older releases may not receive backports unless explicitly stated in a security advisory.

---

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

### In scope

Reports we want to hear about include:

- **Cross-tenant access** — Accessing another user’s or workspace’s connections, RAG indexes, chat history, API keys, or query results without authorization
- **Authentication bypass** — Obtaining a valid session or calling protected APIs without a legitimate JWT
- **Privilege escalation** — Non-admin users gaining site-admin capabilities (`ADMIN_USER_IDS` bypass)
- **Credential disclosure** — Server or API leaking `connection_configs`, third-party tokens, or LLM keys to unauthorized callers
- **Unsafe SQL execution** — Executing prohibited DDL/DML (e.g. `DROP`, `DELETE`, `UPDATE`) through AIquery’s query execution path when the read-only guard should block it
- **Webhook / integration abuse** — Slack or Teams endpoints accepting forged or unsigned requests that lead to unauthorized actions (where signing secrets are configured)

Include steps to reproduce, affected endpoints or UI flows, and impact (what data or action becomes possible).

### Out of scope

The following are generally **not** accepted as vulnerabilities in this project:

- Issues in **third-party services** (OpenAI, Google Cloud, Snowflake, Stripe, etc.) — report to those vendors
- **Social engineering** or physical access to a deployer’s machine
- **Denial of service** without demonstrated sustained impact on other tenants (low-severity DoS may be deferred)
- Findings that require the reporter to **control the victim’s `.env`** or production deployment secrets
- **Missing security headers** or TLS configuration on a self-hosted deployment the reporter does not operate
- Vulnerabilities in **dependencies** already fixed in a newer release (please still report; we may bump versions)
- **LLM prompt injection** that only affects the requesting user’s own connected data (document as a product risk; report if it enables cross-tenant access or credential exfiltration via the server)
- Reports against **demo/staging** environments you do not own, without prior written permission

### How to report

1. Email the maintainers at **security@YOUR_DOMAIN** (replace with your published security contact before open-sourcing).
2. Use subject line: `[AIquery Security] Short summary`
3. Provide:
   - Description and impact
   - Steps to reproduce (minimal PoC preferred)
   - Affected version or commit SHA
   - Your name/handle for credit (optional)

If you have no security contact yet, open a **private** GitHub Security Advisory (Repository → Security → Advisories) once the repository is on GitHub.

### What to expect

- **Acknowledgment** within a few business days
- **Triage** to confirm scope against this policy
- **Fix or mitigation** timeline communicated when confirmed
- **Coordinated disclosure** — we ask that you do not publish details until a fix is released or we agree on a timeline

We appreciate responsible disclosure and will credit reporters in release notes when permitted.

---

## Secure deployment reminders for operators

These are operational expectations, not code guarantees:

- Set a strong, unique `JWT_SECRET` in production
- Never commit `.env`, service account JSON, or `rag-indices/` with real customer data
- Restrict network access to PostgreSQL and the API
- Use least-privilege IAM/database users for each connected source
- Configure Slack `SLACK_SIGNING_SECRET` and verify Teams webhook authenticity in production
- Keep dependencies updated (`pnpm audit` / Dependabot)

---

## Security-related contributions

Code changes that touch auth, connection storage, RAG file paths, or query execution should:

1. Preserve user/workspace scoping on all reads and writes
2. Keep `authenticateToken` (or equivalent) on sensitive routes
3. Route SQL execution through `sqlSafety` helpers
4. Include tests when adding new authorization checks

See [CONTRIBUTING.md](CONTRIBUTING.md) for the full contribution workflow.
