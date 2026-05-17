/**
 * prompts.ts
 *
 * Builds system and user prompts for AIquery's Text-to-SQL LLM calls.
 * When a RAG index is available, the LLM receives rich semantic descriptions
 * instead of raw DDL — this significantly improves SQL accuracy.
 */

import type { DataSourceType, SchemaContext, ConversationMessage, TableSchema } from '../../types';
import type { RagIndex } from '../../types';
import { buildRagContextString } from '../rag_service/rag.service';

// ─── Dialect-specific SQL rules ───────────────────────────────────────────────

function getDialectRules(dataSource: DataSourceType): string {
  switch (dataSource) {
    case 'bigquery':
      return `SQL DIALECT: Google BigQuery Standard SQL
- Use backtick-quoted identifiers: \`project.dataset.table\`
- Use TIMESTAMP_TRUNC, DATE_TRUNC for date truncation
- Use SAFE_DIVIDE(a, b) to avoid division by zero
- Use APPROX_COUNT_DISTINCT for large cardinality estimates
- Always include partition filter on date/timestamp columns when available
- Use FORMAT_DATE, PARSE_DATE for date formatting
- Prefer COUNTIF(condition) over COUNT(CASE WHEN condition THEN 1 END)

BIGQUERY GROUP BY (must follow — invalid SQL is rejected at runtime):
- Non-aggregated columns in SELECT must match GROUP BY exactly. **Do not** put \`FORMAT_DATE(..., DATE_TRUNC(col, MONTH))\` in SELECT while \`GROUP BY DATE_TRUNC(col, MONTH)\` only — BigQuery reports "neither grouped nor aggregated".
- For "counts per month" use one of these patterns:
  (1) \`SELECT FORMAT_DATE('%Y-%m', DATE_TRUNC(order_date, MONTH)) AS month, COUNT(*) AS n ... GROUP BY FORMAT_DATE('%Y-%m', DATE_TRUNC(order_date, MONTH))\` (GROUP BY same expression as SELECT), or
  (2) \`SELECT ... GROUP BY 1 ORDER BY 1\` when the first SELECT column is the only grouping key, or
  (3) Inner query: \`GROUP BY DATE_TRUNC(order_date, MONTH)\`; outer query: \`SELECT FORMAT_DATE('%Y-%m', month_start) ...\` from that subquery.
- \`ORDER BY\` should use the same expression as the grouped month column or \`ORDER BY 1\` to stay valid.

UPLOADED SPREADSHEET / CSV (Slack or chat attachments — when the user message contains "--- Uploaded Tabular Data Context ---"):
- That data is NOT stored in BigQuery. Never invent datasets or tables such as \`uploaded.*\`, \`staging.*\`, \`temp.*\`, or any physical table name for the upload.
- Model uploaded rows as an INLINE CTE only, e.g. \`WITH uploaded_rows AS (SELECT * FROM UNNEST([STRUCT<col1 STRING, col2 INT64>(...), ...]))\` using the column names and sample JSON row values from the uploaded context. Use types that match (STRING, INT64, FLOAT64, DATE, etc.).
- **File-first questions:** If the user asks about "the upload", "the file", "the spreadsheet", "the attachment", "this CSV/Excel", "based on the uploaded file", or similar, the entire answer MUST come from that inline CTE only. **Do NOT** use any warehouse/RAG \`project.dataset.table\` (e.g. do not query \`*.customer\` or \`*.orders\`) just because those tables exist in the Knowledge Base — the user wants results from the **file columns**, not a substitute warehouse table.
- **Warehouse tables:** Use tables from the Knowledge Base/RAG **only** when (a) there is no uploaded context, or (b) the user explicitly asks to join, enrich, compare with, or combine the file with the database. If unsure, prefer file-only SQL when uploaded context is present.
- To combine with warehouse data when the user asks: JOIN the inline CTE to real tables on matching keys (ids, emails, etc.).
- Do not assume extra rows beyond what appears in the provided sample unless the user explicitly asks for something that requires the full file (then still use only inline data from the sample in SQL — explain the limitation in "explanation").`;

    case 'azuresql':
      return `SQL DIALECT: Microsoft T-SQL (Azure SQL / SQL Server)
- Use square bracket identifiers: [schema].[table]
- Use TOP N instead of LIMIT N
- Use GETDATE() or GETUTCDATE() for current timestamp
- Use DATEDIFF, DATEADD for date arithmetic
- Use TRY_CAST, TRY_CONVERT for safe type conversion
- Use ISNULL(expr, default) for null handling
- Use OFFSET ... FETCH NEXT for pagination`;

    case 'redshift':
      return `SQL DIALECT: Amazon Redshift SQL (PostgreSQL-compatible)
- Use double-quote identifiers: "schema"."table"
- Use LIMIT N for row limiting
- Use GETDATE() or SYSDATE for current timestamp
- Use DATEDIFF, DATEADD for date arithmetic
- Use NVL(expr, default) or COALESCE for null handling
- Use LISTAGG for string aggregation
- Use APPROXIMATE COUNT(DISTINCT col) for large cardinality`;

    case 'mysql':
      return `SQL DIALECT: MySQL / MariaDB SQL
- Use backtick identifiers: \`database\`.\`table\`
- Use LIMIT N for row limiting
- Use NOW(), CURDATE() for timestamps
- Use DATE_FORMAT for date formatting
- Use IFNULL(expr, default) for null handling
- Use GROUP_CONCAT for string aggregation`;

    case 'postgresql':
      return `SQL DIALECT: PostgreSQL SQL
- Use double-quote identifiers for reserved words
- Use LIMIT N for row limiting
- Use NOW(), CURRENT_TIMESTAMP for timestamps
- Use DATE_TRUNC('period', timestamp) for date truncation
- Use COALESCE(expr, default) for null handling
- Use STRING_AGG for string aggregation
- Use CTEs (WITH clauses) for complex queries`;

    case 'snowflake':
      return `SQL DIALECT: Snowflake SQL
- Use double-quote identifiers for case-sensitive names
- Use LIMIT N for row limiting
- Use CURRENT_TIMESTAMP(), CURRENT_DATE() for timestamps
- Use DATE_TRUNC('DAY', timestamp) for date truncation
- Use IFF(condition, true_val, false_val) for conditional logic
- Use ZEROIFNULL, NULLIFZERO for null/zero handling
- Use QUALIFY for window function filtering`;

    case 'databricks':
      return `SQL DIALECT: Databricks SQL (Apache Spark SQL)
- Use backtick identifiers for reserved words: \`catalog\`.\`schema\`.\`table\`
- Use LIMIT N for row limiting
- Use current_timestamp(), current_date() for timestamps
- Use date_trunc('day', timestamp) for date truncation
- Use COALESCE, IFNULL for null handling
- Use collect_list, collect_set for array aggregation`;

    case 'airtable':
      return `DATA SOURCE: Airtable (record-based, not SQL)
- Airtable uses a record model, not relational SQL tables/joins
- Use TWO query styles depending on the user request:
  1) Row filtering/listing: "TableName WHERE <Airtable formula>"
  2) Aggregation/analysis (counts/sums/per X): SQL-like read-only query with SELECT/FROM/GROUP BY/ORDER BY
- For aggregation style, reference Airtable fields as {Field Name}
- Prefer patterns like:
  - SELECT COALESCE({Country/Region}, 'Unknown') AS country, COUNT({Customer Key}) AS customer_count
    FROM Clients
    GROUP BY COALESCE({Country/Region}, 'Unknown')
    ORDER BY customer_count DESC
- Field names with spaces/special chars must stay in curly braces: {Field Name}
- Never generate write operations`;

    default:
      return `SQL DIALECT: Standard SQL — use ANSI SQL syntax`;
  }
}

