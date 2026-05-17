/**
 * postgresql.service.ts
 * PostgreSQL data source: schema introspection and query execution.
 * Uses the pg driver with connection pooling.
 */

import { Pool } from 'pg';
import type { TableSchema, ColumnSchema, QueryResult, PostgreSQLConfig } from '../../types';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

function getConfig(override?: Partial<PostgreSQLConfig>): PostgreSQLConfig {
  return {
    host: override?.host || process.env.POSTGRESQL_HOST || 'localhost',
    database: override?.database || process.env.POSTGRESQL_DATABASE || 'postgres',
    user: override?.user || process.env.POSTGRESQL_USER || 'postgres',
    password: override?.password || process.env.POSTGRESQL_PASSWORD || '',
    port: override?.port || parseInt(process.env.POSTGRESQL_PORT || '5432', 10),
    ssl: override?.ssl ?? (process.env.POSTGRESQL_SSL === 'true'),
    schema: override?.schema || process.env.POSTGRESQL_SCHEMA || 'public',
  };
}

const pools = new Map<string, Pool>();

function getPool(config: PostgreSQLConfig): Pool {
  const key = `${config.host}:${config.port}:${config.database}:${config.user}`;
  if (!pools.has(key)) {
    pools.set(key, new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      max: 5,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    }));
  }
  return pools.get(key)!;
}

export async function fetchPostgreSQLSchema(
  schemaName?: string,
  tableName?: string,
  configOverride?: Partial<PostgreSQLConfig>
): Promise<TableSchema[]> {
  const config = getConfig(configOverride);
  const schema = schemaName || config.schema || 'public';
  const p = getPool(config);

  const tableFilter = tableName ? `AND c.table_name = $2` : '';
  const params: string[] = [schema];
  if (tableName) params.push(tableName);

  const result = await p.query(
    `SELECT
       c.table_name,
       c.column_name,
       c.data_type,
       c.udt_name,
       c.is_nullable,
       c.character_maximum_length,
       c.numeric_precision,
       pgd.description AS column_description,
       obj_description(pc.oid, 'pg_class') AS table_description
     FROM information_schema.columns c
     LEFT JOIN pg_catalog.pg_statio_all_tables psat
       ON psat.schemaname = c.table_schema AND psat.relname = c.table_name
     LEFT JOIN pg_catalog.pg_description pgd
       ON pgd.objoid = psat.relid AND pgd.objsubid = c.ordinal_position
     LEFT JOIN pg_catalog.pg_class pc
       ON pc.relname = c.table_name
     LEFT JOIN pg_catalog.pg_namespace pn
       ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
     WHERE c.table_schema = $1 ${tableFilter}
     ORDER BY c.table_name, c.ordinal_position`,
    params
  );

  const tableMap = new Map<string, TableSchema>();
  for (const row of result.rows) {
    const tName = row.table_name as string;
    if (!tableMap.has(tName)) {
      tableMap.set(tName, {
        name: tName,
        schema,
        description: (row.table_description as string) || undefined,
        columns: [],
      });
    }
    const col: ColumnSchema = {
      name: row.column_name as string,
      type: row.udt_name as string || row.data_type as string,
      nullable: row.is_nullable === 'YES',
      description: (row.column_description as string) || undefined,
    };
    tableMap.get(tName)!.columns.push(col);
  }
  return Array.from(tableMap.values());
}

export async function executePostgreSQLQuery(
  sql: string,
  configOverride?: Partial<PostgreSQLConfig>
): Promise<QueryResult> {
  const config = getConfig(configOverride);
  const p = getPool(config);
  const start = Date.now();

  const result = await p.query(sql);
  const latencyMs = Date.now() - start;

  const schema: ColumnSchema[] = (result.fields || []).map((f) => ({
    name: f.name,
    type: f.dataTypeID?.toString() || 'unknown',
  }));

  return {
    rows: result.rows as Record<string, unknown>[],
    totalRows: result.rowCount ?? result.rows.length,
    schema,
    latencyMs,
  };
}

export async function listPostgreSQLSchemas(configOverride?: Partial<PostgreSQLConfig>): Promise<string[]> {
  const config = getConfig(configOverride);
  const p = getPool(config);
  const result = await p.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT IN ('information_schema','pg_catalog','pg_toast')
     ORDER BY schema_name`
  );
  return result.rows.map((r) => r.schema_name as string);
}

export async function validatePostgreSQLConnection(configOverride?: Partial<PostgreSQLConfig>): Promise<boolean> {
  try {
    const config = getConfig(configOverride);
    const client = await new Pool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 5000,
    }).connect();
    await client.query('SELECT 1');
    client.release();
    return true;
  } catch {
    return false;
  }
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
  const result = await executePostgreSQLQuery(normalized, {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
    schema: config.schema,
  });
  return result.rows;
}
