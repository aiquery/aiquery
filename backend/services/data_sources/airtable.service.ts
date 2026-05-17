/**
 * airtable.service.ts
 * Airtable data source: base/table schema introspection and record querying.
 * Uses the official Airtable JS SDK.
 * Note: Airtable uses a record-based model (not SQL), so "query execution"
 * means fetching records from a table with optional filter formulas.
 */

import Airtable from 'airtable';
import type { TableSchema, ColumnSchema, QueryResult, AirtableConfig } from '../../types';
import { fetchAirtableSchema } from '../rag_service/schema-discovery';
export { fetchAirtableSchema };

type AirtableRow = Record<string, unknown>;
type AirtableCacheEntry = { rows: AirtableRow[]; expiresAt: number };
const airtableRowsCache = new Map<string, AirtableCacheEntry>();
const AIRTABLE_CACHE_TTL_MS = 5 * 60 * 1000;

function getConfig(override?: Partial<AirtableConfig>): AirtableConfig {
  return {
    apiKey: override?.apiKey || process.env.AIRTABLE_API_KEY || '',
    baseId: override?.baseId || process.env.AIRTABLE_BASE_ID || '',
  };
}

function getBase(config: AirtableConfig): Airtable.Base {
  Airtable.configure({ apiKey: config.apiKey });
  return Airtable.base(config.baseId);
}

/**
 * List table names in the base by attempting to fetch from common table names
 * or using the Metadata API if available.
 */
export async function listAirtableTables(configOverride?: Partial<AirtableConfig>): Promise<string[]> {
  const config = getConfig(configOverride);

  // Try Airtable Metadata API (requires enterprise or specific plan)
  try {
    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${config.baseId}/tables`,
      { headers: { Authorization: `Bearer ${config.apiKey}` } }
    );
    if (response.ok) {
      const data = await response.json() as { tables: { name: string }[] };
      return data.tables.map((t) => t.name);
    }
  } catch {
    // Metadata API not available, fall through
  }

  return [];
}

/**
 * "Execute" an Airtable query.
 * For Airtable, this means fetching records from a table.
 * The `sql` parameter is treated as: "TABLE_NAME [WHERE formula]"
 * e.g. "Orders WHERE {Status}='Complete'"
 */
export async function executeAirtableQuery(
  query: string,
  configOverride?: Partial<AirtableConfig>
): Promise<QueryResult> {
  try {
    const config = getConfig(configOverride);
    const base = getBase(config);
    const start = Date.now();
    const trimmedQuery = query.trim();

    if (looksLikeSql(trimmedQuery)) {
      return executeAirtableSqlLikeQuery(base, config, trimmedQuery, start);
    }

    // Parse: "TableName" or "TableName WHERE {Field}='value'"
    const whereMatch = trimmedQuery.match(/^(.+?)\s+WHERE\s+(.+)$/i);
    const tableName = (whereMatch ? whereMatch[1] : trimmedQuery).trim();
    const filterFormula = whereMatch ? whereMatch[2].trim() : undefined;

    const selectOptions: Parameters<typeof base>[0] extends string
      ? Parameters<ReturnType<typeof base>['select']>[0]
      : never = {
      maxRecords: 100,
      ...(filterFormula ? { filterByFormula: filterFormula } : {}),
    };

    const records = await base(tableName).select(selectOptions as Airtable.SelectOptions<Record<string, unknown>>).all();
    const latencyMs = Date.now() - start;

    const rows = records.map((r) => ({ id: r.id, ...r.fields })) as Record<string, unknown>[];
    const schema: ColumnSchema[] = rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] }))
      : [];

    return { rows, totalRows: rows.length, schema, latencyMs };
  } catch (error) {
    const e = error as { statusCode?: number; error?: string; message?: string };
    if (e?.statusCode === 403 || e?.error === 'NOT_AUTHORIZED') {
      throw new Error(
        'Airtable authorization failed (403). Ensure this token has access to the target base/table and includes read scopes such as data.records:read and schema.bases:read.'
      );
    }
    throw error;
  }
}

function looksLikeSql(query: string): boolean {
  const upper = query.toUpperCase();
  return upper.startsWith('SELECT') || upper.startsWith('WITH');
}

function parseFromTable(sql: string): string | null {
  const fromMatch = sql.match(/\bFROM\s+(.+?)(?=\s+WHERE\b|\s+GROUP\s+BY\b|\s+ORDER\s+BY\b|\s+LIMIT\b|$)/is);
  if (!fromMatch?.[1]) return null;
  return fromMatch[1]
    .trim()
    .replace(/["`[\]]/g, '')
    .replace(/\s+/g, ' ');
}

