import sql from 'mssql';
import type { AzureSQLConfig, TableSchema, ColumnSchema, QueryResult } from '../../types';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

// ─── Connection Pool Cache ────────────────────────────────────────────────────

const poolCache = new Map<string, sql.ConnectionPool>();

function cacheKey(config: AzureSQLConfig): string {
  return `${config.server}|${config.database}|${config.user}`;
}

function buildPoolConfig(config: AzureSQLConfig): sql.config {
  return {
    server: config.server,
    database: config.database,
    user: config.user,
    password: config.password,
    port: config.port ?? 1433,
    options: {
      encrypt: config.encrypt ?? true,
      trustServerCertificate: config.trustServerCertificate ?? false,
      enableArithAbort: true,
    },
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    connectionTimeout: 15000,
    requestTimeout: 60000,
  };
}

async function getPool(config: AzureSQLConfig): Promise<sql.ConnectionPool> {
  const key = cacheKey(config);
  let pool = poolCache.get(key);
  if (!pool || !pool.connected) {
    pool = await new sql.ConnectionPool(buildPoolConfig(config)).connect();
    poolCache.set(key, pool);
  }
  return pool;
}

function getConfigFromEnv(): AzureSQLConfig {
  return {
    server: process.env.AZURE_SQL_SERVER || '',
    database: process.env.AZURE_SQL_DATABASE || '',
    user: process.env.AZURE_SQL_USER || '',
    password: process.env.AZURE_SQL_PASSWORD || '',
    port: process.env.AZURE_SQL_PORT ? parseInt(process.env.AZURE_SQL_PORT) : 1433,
    encrypt: process.env.AZURE_SQL_ENCRYPT !== 'false',
    trustServerCertificate: process.env.AZURE_SQL_TRUST_CERT === 'true',
  };
}

// ─── Schema Introspection ─────────────────────────────────────────────────────

export async function getAzureSQLDatabaseSchema(
  config?: AzureSQLConfig,
  schemaFilter?: string
): Promise<TableSchema[]> {
  const cfg = config || getConfigFromEnv();
  const pool = await getPool(cfg);

  const schemaCondition = schemaFilter
    ? `AND t.TABLE_SCHEMA = @schemaFilter`
    : `AND t.TABLE_SCHEMA NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner', 'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator', 'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_denydatawriter')`;

  const request = pool.request();
  if (schemaFilter) request.input('schemaFilter', sql.NVarChar, schemaFilter);

  const tablesResult = await request.query<{
    TABLE_SCHEMA: string;
    TABLE_NAME: string;
  }>(`
    SELECT DISTINCT t.TABLE_SCHEMA, t.TABLE_NAME
    FROM INFORMATION_SCHEMA.TABLES t
    WHERE t.TABLE_TYPE = 'BASE TABLE'
    ${schemaCondition}
    ORDER BY t.TABLE_SCHEMA, t.TABLE_NAME
  `);

  const tables: TableSchema[] = [];

  for (const row of tablesResult.recordset) {
    const colRequest = pool.request();
    colRequest.input('tableName', sql.NVarChar, row.TABLE_NAME);
    colRequest.input('tableSchema', sql.NVarChar, row.TABLE_SCHEMA);

    const colResult = await colRequest.query<{
      COLUMN_NAME: string;
      DATA_TYPE: string;
      IS_NULLABLE: string;
      CHARACTER_MAXIMUM_LENGTH: number | null;
      NUMERIC_PRECISION: number | null;
      NUMERIC_SCALE: number | null;
    }>(`
      SELECT
        c.COLUMN_NAME,
        c.DATA_TYPE,
        c.IS_NULLABLE,
        c.CHARACTER_MAXIMUM_LENGTH,
        c.NUMERIC_PRECISION,
        c.NUMERIC_SCALE
      FROM INFORMATION_SCHEMA.COLUMNS c
      WHERE c.TABLE_NAME = @tableName
        AND c.TABLE_SCHEMA = @tableSchema
      ORDER BY c.ORDINAL_POSITION
    `);

    const columns: ColumnSchema[] = colResult.recordset.map((col) => {
      let type = col.DATA_TYPE.toUpperCase();
      if (col.CHARACTER_MAXIMUM_LENGTH) type += `(${col.CHARACTER_MAXIMUM_LENGTH})`;
      else if (col.NUMERIC_PRECISION && col.NUMERIC_SCALE != null)
        type += `(${col.NUMERIC_PRECISION},${col.NUMERIC_SCALE})`;

      return {
        name: col.COLUMN_NAME,
        type,
        nullable: col.IS_NULLABLE === 'YES',
        mode: col.IS_NULLABLE === 'YES' ? 'NULLABLE' : 'REQUIRED',
      };
    });

    tables.push({
      name: row.TABLE_NAME,
      schema: row.TABLE_SCHEMA,
      columns,
    });
  }

  return tables;
}

