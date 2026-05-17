/**
 * databricks.service.ts
 * Databricks SQL data source: schema introspection and query execution.
 * Uses @databricks/sql connector (JDBC-like over HTTP).
 *
 * The @databricks/sql package depends on native `lz4`, which can fail on Windows with
 * "not a valid Win32 application" (wrong Node ABI/arch). We lazy-load the driver so
 * the rest of the server starts without loading lz4 until a Databricks call is made.
 */

import type { TableSchema, ColumnSchema, QueryResult, DatabricksConfig } from '../../types';
import axios from 'axios';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

let dbsqlModule: typeof import('@databricks/sql') | null = null;
let lz4WarningSuppressedLogged = false;

async function loadDbsql(): Promise<typeof import('@databricks/sql')> {
  if (!dbsqlModule) {
    const originalWarn = console.warn;
    let suppressedLz4Warn = false;
    try {
      // Suppress known optional native-lz4 warning on Windows from @databricks/sql.
      console.warn = (...args: unknown[]) => {
        const text = args.map((a) => String(a ?? '')).join(' ');
        if (text.includes('LZ4 native module failed to load')) {
          suppressedLz4Warn = true;
          return;
        }
        originalWarn(...args);
      };
      dbsqlModule = await import('@databricks/sql');
      if (suppressedLz4Warn && !lz4WarningSuppressedLogged) {
        lz4WarningSuppressedLogged = true;
        console.log('[Databricks] Optional native lz4 warning suppressed on this platform.');
      }
    } finally {
      console.warn = originalWarn;
    }
  }
  return dbsqlModule;
}

function getConfig(override?: Partial<DatabricksConfig>): DatabricksConfig {
  const extra = (override as Record<string, unknown> | undefined) || {};
  return {
    host: override?.host || process.env.DATABRICKS_HOST || '',
    token: override?.token || (extra.accessToken as string | undefined) || process.env.DATABRICKS_TOKEN || '',
    httpPath: override?.httpPath || process.env.DATABRICKS_HTTP_PATH || '',
    catalog: override?.catalog || process.env.DATABRICKS_CATALOG,
    schema: override?.schema || process.env.DATABRICKS_SCHEMA || 'default',
  };
}

function parseDatabricksJdbcUrl(jdbcUrl?: string): { host?: string; httpPath?: string } {
  if (!jdbcUrl) return {};
  const hostMatch = jdbcUrl.match(/^jdbc:databricks:\/\/([^:\/;?]+)/i);
  const httpPathMatch = jdbcUrl.match(/[;?]httpPath=([^;]+)/i);
  return {
    host: hostMatch?.[1],
    httpPath: httpPathMatch?.[1] ? decodeURIComponent(httpPathMatch[1]) : undefined,
  };
}

function normalizeDatabricksHost(host?: string): string {
  if (!host) return '';
  return host.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
}

function normalizeDatabricksCatalog(catalog?: string): string | undefined {
  if (!catalog) return undefined;
  const v = String(catalog).trim().replace(/\.+$/, '');
  return v || undefined;
}

function resolveDatabricksRuntimeConfig(override?: Partial<DatabricksConfig>): DatabricksConfig {
  const raw = getConfig(override);
  const jdbcInfo = parseDatabricksJdbcUrl((override as Record<string, unknown> | undefined)?.jdbcUrl as string | undefined);
  return {
    ...raw,
    host: normalizeDatabricksHost(raw.host || jdbcInfo.host || ''),
    httpPath: raw.httpPath || jdbcInfo.httpPath || '',
    catalog: normalizeDatabricksCatalog(raw.catalog),
  };
}