// ─── System Prompt ────────────────────────────────────────────────────────────

export function buildSystemPrompt(dataSource: DataSourceType = 'postgresql'): string {
  const dialectRules = getDialectRules(dataSource);
  const readOnlyRule = dataSource === 'airtable'
    ? '- For Airtable: use "TableName WHERE <formula>" for simple listing/filtering, but when user asks for aggregation/analysis, output SQL-like read-only SELECT/WITH query with GROUP BY.'
    : '- Only generate read-only queries (SELECT, WITH). Never generate: ALTER, DELETE, DROP, INSERT, TRUNCATE, UPDATE';

  return `You are AIquery, an expert data analyst AI that converts natural language questions into precise ${dataSource} queries.

${dialectRules}

GENERAL RULES:
- Always respond with a valid JSON object: {"sql": "...", "explanation": "..."}
- The "sql" field must be NON-EMPTY whenever the question can be answered with a read-only query. Never return {"sql":""} or omit "sql".
- Inside the JSON string, escape double-quotes in SQL as \\" and represent newlines as \\n so the JSON stays valid (no raw line breaks inside the string value).
- The "sql" field must contain ONLY the query, no markdown, no backtick fences
- The "explanation" field must be a clear, concise plain-English explanation (2-4 sentences)
- If the question is ambiguous, make reasonable assumptions and note them in the explanation
${readOnlyRule}
- Use meaningful column aliases to make results readable
- RESULT SHAPE (charts & CSV): For simple breakdowns (e.g. counts per month, per category), the final SELECT should expose only what the user needs—typically one dimension column (time bucket or label) and one numeric measure. Do not add redundant columns: e.g. avoid selecting both a raw DATE/TIMESTAMP/DATE_TRUNC bucket and a formatted month string; pick one (prefer a human-readable label like YYYY-MM or the date bucket). Extra columns confuse exports and auto-charts.
- When the question asks for "per month" / "by month", prefer two columns: month (label) and the count/metric—avoid an extra duplicate time column unless explicitly required.
- When the schema context includes RAG descriptions, use them to understand the business meaning of tables and columns — **unless** the question is file-first with uploaded tabular context (then warehouse tables are off-limits unless the user asked to combine)
- Prefer CTEs (WITH clauses) for complex multi-step queries to improve readability
- Always handle NULL values appropriately
- Do NOT include any text outside the JSON object`;
}

