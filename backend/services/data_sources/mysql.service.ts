/**
 * mysql.service.ts
 * MySQL data source: schema introspection and query execution.
 * Uses mysql2 with connection pooling.
 */

import mysql from 'mysql2/promise';
import type { TableSchema, ColumnSchema, QueryResult, MySQLConfig } from '../../types';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

function getConfig(override?: Partial<MySQLConfig>): MySQLConfig {
  return {
    host: override?.host || process.env.MYSQL_HOST || 'localhost',
    database: override?.database || process.env.MYSQL_DATABASE || '',
    user: override?.user || process.env.MYSQL_USER || 'root',
    password: override?.password || process.env.MYSQL_PASSWORD || '',
    port: override?.port || parseInt(process.env.MYSQL_PORT || '3306', 10),
    ssl: override?.ssl ?? (process.env.MYSQL_SSL === 'true'),
  };
}

let pool: mysql.Pool | null = null;
let poolConfig: string = '';

function getPool(config: MySQLConfig): mysql.Pool {
  const key = `${config.host}:${config.port}:${config.database}:${config.user}`;
  if (!pool || poolConfig !== key) {
    pool = mysql.createPool({
      host: config.host,
      port: config.port,
      database: config.database,
      user: config.user,
      password: config.password,
      ssl: config.ssl ? { rejectUnauthorized: false } : undefined,
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 0,
    });
    poolConfig = key;
  }
  return pool;
}

export async function fetchMySQLSchema(
  database?: string,
  tableName?: string,
  configOverride?: Partial<MySQLConfig>
): Promise<TableSchema[]> {
  const config = getConfig(configOverride);
  const db = database || config.database;
  const p = getPool(config);

  const tableWhere = tableName ? `AND t.TABLE_NAME = ?` : '';
  const params: string[] = [db];
  if (tableName) params.push(tableName);

  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    `SELECT
       t.TABLE_NAME,
       t.TABLE_COMMENT,
       c.COLUMN_NAME,
       c.DATA_TYPE,
       c.COLUMN_TYPE,
       c.IS_NULLABLE,
       c.COLUMN_COMMENT,
       c.COLUMN_KEY
     FROM information_schema.TABLES t
     JOIN information_schema.COLUMNS c
       ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
     WHERE t.TABLE_SCHEMA = ? ${tableWhere}
       AND t.TABLE_TYPE = 'BASE TABLE'
     ORDER BY t.TABLE_NAME, c.ORDINAL_POSITION`,
    params
  );

  const tableMap = new Map<string, TableSchema>();
  for (const row of rows) {
    const tName = row.TABLE_NAME as string;
    if (!tableMap.has(tName)) {
      tableMap.set(tName, {
        name: tName,
        schema: db,
        description: (row.TABLE_COMMENT as string) || undefined,
        columns: [],
      });
    }
    const col: ColumnSchema = {
      name: row.COLUMN_NAME as string,
      type: row.COLUMN_TYPE as string,
      nullable: row.IS_NULLABLE === 'YES',
      description: (row.COLUMN_COMMENT as string) || undefined,
    };
    tableMap.get(tName)!.columns.push(col);
  }
  return Array.from(tableMap.values());
}

export async function executeMySQLQuery(
  sql: string,
  configOverride?: Partial<MySQLConfig>
): Promise<QueryResult> {
  const config = getConfig(configOverride);
  const p = getPool(config);
  const start = Date.now();

  const [rows, fields] = await p.execute<mysql.RowDataPacket[]>(sql);
  const latencyMs = Date.now() - start;

  const schema: ColumnSchema[] = (fields || []).map((f) => ({
    name: f.name,
    type: f.type?.toString() || 'unknown',
  }));

  return {
    rows: rows as Record<string, unknown>[],
    totalRows: rows.length,
    schema,
    latencyMs,
  };
}

export async function listMySQLDatabases(configOverride?: Partial<MySQLConfig>): Promise<string[]> {
  const config = getConfig(configOverride);
  const p = getPool(config);
  const [rows] = await p.execute<mysql.RowDataPacket[]>(
    `SELECT SCHEMA_NAME FROM information_schema.SCHEMATA
     WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys')
     ORDER BY SCHEMA_NAME`
  );
  return rows.map((r) => r.SCHEMA_NAME as string);
}

export async function validateMySQLConnection(configOverride?: Partial<MySQLConfig>): Promise<boolean> {
  try {
    const config = getConfig(configOverride);
    const conn = await mysql.createConnection({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      connectTimeout: 5000,
    });
    await conn.ping();
    await conn.end();
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
  const result = await executeMySQLQuery(normalized, {
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.username,
    password: config.password,
  });
  return result.rows;
}
