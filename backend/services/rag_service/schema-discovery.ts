/**
 * Table/schema discovery for RAG UI (GET /api/rag/tables).
 * Maps generic connection blobs from the API to typed data-source helpers.
 */

import fs from 'fs';
import path from 'path';
import Airtable from 'airtable';
import { BigQuery, BigQueryOptions, TableField } from '@google-cloud/bigquery';
import type { ColumnSchema } from '../../types';
import type {
  AirtableSchemaConfig,
  AirtableSchemaTable,
  BigQueryRagConfig,
  BigQueryRagTableSchemaRow,
  RagTableSchemaRow,
} from './schema-discovery.types';
import { fetchPostgreSQLSchema } from '../data_sources/postgresql.service';
import { getRedshiftDatabaseSchema, parseRedshiftJDBCUrl } from '../data_sources/redshift.service';
import { getAzureSQLDatabaseSchema } from '../data_sources/azuresql.service';
import { fetchMySQLSchema } from '../data_sources/mysql.service';
import { fetchSnowflakeSchema } from '../data_sources/snowflake.service';
import { fetchDatabricksSchema } from '../data_sources/databricks.service';

export type { RagTableSchemaRow, BigQueryRagTableSchemaRow } from './schema-discovery.types';

// BigQuery helpers
function mapBigQueryField(field: TableField): ColumnSchema {
  return {
    name: field.name || '',
    type: field.type || 'STRING',
    mode: field.mode || 'NULLABLE',
    description: field.description || undefined,
  };
}