async function executeSqlViaRestRows(
  config: DatabricksConfig,
  statement: string
): Promise<Record<string, unknown>[]> {
  if (!config.host || !config.httpPath || !config.token) return [];
  const warehouseIdMatch = config.httpPath.match(/warehouses\/([^/?;]+)/i);
  const warehouseId = warehouseIdMatch?.[1];
  if (!warehouseId) return [];

  const statementsUrl = `https://${config.host}/api/2.0/sql/statements`;
  const createResp = await axios.post(
    statementsUrl,
    {
      warehouse_id: warehouseId,
      statement,
      wait_timeout: '10s',
      on_wait_timeout: 'CONTINUE',
    },
    {
      headers: {
        Authorization: `Bearer ${config.token}`,
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    }
  );

  let status = String(createResp.data?.status?.state || '').toUpperCase();
  let statementId = createResp.data?.statement_id as string | undefined;
  let statusResponse: any = createResp.data;

  if (status === 'SUCCEEDED') {
    // continue to parse immediate result payload
  } else if (!statementId) {
    return [];
  }

  for (let i = 0; i < 20; i += 1) {
    if (status === 'SUCCEEDED' || status === 'FAILED' || status === 'CANCELED' || status === 'CLOSED') break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const pollResp = await axios.get(`${statementsUrl}/${statementId}`, {
      headers: {
        Authorization: `Bearer ${config.token}`,
      },
      timeout: 30000,
    });
    statusResponse = pollResp.data;
    status = String(statusResponse?.status?.state || '').toUpperCase();
  }

  if (status !== 'SUCCEEDED') return [];

  const manifest = statusResponse?.manifest;
  const result = statusResponse?.result;
  const data = result?.data_array || result?.data || [];
  if (!Array.isArray(data) || data.length === 0) return [];

  if (manifest?.schema?.columns && Array.isArray(manifest.schema.columns)) {
    const cols = manifest.schema.columns.map((c: any) => String(c.name || ''));
    return data.map((row: any) => {
      if (Array.isArray(row)) {
        const obj: Record<string, unknown> = {};
        cols.forEach((name: string, idx: number) => {
          obj[name] = row[idx];
        });
        return obj;
      }
      if (row && typeof row === 'object') return row as Record<string, unknown>;
      return { value: row };
    });
  }

  if (Array.isArray(data) && data.every((r) => r && typeof r === 'object' && !Array.isArray(r))) {
    return data as Record<string, unknown>[];
  }
  return data.map((r: any) => ({ value: r }));
}

/** Minimal session shape used by this file (avoids static import of DBSQLClient types). */
type DbsqlSession = {
  executeStatement: (
    sql: string,
    opts?: { runAsync?: boolean }
  ) => Promise<{ fetchAll: () => Promise<unknown[]>; close: () => Promise<void> }>;
  close: () => Promise<void>;
};

async function withSession<T>(
  config: DatabricksConfig,
  fn: (session: DbsqlSession) => Promise<T>
): Promise<T> {
  const { DBSQLClient } = await loadDbsql();
  const client = new DBSQLClient();
  await client.connect({
    host: config.host,
    path: config.httpPath,
    token: config.token,
  });
  const session = (await client.openSession({
    initialCatalog: config.catalog,
    initialSchema: config.schema,
  })) as unknown as DbsqlSession;
  try {
    return await fn(session);
  } finally {
    await session.close();
    await client.close();
  }
}

async function runQuery(session: DbsqlSession, sql: string): Promise<Record<string, unknown>[]> {
  const op = await session.executeStatement(sql, { runAsync: false });
  const result = await op.fetchAll();
  await op.close();
  return (result || []) as Record<string, unknown>[];
}

export async function fetchDatabricksSchema(
  schemaName?: string,
  tableName?: string,
  configOverride?: Partial<DatabricksConfig>
): Promise<TableSchema[]> {
  const config = resolveDatabricksRuntimeConfig(configOverride);
  const schema = schemaName || config.schema || 'default';

  return withSession(config, async (session) => {
    const catalogPrefix = config.catalog ? `${config.catalog}.` : '';
    let sql = `DESCRIBE TABLE EXTENDED ${catalogPrefix}${schema}.`;

    if (tableName) {
      // Single table
      const rows = await runQuery(session, `${sql}${tableName}`);
      const columns: ColumnSchema[] = rows
        .filter((r) => r.col_name && !(r.col_name as string).startsWith('#'))
        .map((r) => ({
          name: r.col_name as string,
          type: r.data_type as string,
          description: (r.comment as string) || undefined,
        }));
      return [{ name: tableName, schema, columns }];
    }

    // All tables in schema
    const tables = await runQuery(session, `SHOW TABLES IN ${catalogPrefix}${schema}`);
    const result: TableSchema[] = [];

    for (const t of tables) {
      const tName = (t.tableName || t.table_name) as string;
      if (!tName) continue;
      try {
        const cols = await runQuery(session, `DESCRIBE ${catalogPrefix}${schema}.${tName}`);
        const columns: ColumnSchema[] = cols
          .filter((r) => r.col_name && !(r.col_name as string).startsWith('#'))
          .map((r) => ({
            name: r.col_name as string,
            type: r.data_type as string,
            description: (r.comment as string) || undefined,
          }));
        result.push({ name: tName, schema, columns });
      } catch {
        // Skip tables we can't describe
      }
    }
    return result;
  });
}

export async function executeDatabricksQuery(
  sql: string,
  configOverride?: Partial<DatabricksConfig>
): Promise<QueryResult> {
  const config = resolveDatabricksRuntimeConfig(configOverride);
  const start = Date.now();
  const overrideAny = configOverride as Record<string, unknown> | undefined;
  const preferRest =
    String(overrideAny?.connectionMethod || '').toLowerCase() === 'url' ||
    typeof overrideAny?.jdbcUrl === 'string';

  let rows: Record<string, unknown>[];
  if (preferRest && config.host && config.httpPath && config.token) {
    try {
      rows = await executeSqlViaRestRows(config, sql);
      const latencyMs = Date.now() - start;
      const schema: ColumnSchema[] = rows.length > 0
        ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] }))
        : [];
      return { rows, totalRows: rows.length, schema, latencyMs };
    } catch (restErr) {
      console.warn('[Databricks] REST-first execution failed, retrying via DBSQL:', restErr);
    }
  }

  try {
    rows = await withSession(config, (session) => runQuery(session, sql));
  } catch (error) {
    if (config.host && config.httpPath && config.token) {
      rows = await executeSqlViaRestRows(config, sql);
    } else {
      throw error;
    }
  }
  const latencyMs = Date.now() - start;

  const schema: ColumnSchema[] = rows.length > 0
    ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] }))
    : [];

  return { rows, totalRows: rows.length, schema, latencyMs };
}