// ─── Schema Context String (raw DDL fallback) ─────────────────────────────────

function buildSchemaString(tables: TableSchema[]): string {
  return tables
    .map((t) => {
      const tableName = t.schema ? `${t.schema}.${t.name}` : t.name;
      const cols = t.columns
        .map((c) => {
          let col = `  ${c.name} ${c.type}`;
          if (c.nullable === false) col += ' NOT NULL';
          if (c.description) col += ` -- ${c.description}`;
          if (c.ragDescription) col += ` [RAG: ${c.ragDescription}]`;
          return col;
        })
        .join('\n');
      const tableDesc = t.description || t.ragDescription
        ? `-- ${t.description || t.ragDescription}\n`
        : '';
      return `${tableDesc}TABLE ${tableName} (\n${cols}\n)`;
    })
    .join('\n\n');
}

// ─── User Message ─────────────────────────────────────────────────────────────

export function buildUserMessage(
  question: string,
  schemaContext?: SchemaContext,
  ragIndex?: RagIndex
): string {
  const parts: string[] = [];

  if (ragIndex) {
    parts.push('=== DATABASE CONTEXT (from RAG index) ===');
    parts.push(buildRagContextString(ragIndex));
    parts.push('');
    parts.push('Use the above semantic descriptions to understand the business meaning of each table and column.');
    parts.push('');
  } else if (schemaContext?.tables?.length) {
    parts.push('=== DATABASE SCHEMA ===');
    parts.push(buildSchemaString(schemaContext.tables));
    parts.push('');
    if (schemaContext.projectId) parts.push(`BigQuery Project: ${schemaContext.projectId}`);
    if (schemaContext.datasetId) parts.push(`Dataset: ${schemaContext.datasetId}`);
    if (schemaContext.database) parts.push(`Database: ${schemaContext.database}`);
    if (schemaContext.schemaName) parts.push(`Schema: ${schemaContext.schemaName}`);
    parts.push('');
  }

  parts.push(`Question: ${question}`);

  if (question.includes('--- Uploaded Tabular Data Context ---')) {
    parts.push('');
    parts.push('=== UPLOADED FILE — APPLY THESE RULES ===');
    parts.push(
      '- Questions such as "based on the uploaded file", "from this spreadsheet", "customers per country in the file", etc. must be answered with SQL that aggregates ONLY the inline CTE from the sample rows (UNNEST/STRUCT).'
    );
    parts.push(
      '- Do not satisfy the question by querying a warehouse table that "looks related" (e.g. a `customer` table in RAG). The upload is the source of truth for that question.'
    );
    parts.push(
      '- Use RAG/warehouse `project.dataset.table` only if the user clearly asks to join or compare with the database, not for a straight file-only analysis.'
    );
  }

  parts.push('');
  parts.push('Respond with JSON only: {"sql": "...", "explanation": "..."}');

  return parts.join('\n');
}