function parseLimit(sql: string): number | undefined {
  const m = sql.match(/\bLIMIT\s+(\d+)\b/i);
  if (!m?.[1]) return undefined;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function parseOrderByTerms(sql: string): Array<{ key: string; dir: 'asc' | 'desc' }> {
  const match = sql.match(/\bORDER\s+BY\s+(.+?)(?=\s+LIMIT\b|$)/is);
  if (!match?.[1]) return [];
  return match[1]
    .split(',')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((term) => {
      const m = term.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*(ASC|DESC)?$/i);
      if (!m?.[1]) return null;
      return {
        key: m[1],
        dir: (m[2]?.toLowerCase() === 'desc' ? 'desc' : 'asc') as 'asc' | 'desc',
      };
    })
    .filter((x): x is { key: string; dir: 'asc' | 'desc' } => Boolean(x));
}

function buildAirtableCacheKey(baseId: string, tableName: string): string {
  return `${baseId}::${tableName}`.toLowerCase();
}

async function getTableRowsWithCache(
  base: Airtable.Base,
  config: AirtableConfig,
  tableName: string
): Promise<AirtableRow[]> {
  const cacheKey = buildAirtableCacheKey(config.baseId, tableName);
  const now = Date.now();
  const cached = airtableRowsCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.rows;
  }

  const records = await base(tableName).select({ pageSize: 100 }).all();
  const rows = records.map((r) => ({ id: r.id, ...r.fields })) as AirtableRow[];
  airtableRowsCache.set(cacheKey, { rows, expiresAt: now + AIRTABLE_CACHE_TTL_MS });
  return rows;
}

async function executeAirtableSqlLikeQuery(
  base: Airtable.Base,
  config: AirtableConfig,
  sql: string,
  start: number
): Promise<QueryResult> {
  const tableName = parseFromTable(sql);
  if (!tableName) {
    throw new Error('Could not determine Airtable table name from SQL-like query');
  }

  // Support common generated analytics pattern:
  // SELECT COALESCE({Field}, 'Unknown') AS key, COUNT({OtherField}|*) AS value
  // FROM Table
  // GROUP BY COALESCE({Field}, 'Unknown') | {Field}
  const groupByCoalesce = sql.match(/GROUP\s+BY\s+COALESCE\(\s*\{([^}]+)\}\s*,\s*'([^']*)'\s*\)/i);
  const groupByPlain = sql.match(/GROUP\s+BY\s+\{([^}]+)\}/i);
  const countDistinct = /COUNT\s*\(\s*DISTINCT\s+\{([^}]+)\}\s*\)/i.exec(sql);
  const countField = /COUNT\s*\(\s*\{([^}]+)\}\s*\)/i.exec(sql);
  const selectAlias = /AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*,\s*COUNT/i.exec(sql);
  const countAlias = /COUNT\s*\([^)]*\)\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)/i.exec(sql);
  const finalDimAlias = /SELECT\s+[A-Za-z_][A-Za-z0-9_]*\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s*,/i.exec(sql);
  const finalMeasureAlias = /,\s*[A-Za-z_][A-Za-z0-9_]*\s+AS\s+([A-Za-z_][A-Za-z0-9_]*)\s+FROM/i.exec(sql);

  const groupField = groupByCoalesce?.[1] || groupByPlain?.[1];
  const nullFallback = groupByCoalesce?.[2] || 'Unknown';
  const limit = parseLimit(sql);
  const orderTerms = parseOrderByTerms(sql);

  if (!groupField) {
    // Best-effort fallback for SQL-like requests: return table rows so chat flow still works.
    let rows = await getTableRowsWithCache(base, config, tableName);
    if (typeof limit === 'number') {
      rows = rows.slice(0, limit);
    }
    const latencyMs = Date.now() - start;
    const schema: ColumnSchema[] = rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] }))
      : [];
    return { rows, totalRows: rows.length, schema, latencyMs };
  }

  const records = await getTableRowsWithCache(base, config, tableName);
  const distinctField = countDistinct?.[1];
  const aggregateField = countField?.[1];
  const byGroup = new Map<string, number | Set<string>>();

  for (const rec of records) {
    const rawGroupValue = rec[groupField];
    const groupValue =
      rawGroupValue === null || rawGroupValue === undefined || String(rawGroupValue).trim() === ''
        ? nullFallback
        : String(rawGroupValue);

    if (distinctField) {
      const rawDistinct = rec[distinctField];
      if (rawDistinct === null || rawDistinct === undefined || String(rawDistinct).trim() === '') {
        continue;
      }
      const existing = byGroup.get(groupValue);
      if (existing instanceof Set) {
        existing.add(String(rawDistinct));
      } else {
        byGroup.set(groupValue, new Set([String(rawDistinct)]));
      }
      continue;
    }

    if (aggregateField) {
      const rawCountTarget = rec[aggregateField];
      if (rawCountTarget === null || rawCountTarget === undefined || String(rawCountTarget).trim() === '') {
        continue;
      }
    }
    byGroup.set(groupValue, Number(byGroup.get(groupValue) || 0) + 1);
  }

  const dimKey = finalDimAlias?.[1] || selectAlias?.[1] || 'group';
  const measureKey = finalMeasureAlias?.[1] || countAlias?.[1] || 'count';
  const rows = Array.from(byGroup.entries()).map(([k, v]) => ({
    [dimKey]: k,
    [measureKey]: v instanceof Set ? v.size : v,
  }));

  if (orderTerms.length > 0) {
    const keyMap = new Map<string, string>();
    Object.keys(rows[0] || {}).forEach((k) => keyMap.set(k.toLowerCase(), k));
    rows.sort((a, b) => {
      const ra = a as Record<string, unknown>;
      const rb = b as Record<string, unknown>;
      for (const term of orderTerms) {
        const actualKey = keyMap.get(term.key.toLowerCase()) || term.key;
        const av = ra[actualKey];
        const bv = rb[actualKey];
        const an = Number(av);
        const bn = Number(bv);
        let cmp = 0;
        if (Number.isFinite(an) && Number.isFinite(bn)) {
          cmp = an - bn;
        } else {
          cmp = String(av ?? '').localeCompare(String(bv ?? ''));
        }
        if (cmp !== 0) return term.dir === 'desc' ? -cmp : cmp;
      }
      return 0;
    });
  } else {
    rows.sort((a, b) => {
      const av = Number((a as Record<string, unknown>)[measureKey] || 0);
      const bv = Number((b as Record<string, unknown>)[measureKey] || 0);
      return bv - av;
    });
  }

  const limitedRows = typeof limit === 'number' ? rows.slice(0, limit) : rows;

  const latencyMs = Date.now() - start;
  const schema: ColumnSchema[] = limitedRows.length > 0
    ? Object.keys(limitedRows[0]).map((k) => ({ name: k, type: typeof (limitedRows[0] as Record<string, unknown>)[k] }))
    : [
      { name: dimKey, type: 'string' },
      { name: measureKey, type: 'number' },
    ];

  return { rows: limitedRows, totalRows: limitedRows.length, schema, latencyMs };
}

