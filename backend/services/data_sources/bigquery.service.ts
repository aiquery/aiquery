import fs from 'fs';
import path from 'path';
import { BigQuery, BigQueryOptions, TableField } from '@google-cloud/bigquery';
import { BigQueryConfig, TableSchema, ColumnSchema, QueryResult } from '../../types';
import { getFinalExecutedQuery, isProhibitedSQL, isSafeToRun } from '../query/sqlSafety';

export { getFinalExecutedQuery, isSafeToRun };

let bigqueryClient: BigQuery | null = null;

function getBigQueryClient(config?: BigQueryConfig): BigQuery {
  if (!bigqueryClient) {
    const options: BigQueryOptions = {};

    const projectId = config?.projectId || process.env.BIGQUERY_PROJECT_ID;
    if (projectId) options.projectId = projectId;

    const rawKey = config?.keyFilename || process.env.GOOGLE_APPLICATION_CREDENTIALS;
    if (rawKey) {
      const keyPath = path.resolve(rawKey);
      options.keyFilename = keyPath;
      if (fs.existsSync(keyPath)) {
        try {
          const keyJson = JSON.parse(fs.readFileSync(keyPath, 'utf8'));
          const email = keyJson.client_email || '(unknown)';
          console.log(`[BigQuery] Using service account: ${email} (from ${keyPath})`);
        } catch {
          console.warn('[BigQuery] Could not read client_email from key file:', keyPath);
        }
      } else {
        console.warn('[BigQuery] Key file not found:', keyPath, '— requests may use Application Default Credentials instead.');
      }
    } else {
      console.warn('[BigQuery] GOOGLE_APPLICATION_CREDENTIALS not set — using Application Default Credentials (gcloud user or env).');
    }

    bigqueryClient = new BigQuery(options);
  }
  return bigqueryClient;
}

function mapBigQueryField(field: TableField): ColumnSchema {
  return {
    name: field.name || '',
    type: field.type || 'STRING',
    mode: field.mode || 'NULLABLE',
    description: field.description || undefined,
  };
}

export async function getDatasetSchema(
  projectId: string,
  datasetId: string
): Promise<TableSchema[]> {
  const bq = getBigQueryClient({ projectId, datasetId });
  const dataset = bq.dataset(datasetId, { projectId });

  const [tables] = await dataset.getTables();
  const schemas: TableSchema[] = [];

  await Promise.all(
    tables.map(async (table) => {
      try {
        const [metadata] = await table.getMetadata();
        const fields: TableField[] = metadata.schema?.fields || [];
        schemas.push({
          name: table.id || '',
          description: metadata.description || undefined,
          columns: fields.map(mapBigQueryField),
        });
      } catch (err) {
        console.warn(`Failed to get schema for table ${table.id}:`, err);
      }
    })
  );

  return schemas.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTableSchema(
  projectId: string,
  datasetId: string,
  tableId: string
): Promise<TableSchema> {
  const bq = getBigQueryClient({ projectId, datasetId });
  const table = bq.dataset(datasetId, { projectId }).table(tableId);
  const [metadata] = await table.getMetadata();
  const fields: TableField[] = metadata.schema?.fields || [];

  return {
    name: tableId,
    description: metadata.description || undefined,
    columns: fields.map(mapBigQueryField),
  };
}

export async function executeQuery(
  sql: string,
  projectId?: string
): Promise<QueryResult> {
  const bq = getBigQueryClient({ projectId: projectId || process.env.BIGQUERY_PROJECT_ID || '' });
  const startTime = Date.now();

  const [job] = await bq.createQueryJob({
    query: sql,
    useLegacySql: false,
    maximumBytesBilled: '10737418240', // 10 GB safety limit
  });

  const [rows, , response] = await job.getQueryResults({
    maxResults: 1000,
  });

  const latencyMs = Date.now() - startTime;
  const metadata = response?.jobComplete ? response : {};

  // Extract schema from response
  const schema: ColumnSchema[] = (response?.schema?.fields || []).map(
    (f: TableField) => mapBigQueryField(f)
  );

  return {
    rows: rows as Record<string, unknown>[],
    totalRows: rows.length,
    schema,
    jobId: job.id,
    bytesProcessed: Number(metadata?.totalBytesProcessed || 0),
    latencyMs,
  };
}

export async function listDatasets(projectId: string): Promise<string[]> {
  const bq = getBigQueryClient({ projectId });
  const [datasets] = await bq.getDatasets({ projectId });
  return datasets.map((d) => d.id || '').filter(Boolean);
}

export async function validateConnection(projectId: string): Promise<boolean> {
  try {
    const bq = getBigQueryClient({ projectId });
    await bq.getDatasets({ projectId, maxResults: 1 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build BigQuery options from UI: inline JSON string or path to service account key file.
 * Used by RAG routes and connection tests (does not use the module singleton).
 */
export function createBigQueryClient(params: {
  projectId: string;
  serviceAccountKey: string;
}): BigQuery {
  const { projectId, serviceAccountKey } = params;
  if (!projectId?.trim()) {
    throw new Error('Project ID is required');
  }
  if (!serviceAccountKey?.trim()) {
    throw new Error('Service Account Key is required');
  }

  const trimmed = serviceAccountKey.trim();
  const options: BigQueryOptions = { projectId };

  if (trimmed.startsWith('{')) {
    const creds = JSON.parse(trimmed) as Record<string, unknown>;
    if (!creds.client_email && !creds.type) {
      throw new Error('Invalid service account JSON (expected Google credentials object)');
    }
    (options as { credentials?: Record<string, unknown> }).credentials = creds;
  } else {
    const keyPath = path.resolve(trimmed);
    if (!fs.existsSync(keyPath)) {
      throw new Error(`Key file not found: ${keyPath}. Paste JSON or use a valid path.`);
    }
    options.keyFilename = keyPath;
  }

  return new BigQuery(options);
}

/**
 * Test BigQuery credentials from the connection UI (inline JSON or path to key file).
 * Uses a fresh client — does not mutate the module singleton used for queries.
 */
export async function testBigQueryConnection(params: {
  projectId: string;
  serviceAccountKey: string;
}): Promise<{ success: boolean; error?: string }> {
  const { projectId, serviceAccountKey } = params;
  if (!projectId?.trim()) {
    return { success: false, error: 'Project ID is required' };
  }
  if (!serviceAccountKey?.trim()) {
    return { success: false, error: 'Service Account Key is required' };
  }

  try {
    const bq = createBigQueryClient({ projectId, serviceAccountKey });
    await bq.getDatasets({ projectId, maxResults: 1 });
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

/** Moved to rag_service/schema-discovery.ts to centralize RAG discovery helpers. */
export { fetchBigQueryTableSchemas } from '../rag_service/schema-discovery';

/** Validate read-only SQL and run with workspace credentials (chat / QueryExecutor). */
export async function validateAndExecuteSQL(
  sql: string,
  config: { projectId: string; serviceAccountKey: string }
): Promise<Record<string, unknown>[]> {
  const normalized = getFinalExecutedQuery(sql);
  const bad = isProhibitedSQL(normalized);
  if (bad.prohibited) {
    throw new Error(
      `Query blocked: ${bad.keyword?.toUpperCase() || 'This'} statements are not allowed. Only read-only queries are permitted.`
    );
  }
  const bq = createBigQueryClient(config);
  const [job] = await bq.createQueryJob({
    query: normalized,
    useLegacySql: false,
    maximumBytesBilled: '10737418240',
  });
  const [rows] = await job.getQueryResults({ maxResults: 1000 });
  return (rows as Record<string, unknown>[]) || [];
}