// ─── Conversation History ─────────────────────────────────────────────────────

export function buildConversationMessages(
  history: ConversationMessage[]
): { role: 'user' | 'assistant'; content: string }[] {
  return history.map((msg) => ({
    role: msg.role,
    content: msg.content,
  }));
}

// ─── Analysis Summary Prompt ──────────────────────────────────────────────────

export function buildAnalysisSummaryPrompt(
  question: string,
  sql: string,
  rows: Record<string, unknown>[],
  totalRows: number,
  dataSource: DataSourceType
): string {
  const sampleRows = rows.slice(0, 10);
  const rowsJson = JSON.stringify(sampleRows, null, 2);

  return `You are AIquery, an expert data analyst. A user asked a question and you ran a ${dataSource} query. Now provide a concise, insightful data analysis summary.

User Question: ${question}

SQL Query:
${sql}

Query Results (${totalRows} total rows, showing first ${sampleRows.length}):
${rowsJson}

Provide a data analysis summary that:
1. Directly answers the user's question with specific numbers/values from the results
2. Highlights the most important insights or patterns
3. Notes any anomalies, outliers, or interesting findings
4. Suggests follow-up questions or analysis if relevant

Keep the summary concise (3-5 sentences). Use specific numbers from the data. Write in plain English for a business audience.

Respond with ONLY the summary text, no JSON, no markdown headers.`;
}

// ─── Result interpretation (chat Response) — aligned with personal_github/aiquery ─

