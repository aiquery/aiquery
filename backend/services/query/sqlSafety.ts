/**
 * sqlSafety.ts
 * Validates that SQL does not contain prohibited DDL/DML commands before execution.
 * Only blocks when a statement *starts* with a prohibited keyword (so SELECT updated_at is allowed).
 */

const PROHIBITED_KEYWORDS = ['alter', 'delete', 'drop', 'insert', 'truncate', 'update'] as const;

/**
 * Strip single-line (--) and multi-line (/* *\/) comments from the start of a string.
 */
function stripLeadingComments(sql: string): string {
  let s = sql.trim();
  while (true) {
    const before = s;
    // Single-line comment
    s = s.replace(/^\s*--[^\n]*\n?/i, '').trim();
    // Multi-line comment
    s = s.replace(/^\s*\/\*[\s\S]*?\*\//, '').trim();
    if (s === before) break;
  }
  return s;
}

/**
 * Returns the first token (keyword/identifier) of a SQL statement, lowercased.
 */
function firstToken(statement: string): string {
  const stripped = stripLeadingComments(statement);
  const match = stripped.match(/^\s*(\w+)/);
  return match ? match[1].toLowerCase() : '';
}

/**
 * Checks if the SQL contains any prohibited command as a statement starter.
 * Prohibited: alter, delete, drop, insert, truncate, update.
 * Safe: SELECT (including columns like updated_at), WITH, etc.
 */
export function isProhibitedSQL(sql: string): { prohibited: boolean; keyword?: string } {
  if (!sql || typeof sql !== 'string') return { prohibited: false };

  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    const token = firstToken(stmt);
    if (token && PROHIBITED_KEYWORDS.includes(token as typeof PROHIBITED_KEYWORDS[number])) {
      return { prohibited: true, keyword: token };
    }
  }
  return { prohibited: false };
}

export const PROHIBITED_LIST = PROHIBITED_KEYWORDS;

/**
 * Strip markdown code fences and trim — LLMs often return ```sql ... ``` blocks.
 */
export function getFinalExecutedQuery(sql: string): string {
  let s = (sql || '').trim();
  if (!s) return s;
  const full = s.match(
    /^```(?:sql|bigquery|snowflake|mysql|postgresql|postgres|redshift|tsql|mssql)?\s*\n?([\s\S]*?)\n?```$/i
  );
  if (full) return full[1].trim();
  s = s.replace(/^```(?:sql|bigquery|snowflake|mysql|postgresql|postgres|redshift|tsql|mssql)?\s*/i, '');
  s = s.replace(/\s*```\s*$/i, '');
  return s.trim();
}

/** True if SQL is non-empty and does not start a prohibited statement (see isProhibitedSQL). */
export function isSafeToRun(sql: string): boolean {
  const q = getFinalExecutedQuery(sql);
  if (!q) return false;
  return !isProhibitedSQL(q).prohibited;
}