export async function listDatabricksSchemas(configOverride?: Partial<DatabricksConfig>): Promise<string[]> {
  const config = resolveDatabricksRuntimeConfig(configOverride);
  const catalogName = normalizeDatabricksCatalog(config.catalog);
  return withSession(config, async (session) => {
    const rows = await runQuery(session, `SHOW SCHEMAS IN ${catalogName || 'hive_metastore'}`);
    return rows.map((r) => (r.databaseName || r.namespace) as string).filter(Boolean);
  });
}

/** Used by GET /api/rag/tables (Databricks branch) — list catalogs. */
export async function fetchDatabricksCatalogs(configOverride?: Partial<DatabricksConfig>): Promise<string[]> {
  const config = resolveDatabricksRuntimeConfig(configOverride);
  return withSession(config, async (session) => {
    try {
      const rows = await runQuery(session, 'SHOW CATALOGS');
      return rows
        .map((r: Record<string, unknown>) =>
          (r.catalog ?? r.namespace ?? r.name ?? r.databaseName ?? '') as string
        )
        .filter(Boolean);
    } catch {
      return config.catalog ? [config.catalog] : [];
    }
  });
}

/** Used by GET /api/rag/tables — list schemas in a catalog. */
export async function fetchDatabricksSchemas(
  configOverride?: Partial<DatabricksConfig>,
  catalog?: string
): Promise<string[]> {
  const merged = { ...resolveDatabricksRuntimeConfig(configOverride), ...(catalog ? { catalog } : {}) };
  return listDatabricksSchemas(merged);
}

export async function validateDatabricksConnection(configOverride?: Partial<DatabricksConfig>): Promise<boolean> {
  const config = resolveDatabricksRuntimeConfig(configOverride);
  try {
    await withSession(config, async (session) => {
      await runQuery(session, 'SELECT 1');
    });
    return true;
  } catch (error) {
    // Windows commonly fails to load native lz4 dependency for @databricks/sql.
    // Fallback to SQL REST API connectivity check when host/httpPath/token are available.
    if (config.host && config.httpPath && config.token) {
      try {
        const rows = await executeSqlViaRestRows(config, 'SELECT 1');
        return rows.length > 0;
      } catch {
        return false;
      }
    }
    console.warn('[Databricks] Validation failed before REST fallback:', error);
    return false;
  }
}

export async function validateAndExecuteSQL(
  sql: string,
  configOverride: Partial<DatabricksConfig>
): Promise<Record<string, unknown>[]> {
  const normalized = getFinalExecutedQuery(sql);
  if (isProhibitedSQL(normalized).prohibited) {
    throw new Error('Query blocked: only read-only SELECT-style queries are allowed.');
  }
  const result = await executeDatabricksQuery(normalized, configOverride);
  return result.rows;
}