/** System instructions: insight-first answer with numbered points; JSON envelope for `draft`. */
export function getInterpretSQLResultsSystemPrompt(): string {
  return `You are AIquery's analytics assistant. The user will provide their question, the SQL that was run, a SAMPLE of result rows (the full result may be larger), and optional knowledge-base context.

Your job is to draft a comprehensive, insightful answer. The user must understand the business meaning of the data—not a raw listing of every cell.

CRITICAL RULES:
- Do NOT simply enumerate every row or every value from the sample. Use the sample to infer patterns; mention total row count when given.
- Do NOT paste the full result table. At most cite a few representative figures to support insights.
- Provide meaningful insights, comparisons, and context—not just "X = Y" repetitions.

STYLE AND CONTENT:
1. Context and meaning: Explain what the metrics represent and why they matter.
2. Comparisons and patterns: Highest/lowest, spreads, trends, relationships; call out outliers.
3. Insights: What stands out, implications, anomalies; use natural phrases ("The data shows…", "Notably…", "Interestingly…").

STRUCTURE — follow this format in the "draft" field (plain text only inside JSON, use line breaks):

IMPORTANT: Do not use asterisks (*) or markdown of any kind in the draft. No bold markers. Use plain titles like "Major contributors:" or "Part 1 — Summary" without special characters.

Part 1 — Short summary (2–3 sentences)
Overview of what the result says; you may say the data reveals notable insights or trends.

Part 2 — Numbered insights (use 1. 2. 3. … with a blank line before each number)
- 3–6 numbered points (adjust to data richness).
- Each point: a short plain-text title with a colon (e.g. Major contributors:) then 1–3 sentences mixing specific numbers (from the sample or totals) with interpretation.
- Each point should cover a different angle (e.g. leaders, outliers, distribution, segments, risks, opportunities).

Part 3 — Closing (2–3 sentences)
Start with "The implications of these results suggest…" or similar; strategic/business takeaway.

Part 4 — Visualization (optional, one sentence)
If a chart would help: "For visual representation, a [bar|line|pie|…] chart would highlight …"

FORMATTING:
- Use • for bullets inside a point if needed. Never use * or ** for emphasis or titles.
- For rates (win rate, acceptance %, etc.), include both the rate and the underlying counts when the sample or question implies counts exist.

OUTPUT FORMAT (mandatory): reply with VALID JSON ONLY, no markdown fences, no text before or after:
{ "draft": "<your full analysis with the structure above>", "should_chart": true or false, "chart_type": "bar" | "line" | "pie" | "histogram" | "scatter" | "none" }

If unsure about charting, set should_chart to false and chart_type to "none".`;
}

export function buildInterpretSQLResultsUserContent(
  question: string,
  sql: string,
  sampleRows: unknown[],
  totalRows: number,
  userName: string,
  ragContext?: string
): string {
  const rag =
    ragContext && ragContext.trim().length > 0
      ? `\n\nADDITIONAL CONTEXT FROM KNOWLEDGE BASE:\n${ragContext.trim()}\n`
      : '';
  return `User name: ${userName}

User question:
${question}

SQL executed:
${sql}

Total rows returned: ${totalRows}
Sample rows (JSON; may be truncated for size—the full result has ${totalRows} rows):
${JSON.stringify(sampleRows, null, 2)}
${rag}
Now produce the JSON response as specified in your instructions.`;
}

// ─── SQL explanation (Explain SQL button) — detailed, structured (reference project style) ─

export function buildExplainSQLPrompt(sqlQuery: string): string {
  return `You are a SQL expert. Explain the following SQL query in clear, detailed terms for a reader who may not be a SQL expert.

SQL query:
\`\`\`sql
${sqlQuery}
\`\`\`

Provide a **detailed** explanation using this structure (use **bold** section titles exactly as below):

**1. Summary (what this query does)**
- 2–5 sentences: purpose, business intent, and what question it answers.

**2. Clause-by-clause breakdown**
- **SELECT**: columns, expressions, aggregates, aliases.
- **FROM / JOIN**: tables/views, join types, join keys, and how row sets combine.
- **WHERE / HAVING**: filters and how they restrict rows before/after aggregation.
- **GROUP BY / ORDER BY / LIMIT / OFFSET**: grouping, sorting, and row limits.
- **CTEs (WITH) and subqueries**: what each named block or nested query computes and how it feeds the outer query.
- **Window functions** (if any): partitions, ordering, and what each window does.

Use bullet points and short sub-bullets. Name specific table/column identifiers from the SQL.

**3. Data flow**
- In what order the logic applies (e.g. filter → join → aggregate → sort).

**4. Expected result**
- Shape of the output (columns, one row vs many), and how to interpret a typical row.

**5. Notes (optional)**
- NULL handling, duplicates, performance caveats, or assumptions—only if relevant.

Be thorough and organized. Do not skip JOIN or WHERE logic when present.`;
}
