/**
 * snowflake.service.ts
 * Snowflake data source: schema introspection and query execution.
 * Uses snowflake-sdk with promise wrappers.
 */

import snowflake from 'snowflake-sdk';
import type { TableSchema, ColumnSchema, QueryResult, SnowflakeConfig } from '../../types';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

// Suppress noisy SDK logs
snowflake.configure({ logLevel: 'ERROR' } as Parameters<typeof snowflake.configure>[0]);

function normalizeSnowflakeAccount(input?: string): string {
  if (!input) return '';
  let value = input.trim();
  value = value.replace(/^https?:\/\//i, '');
  value = value.replace(/\/.*$/, '');
  // Handle accidental duplicate domains like ".snowflakecomputing.com.snowflakecomputing.com"
  while (/\.snowflakecomputing\.com$/i.test(value)) {
    value = value.replace(/\.snowflakecomputing\.com$/i, '');
  }
  return value;
}

function getConfig(override?: Partial<SnowflakeConfig>): SnowflakeConfig {
  return {
    account: normalizeSnowflakeAccount(override?.account || process.env.SNOWFLAKE_ACCOUNT || ''),
    username: override?.username || process.env.SNOWFLAKE_USERNAME || '',
    password: override?.password || process.env.SNOWFLAKE_PASSWORD || '',
    database: override?.database || process.env.SNOWFLAKE_DATABASE || '',
    warehouse: override?.warehouse || process.env.SNOWFLAKE_WAREHOUSE || '',
    schema: override?.schema || process.env.SNOWFLAKE_SCHEMA || 'PUBLIC',
    role: override?.role || process.env.SNOWFLAKE_ROLE,
  };
}

function createConnection(config: SnowflakeConfig): snowflake.Connection {
  return snowflake.createConnection({
    account: config.account,
    username: config.username,
    password: config.password,
    database: config.database,
    warehouse: config.warehouse,
    schema: config.schema,
    role: config.role,
  });
}

function connectAsync(conn: snowflake.Connection): Promise<void> {
  return new Promise((resolve, reject) => {
    conn.connect((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

function executeAsync(conn: snowflake.Connection, sql: string, binds: unknown[] = []): Promise<Record<string, unknown>[]> {
  return new Promise((resolve, reject) => {
    conn.execute({
      sqlText: sql,
      binds: binds as snowflake.Binds,
      complete: (err, _stmt, rows) => {
        if (err) reject(err);
        else resolve((rows || []) as Record<string, unknown>[]);
      },
    });
  });
}

function destroyAsync(conn: snowflake.Connection): Promise<void> {
  return new Promise((resolve) => {
    conn.destroy(() => resolve());
  });
}

export async function fetchSnowflakeSchema(
  schemaName?: string,
  tableName?: string,
  configOverride?: Partial<SnowflakeConfig>
): Promise<TableSchema[]> {
  const config = getConfig(configOverride);
  const schema = schemaName || config.schema || 'PUBLIC';
  const conn = createConnection(config);
  await connectAsync(conn);

  try {
    let sql = `
      SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COMMENT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = ?
    `;
    const params: string[] = [schema.toUpperCase()];
    if (tableName) {
      sql += ` AND TABLE_NAME = ?`;
      params.push(tableName.toUpperCase());
    }
    sql += ` ORDER BY TABLE_NAME, ORDINAL_POSITION`;

    const rows = await executeAsync(conn, sql, params);
    const tableMap = new Map<string, TableSchema>();

    for (const row of rows) {
      const tName = row.TABLE_NAME as string;
      if (!tableMap.has(tName)) {
        tableMap.set(tName, { name: tName, schema, columns: [] });
      }
      tableMap.get(tName)!.columns.push({
        name: row.COLUMN_NAME as string,
        type: row.DATA_TYPE as string,
        nullable: row.IS_NULLABLE === 'Y',
        description: (row.COMMENT as string) || undefined,
      });
    }
    return Array.from(tableMap.values());
  } finally {
    await destroyAsync(conn);
  }
}

export async function executeSnowflakeQuery(
  sql: string,
  configOverride?: Partial<SnowflakeConfig>
): Promise<QueryResult> {
  const config = getConfig(configOverride);
  const conn = createConnection(config);
  await connectAsync(conn);

  const start = Date.now();
  try {
    const rows = await executeAsync(conn, sql);
    const latencyMs = Date.now() - start;
    const schema: ColumnSchema[] = rows.length > 0
      ? Object.keys(rows[0]).map((k) => ({ name: k, type: typeof rows[0][k] }))
      : [];
    return { rows, totalRows: rows.length, schema, latencyMs };
  } finally {
    await destroyAsync(conn);
  }
}

export async function listSnowflakeSchemas(configOverride?: Partial<SnowflakeConfig>): Promise<string[]> {
  const config = getConfig(configOverride);
  const conn = createConnection(config);
  await connectAsync(conn);
  try {
    const rows = await executeAsync(conn, 'SHOW SCHEMAS');
    return rows.map((r) => (r.name || r.NAME) as string).filter(Boolean);
  } finally {
    await destroyAsync(conn);
  }
}

export async function validateSnowflakeConnection(configOverride?: Partial<SnowflakeConfig>): Promise<boolean> {
  try {
    const config = getConfig(configOverride);
    const conn = createConnection(config);
    await connectAsync(conn);
    await executeAsync(conn, 'SELECT CURRENT_VERSION()');
    await destroyAsync(conn);
    return true;
  } catch {
    return false;
  }
}

export async function validateAndExecuteSQL(
  sql: string,
  configOverride: Partial<SnowflakeConfig>
): Promise<Record<string, unknown>[]> {
  const normalized = getFinalExecutedQuery(sql);
  if (isProhibitedSQL(normalized).prohibited) {
    throw new Error('Query blocked: only read-only SELECT-style queries are allowed.');
  }
  const result = await executeSnowflakeQuery(normalized, configOverride);
  return result.rows;
}