export async function validateAirtableConnection(configOverride?: Partial<AirtableConfig>): Promise<boolean> {
  try {
    const config = getConfig(configOverride);
    const response = await fetch(
      `https://api.airtable.com/v0/meta/bases/${config.baseId}/tables`,
      { headers: { Authorization: `Bearer ${config.apiKey}` } }
    );
    // 200 = full access, 403 = valid key but no metadata access (still connected)
    return response.status === 200 || response.status === 403;
  } catch {
    return false;
  }
}

/** Shape expected by `server.ts` RAG column / table routes. */
export function createAirtableClient(params: { apiKey: string; baseId: string }): {
  getTables: () => Promise<string[]>;
  getTableSchema: (tableName: string) => Promise<{
    fields: Array<{ name: string; type: string; description?: string }>;
    rowCount?: number;
  }>;
  getTableSchemaDetailed: (tableName: string) => Promise<{
    fields: Array<{ name: string; type: string; description?: string }>;
    rowCount?: number;
  }>;
  testConnection: () => Promise<{ success: boolean; error?: string }>;
} {
  const cfg = getConfig(params);
  return {
    getTables: () => listAirtableTables(cfg),
    getTableSchema: async (tableName: string) => {
      const schemas = await fetchAirtableSchema(tableName, cfg);
      const t = schemas[0];
      return {
        fields: (t?.columns || []).map((c) => ({
          name: c.name,
          type: c.type,
          description: c.description,
        })),
        rowCount: undefined,
      };
    },
    getTableSchemaDetailed: async (tableName: string) => {
      const schemas = await fetchAirtableSchema(tableName, cfg);
      const t = schemas[0];
      return {
        fields: (t?.columns || []).map((c) => ({
          name: c.name,
          type: c.type,
          description: c.description,
        })),
        rowCount: undefined,
      };
    },
    testConnection: async () => {
      const ok = await validateAirtableConnection(cfg);
      return ok
        ? { success: true }
        : { success: false, error: 'Unable to connect to Airtable with the provided credentials' };
    },
  };
}