export async function getAzureSQLTableSchema(
  tableName: string,
  tableSchema: string,
  config?: AzureSQLConfig
): Promise<TableSchema> {
  const cfg = config || getConfigFromEnv();
  const pool = await getPool(cfg);

  const request = pool.request();
  request.input('tableName', sql.NVarChar, tableName);
  request.input('tableSchema', sql.NVarChar, tableSchema);

  const colResult = await request.query<{
    COLUMN_NAME: string;
    DATA_TYPE: string;
    IS_NULLABLE: string;
    CHARACTER_MAXIMUM_LENGTH: number | null;
    NUMERIC_PRECISION: number | null;
    NUMERIC_SCALE: number | null;
  }>(`
    SELECT
      c.COLUMN_NAME,
      c.DATA_TYPE,
      c.IS_NULLABLE,
      c.CHARACTER_MAXIMUM_LENGTH,
      c.NUMERIC_PRECISION,
      c.NUMERIC_SCALE
    FROM INFORMATION_SCHEMA.COLUMNS c
    WHERE c.TABLE_NAME = @tableName
      AND c.TABLE_SCHEMA = @tableSchema
    ORDER BY c.ORDINAL_POSITION
  `);

  const columns: ColumnSchema[] = colResult.recordset.map((col) => {
    let type = col.DATA_TYPE.toUpperCase();
    if (col.CHARACTER_MAXIMUM_LENGTH) type += `(${col.CHARACTER_MAXIMUM_LENGTH})`;
    else if (col.NUMERIC_PRECISION && col.NUMERIC_SCALE != null)
      type += `(${col.NUMERIC_PRECISION},${col.NUMERIC_SCALE})`;

    return {
      name: col.COLUMN_NAME,
      type,
      nullable: col.IS_NULLABLE === 'YES',
      mode: col.IS_NULLABLE === 'YES' ? 'NULLABLE' : 'REQUIRED',
    };
  });

  return { name: tableName, schema: tableSchema, columns };
}

// ─── Query Execution ──────────────────────────────────────────────────────────

export async function executeAzureSQLQuery(
  querySql: string,
  config?: AzureSQLConfig
): Promise<QueryResult> {
  const cfg = config || getConfigFromEnv();
  const pool = await getPool(cfg);
  const startTime = Date.now();

  const result = await pool.request().query(querySql);
  const latencyMs = Date.now() - startTime;

  const rows = result.recordset as Record<string, unknown>[];

  // Derive schema from first row keys
  const schema: ColumnSchema[] = rows.length > 0
    ? Object.keys(rows[0]).map((key) => ({
        name: key,
        type: typeof rows[0][key] === 'number' ? 'NUMERIC'
          : rows[0][key] instanceof Date ? 'DATETIME'
          : 'NVARCHAR',
      }))
    : [];

  return {
    rows,
    totalRows: rows.length,
    schema,
    latencyMs,
  };
}

// ─── Connection Validation ────────────────────────────────────────────────────

export async function validateAzureSQLConnection(config?: AzureSQLConfig): Promise<boolean> {
  try {
    const cfg = config || getConfigFromEnv();
    const pool = await getPool(cfg);
    await pool.request().query('SELECT 1 AS connected');
    return true;
  } catch {
    return false;
  }
}

// ─── List Schemas ─────────────────────────────────────────────────────────────

export async function listAzureSQLSchemas(config?: AzureSQLConfig): Promise<string[]> {
  const cfg = config || getConfigFromEnv();
  const pool = await getPool(cfg);
  const result = await pool.request().query<{ SCHEMA_NAME: string }>(`
    SELECT SCHEMA_NAME
    FROM INFORMATION_SCHEMA.SCHEMATA
    WHERE SCHEMA_NAME NOT IN ('sys', 'INFORMATION_SCHEMA', 'guest', 'db_owner',
      'db_accessadmin', 'db_securityadmin', 'db_ddladmin', 'db_backupoperator',
      'db_datareader', 'db_datawriter', 'db_denydatareader', 'db_denydatawriter')
    ORDER BY SCHEMA_NAME
  `);
  return result.recordset.map((r) => r.SCHEMA_NAME);
}

/** Alias for server.ts — builds a `mssql` connection config object. */
export function createSQLServerClient(opts: {
  server?: string;
  host?: string;
  database: string;
  username: string;
  password: string;
  port?: number;
  schema?: string;
}): sql.config {
  return {
    server: opts.server || opts.host || '',
    database: opts.database,
    user: opts.username,
    password: opts.password,
    port: opts.port ?? 1433,
    options: {
      encrypt: true,
      trustServerCertificate: true,
      enableArithAbort: true,
    },
  };
}

export async function validateAndExecuteSQL(
  sql: string,
  config: {
    server?: string;
    host?: string;
    database: string;
    username: string;
    password: string;
    schema?: string;
    port?: number;
  }
): Promise<Record<string, unknown>[]> {
  const normalized = getFinalExecutedQuery(sql);
  if (isProhibitedSQL(normalized).prohibited) {
    throw new Error('Query blocked: only read-only SELECT-style queries are allowed.');
  }
  const azureCfg: AzureSQLConfig = {
    server: config.server || config.host || '',
    database: config.database,
    user: config.username,
    password: config.password,
    port: config.port,
  };
  const result = await executeAzureSQLQuery(normalized, azureCfg);
  return result.rows;
}
