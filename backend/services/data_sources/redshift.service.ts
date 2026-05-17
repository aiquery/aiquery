import { Client, Pool, PoolClient } from 'pg';
import type { RedshiftConfig, TableSchema, ColumnSchema, QueryResult } from '../../types';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

// ─── Connection Pool Cache ────────────────────────────────────────────────────

const poolCache = new Map<string, Pool>();

function cacheKey(config: RedshiftConfig): string {
  return `${config.host}:${config.port ?? 5439}|${config.database}|${config.user}`;
}

function buildPoolConfig(config: RedshiftConfig) {
  return {
    host: config.host,
    database: config.database,
    user: config.user,
    password: config.password,
    port: config.port ?? 5439,
    ssl: config.ssl !== false ? { rejectUnauthorized: false } : false,
    max: 5,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 15000,
    statement_timeout: 60000,
  };
}

function getPool(config: RedshiftConfig): Pool {
  const key = cacheKey(config);
  let pool = poolCache.get(key);
  if (!pool) {
    pool = new Pool(buildPoolConfig(config));
    pool.on('error', (err) => {
      console.error('[redshift] Pool error:', err.message);
      poolCache.delete(key);
    });
    poolCache.set(key, pool);
  }
  return pool;
}

function getConfigFromEnv(): RedshiftConfig {
  return {
    host: process.env.REDSHIFT_HOST || '',
    database: process.env.REDSHIFT_DATABASE || '',
    user: process.env.REDSHIFT_USER || '',
    password: process.env.REDSHIFT_PASSWORD || '',
    port: process.env.REDSHIFT_PORT ? parseInt(process.env.REDSHIFT_PORT) : 5439,
    ssl: process.env.REDSHIFT_SSL !== 'false',
    schema: process.env.REDSHIFT_SCHEMA || 'public',
  };
}

// ─── Schema Introspection ─────────────────────────────────────────────────────

export async function getRedshiftDatabaseSchema(
  config?: RedshiftConfig,
  schemaFilter?: string
): Promise<TableSchema[]> {
  const cfg = config || getConfigFromEnv();
  const pool = getPool(cfg);
  const client: PoolClient = await pool.connect();

  try {
    const schemaName = schemaFilter || cfg.schema || 'public';

    // Get all user tables in the schema
    const tablesResult = await client.query<{
      table_schema: string;
      table_name: string;
    }>(`
      SELECT DISTINCT t.table_schema, t.table_name
      FROM information_schema.tables t
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema = $1
        AND t.table_schema NOT IN ('information_schema', 'pg_catalog', 'pg_internal')
      ORDER BY t.table_name
    `, [schemaName]);

    const tables: TableSchema[] = [];

    for (const row of tablesResult.rows) {
      const colResult = await client.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        character_maximum_length: number | null;
        numeric_precision: number | null;
        numeric_scale: number | null;
        column_default: string | null;
      }>(`
        SELECT
          c.column_name,
          c.data_type,
          c.is_nullable,
          c.character_maximum_length,
          c.numeric_precision,
          c.numeric_scale,
          c.column_default
        FROM information_schema.columns c
        WHERE c.table_name = $1
          AND c.table_schema = $2
        ORDER BY c.ordinal_position
      `, [row.table_name, row.table_schema]);

      const columns: ColumnSchema[] = colResult.rows.map((col) => {
        let type = col.data_type.toUpperCase();
        if (col.character_maximum_length) type += `(${col.character_maximum_length})`;
        else if (col.numeric_precision && col.numeric_scale != null)
          type += `(${col.numeric_precision},${col.numeric_scale})`;

        return {
          name: col.column_name,
          type,
          nullable: col.is_nullable === 'YES',
          mode: col.is_nullable === 'YES' ? 'NULLABLE' : 'REQUIRED',
        };
      });

      tables.push({
        name: row.table_name,
        schema: row.table_schema,
        columns,
      });
    }

    return tables;
  } finally {
    client.release();
  }
}