function createBigQueryClientForRag(config: BigQueryRagConfig): BigQuery {
  const { projectId, serviceAccountKey } = config;
  const trimmed = String(serviceAccountKey || '').trim();
  if (!projectId?.trim()) {
    throw new Error('Project ID is required');
  }
  if (!trimmed) {
    throw new Error('Service Account Key is required');
  }

  const options: BigQueryOptions = { projectId };
  if (trimmed.startsWith('{')) {
    const creds = JSON.parse(trimmed) as Record<string, unknown>;
    (options as { credentials?: Record<string, unknown> }).credentials = creds;
  } else {
    const keyPath = path.resolve(trimmed);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Key file not found: ${keyPath}`);
    }
    options.keyFilename = keyPath;
  }

  return new BigQuery(options);
}

// Airtable helpers
function inferAirtableType(value: unknown): string {
  if (value === null || value === undefined) return 'text';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'checkbox';
  if (Array.isArray(value)) return 'multipleSelect';
  if (typeof value === 'object') return 'linkedRecord';
  const str = String(value);
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return 'date';
  if (/^https?:\/\//.test(str)) return 'url';
  return 'text';
}

async function listAirtableTablesForRag(config: { apiKey: string; baseId: string }): Promise<string[]> {
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
    // metadata API unavailable
  }
  return [];
}

// Shared parser helper
function parseSchemaList(cfg: { schema?: unknown; schemas?: unknown }): string[] {
  if (cfg.schemas != null && String(cfg.schemas).trim()) {
    return String(cfg.schemas)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  if (cfg.schema != null && String(cfg.schema).trim()) {
    return [String(cfg.schema).trim()];
  }
  return [];
}

// Airtable / BigQuery fetchers
export async function fetchAirtableSchema(
  tableName?: string,
  cfg?: AirtableSchemaConfig
): Promise<AirtableSchemaTable[]> {
  const apiKey = cfg?.apiKey || process.env.AIRTABLE_API_KEY || '';
  const baseId = cfg?.baseId || process.env.AIRTABLE_BASE_ID || '';
  if (!apiKey || !baseId) return [];

  Airtable.configure({ apiKey });
  const base = Airtable.base(baseId);
  const tableNames = tableName ? [tableName] : await listAirtableTablesForRag({ apiKey, baseId });
  const out: AirtableSchemaTable[] = [];

  for (const tName of tableNames) {
    try {
      const records = await base(tName).select({ maxRecords: 5, pageSize: 5 }).firstPage();
      const fieldSet = new Set<string>();
      const fieldTypes = new Map<string, string>();
      for (const rec of records) {
        for (const [key, val] of Object.entries(rec.fields)) {
          fieldSet.add(key);
          if (!fieldTypes.has(key)) fieldTypes.set(key, inferAirtableType(val));
        }
      }
      const columns: ColumnSchema[] = Array.from(fieldSet).map((name) => ({
        name,
        type: fieldTypes.get(name) || 'text',
      }));
      out.push({ name: tName, columns });
    } catch {
      // skip inaccessible table
    }
  }
  return out;
}

export async function fetchBigQueryTableSchemas(
  config: BigQueryRagConfig,
  datasetIds: string[]
): Promise<BigQueryRagTableSchemaRow[]> {
  const bq = createBigQueryClientForRag(config);
  const out: BigQueryRagTableSchemaRow[] = [];
  const projectId = config.projectId;

  for (const datasetId of datasetIds) {
    const dataset = bq.dataset(datasetId, { projectId });
    const [tables] = await dataset.getTables();
    for (const table of tables) {
      try {
        const [metadata] = await table.getMetadata();
        const fields: TableField[] = metadata.schema?.fields || [];
        let rowCount: number | undefined;
        const n = (metadata as { numRows?: string | number }).numRows;
        if (n != null && n !== '') rowCount = Number(n);

        out.push({
          datasetId,
          tableId: table.id || '',
          schema: fields.map(mapBigQueryField),
          rowCount,
        });
      } catch (err) {
        console.warn(`[BigQuery] Skipping table ${datasetId}.${table.id}:`, err);
      }
    }
  }

  return out.sort((a, b) =>
    `${a.datasetId || ''}.${a.tableId}`.localeCompare(`${b.datasetId || ''}.${b.tableId}`)
  );
}

// SQL-family fetchers
export async function fetchPostgresSQLTableSchemas(cfg: any): Promise<RagTableSchemaRow[]> {
  const pgCfg = {
    host: cfg.host || cfg.server,
    database: cfg.database,
    user: cfg.username || cfg.user,
    password: cfg.password,
    port: cfg.port ? parseInt(String(cfg.port), 10) : undefined,
    ssl: cfg.ssl,
  };
  const schemaNames = parseSchemaList(cfg);
  const list = schemaNames.length > 0 ? schemaNames : ['public'];
  const out: RagTableSchemaRow[] = [];
  for (const schemaName of list) {
    const tables = await fetchPostgreSQLSchema(schemaName, undefined, { ...pgCfg, schema: schemaName });
    for (const t of tables) {
      out.push({
        schemaName,
        tableId: t.name,
        schema: t.columns,
        rowCount: undefined,
      });
    }
  }
  return out;
}

export async function fetchRedshiftTableSchemas(cfg: any): Promise<RagTableSchemaRow[]> {
  let resolvedHost = (cfg.host || cfg.server || cfg.serverUrl || cfg.jdbcUrl || '') as string;
  let resolvedPort = cfg.port ? parseInt(String(cfg.port), 10) : 5439;
  let resolvedDatabase = cfg.database as string;

  const possibleJdbcUrl =
    (cfg.jdbcUrl as string | undefined) ||
    (typeof resolvedHost === 'string' && resolvedHost.startsWith('jdbc:redshift://') ? resolvedHost : undefined);

  if (possibleJdbcUrl && (cfg.connectionMethod === 'url' || possibleJdbcUrl.startsWith('jdbc:redshift://'))) {
    const parsed = parseRedshiftJDBCUrl(possibleJdbcUrl);
    resolvedHost = parsed.host;
    resolvedPort = parsed.port;
    if (!resolvedDatabase && parsed.database) {
      resolvedDatabase = parsed.database;
    }
  }

  const redshiftCfg = {
    host: resolvedHost,
    database: resolvedDatabase,
    user: cfg.username || cfg.user,
    password: cfg.password,
    port: resolvedPort,
    ssl: cfg.ssl !== false,
  };
  const schemaNames = parseSchemaList(cfg);
  const list = schemaNames.length > 0 ? schemaNames : ['public'];
  const out: RagTableSchemaRow[] = [];
  for (const schemaName of list) {
    const tables = await getRedshiftDatabaseSchema(redshiftCfg, schemaName);
    for (const t of tables) {
      out.push({
        schemaName: t.schema || schemaName,
        tableId: t.name,
        schema: t.columns,
        rowCount: undefined,
      });
    }
  }
  return out;
}

export async function fetchAzureSQLTableSchemas(cfg: any): Promise<RagTableSchemaRow[]> {
  const azCfg = {
    server: cfg.host || cfg.server,
    database: cfg.database,
    user: cfg.username || cfg.user,
    password: cfg.password,
    port: cfg.port ? parseInt(String(cfg.port), 10) : undefined,
    encrypt: cfg.encrypt ?? true,
    trustServerCertificate: cfg.trustServerCertificate ?? false,
  };
  const schemaNames = parseSchemaList(cfg);
  const out: RagTableSchemaRow[] = [];
  if (schemaNames.length > 0) {
    for (const sch of schemaNames) {
      const tables = await getAzureSQLDatabaseSchema(azCfg, sch);
      for (const t of tables) {
        out.push({
          schemaName: t.schema || sch,
          tableId: t.name,
          schema: t.columns,
          rowCount: undefined,
        });
      }
    }
    return out;
  }
  const tables = await getAzureSQLDatabaseSchema(azCfg);
  for (const t of tables) {
    out.push({
      schemaName: t.schema,
      tableId: t.name,
      schema: t.columns,
      rowCount: undefined,
    });
  }
  return out;
}

export async function fetchMySQLTableSchemas(cfg: any): Promise<RagTableSchemaRow[]> {
  const mysqlCfg = {
    host: cfg.host || cfg.server,
    database: cfg.database,
    user: cfg.username || cfg.user,
    password: cfg.password,
    port: cfg.port ? parseInt(String(cfg.port), 10) : undefined,
  };
  const tables = await fetchMySQLSchema(cfg.database, undefined, mysqlCfg);
  return tables.map((t) => ({
    schemaName: t.schema,
    tableId: t.name,
    schema: t.columns,
    rowCount: undefined,
  }));
}

export async function fetchSnowflakeTableSchemas(cfg: any): Promise<RagTableSchemaRow[]> {
  const baseCfg = {
    account: (cfg.account || cfg.host || cfg.server || '').toString().replace(/\.snowflakecomputing\.com$/i, ''),
    username: cfg.username || cfg.user,
    password: cfg.password,
    database: cfg.database,
    warehouse: cfg.warehouse,
  };
  const schemaNames = parseSchemaList(cfg);
  const list = schemaNames.length > 0 ? schemaNames : [cfg.schema || 'PUBLIC'];
  const out: RagTableSchemaRow[] = [];
  for (const schemaName of list) {
    const tables = await fetchSnowflakeSchema(schemaName, undefined, { ...baseCfg, schema: schemaName });
    for (const t of tables) {
      out.push({
        schemaName: t.schema || schemaName,
        tableId: t.name,
        schema: t.columns,
        rowCount: undefined,
      });
    }
  }
  return out;
}

export async function fetchDatabricksTableSchemas(cfg: any): Promise<RagTableSchemaRow[]> {
  const jdbcUrl =
    (cfg.jdbcUrl as string | undefined) ||
    (typeof cfg.host === 'string' && cfg.host.startsWith('jdbc:databricks://') ? (cfg.host as string) : undefined);
  let host = (cfg.serverHostname || cfg.host || cfg.server) as string | undefined;
  let httpPath = (cfg.httpPath || '') as string;
  let database = cfg.database as string | undefined;

  if (jdbcUrl && (cfg.connectionMethod === 'url' || jdbcUrl.startsWith('jdbc:databricks://'))) {
    const hostMatch = jdbcUrl.match(/^jdbc:databricks:\/\/([^:\/;]+)/i);
    if (hostMatch?.[1]) host = hostMatch[1];

    const pathMatch = jdbcUrl.match(/[;?]httpPath=([^;]+)/i);
    if (pathMatch?.[1]) httpPath = decodeURIComponent(pathMatch[1]);

    const dbMatch = jdbcUrl.match(/^jdbc:databricks:\/\/[^\/]+\/([^;?]+)/i);
    if (!database && dbMatch?.[1]) database = dbMatch[1];
  }

  const base = {
    host: host || '',
    token: (cfg.token || cfg.accessToken) as string,
    httpPath,
    catalog: cfg.catalog || database,
    schema: cfg.schema || 'default',
  };
  const schemasStr = cfg.schemas as string | undefined;
  const schemaList = schemasStr
    ? schemasStr.split(',').map((s: string) => s.trim()).filter(Boolean)
    : [base.schema || 'default'];
  const out: RagTableSchemaRow[] = [];
  for (const sch of schemaList) {
    const tables = await fetchDatabricksSchema(sch, undefined, { ...base, schema: sch });
    for (const t of tables) {
      out.push({
        schemaName: sch,
        tableId: t.name,
        database: base.catalog,
        schema: t.columns,
        rowCount: undefined,
      });
    }
  }
  return out;
}