export async function getRedshiftTableSchema(
  tableName: string,
  schemaName: string,
  config?: RedshiftConfig
): Promise<TableSchema> {
  const cfg = config || getConfigFromEnv();
  const pool = getPool(cfg);
  const client: PoolClient = await pool.connect();

  try {
    const colResult = await client.query<{
      column_name: string;
      data_type: string;
      is_nullable: string;
      character_maximum_length: number | null;
      numeric_precision: number | null;
      numeric_scale: number | null;
    }>(`
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale
      FROM information_schema.columns c
      WHERE c.table_name = $1
        AND c.table_schema = $2
      ORDER BY c.ordinal_position
    `, [tableName, schemaName]);

    const columns: ColumnSchema[] = colResult.rows.map((col) => {
      let type = col.data_type.toUpperCase();
      if (col.character_maximum_length) type += `(${col.character_maximum_length})`;
      else if (col.numeric_precision && col.numeric_scale != null)
        type += `(${col.numeric_precision},${col.numeric_scale})`;

      return {
        name: col.column_name,
        type,
        nullable: col.is_nullable === 'YES',
        mode: col.is_nullable === 'YES' ? 'NULLABLE' : 'REQUIRED',
      };
    });

    return { name: tableName, schema: schemaName, columns };
  } finally {
    client.release();
  }
}

// ─── Query Execution ──────────────────────────────────────────────────────────

export async function executeRedshiftQuery(
  querySql: string,
  config?: RedshiftConfig
): Promise<QueryResult> {
  const cfg = config || getConfigFromEnv();
  const pool = getPool(cfg);
  const client: PoolClient = await pool.connect();
  const startTime = Date.now();

  try {
    const result = await client.query(querySql);
    const latencyMs = Date.now() - startTime;

    const rows = result.rows as Record<string, unknown>[];

    const schema: ColumnSchema[] = (result.fields || []).map((field) => ({
      name: field.name,
      type: pgTypeToName(field.dataTypeID),
    }));

    return {
      rows,
      totalRows: rows.length,
      schema,
      latencyMs,
    };
  } finally {
    client.release();
  }
}

// ─── Connection Validation ────────────────────────────────────────────────────

export async function validateRedshiftConnection(config?: RedshiftConfig): Promise<boolean> {
  try {
    const cfg = config || getConfigFromEnv();
    const pool = getPool(cfg);
    const client = await pool.connect();
    await client.query('SELECT 1 AS connected');
    client.release();
    return true;
  } catch {
    return false;
  }
}

// ─── List Schemas ─────────────────────────────────────────────────────────────

export async function listRedshiftSchemas(config?: RedshiftConfig): Promise<string[]> {
  const cfg = config || getConfigFromEnv();
  const pool = getPool(cfg);
  const client: PoolClient = await pool.connect();
  try {
    const result = await client.query<{ schema_name: string }>(`
      SELECT schema_name
      FROM information_schema.schemata
      WHERE schema_name NOT IN ('information_schema', 'pg_catalog', 'pg_internal', 'pg_toast')
      ORDER BY schema_name
    `);
    return result.rows.map((r) => r.schema_name);
  } finally {
    client.release();
  }
}

// ─── Ad-hoc pg Client (used by server.ts for schema / column discovery) ─────

export function parseRedshiftJDBCUrl(url: string): { host: string; port: number; database?: string } {
  const m = url.match(/jdbc:redshift:\/\/([^:]+):(\d+)\/([^?]+)/i);
  if (!m) throw new Error('Invalid Redshift JDBC URL');
  return { host: m[1], port: parseInt(m[2], 10), database: m[3] };
}

export function createRedshiftClient(opts: {
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
}): Client {
  return new Client({
    host: opts.host,
    port: opts.port,
    database: opts.database,
    user: opts.username,
    password: opts.password,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 30000,
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map common PostgreSQL/Redshift OIDs to readable type names */
function pgTypeToName(oid: number): string {
  const map: Record<number, string> = {
    16: 'BOOLEAN',
    20: 'BIGINT',
    21: 'SMALLINT',
    23: 'INTEGER',
    25: 'TEXT',
    700: 'FLOAT4',
    701: 'FLOAT8',
    1043: 'VARCHAR',
    1082: 'DATE',
    1083: 'TIME',
    1114: 'TIMESTAMP',
    1184: 'TIMESTAMPTZ',
    1700: 'NUMERIC',
    2950: 'UUID',
  };
  return map[oid] || 'VARCHAR';
}

export async function validateAndExecuteSQL(
  sql: string,
  config: {
    host?: string;
    port?: number;
    database: string;
    username: string;
    password: string;
    schema?: string;
  }
): Promise<Record<string, unknown>[]> {
  const normalized = getFinalExecutedQuery(sql);
  if (isProhibitedSQL(normalized).prohibited) {
    throw new Error('Query blocked: only read-only SELECT-style queries are allowed.');
  }
  const cfg: RedshiftConfig = {
    host: config.host || '',
    database: config.database,
    user: config.username,
    password: config.password,
    port: config.port,
    schema: config.schema,
  };
  const result = await executeRedshiftQuery(normalized, cfg);
  return result.rows;
}
