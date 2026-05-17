/**
 * User-scoped Knowledge Bases (RAG indices) stored as JSON under backend/rag-indices/user_<id>/.
 * Used by /api/rag/indexes, /api/rag/create, chat RAG context, etc.
 */

import fs from 'fs';
import path from 'path';
import {
  fetchAirtableSchema,
  fetchAzureSQLTableSchemas,
  fetchBigQueryTableSchemas,
  fetchDatabricksTableSchemas,
  fetchMySQLTableSchemas,
  fetchPostgresSQLTableSchemas,
  fetchRedshiftTableSchemas,
  fetchSnowflakeTableSchemas,
} from './schema-discovery';
import { LLMProvider } from '../../helpers/llm-config';
import type { ColumnSchema } from '../../types';
import { generateTableAndColumnDescriptions, type RagTableSchemaForLlm } from './generate-rag-descriptions';

/** Rich table shape aligned with legacy `backend/rag/*.json` (e.g. bigquery_adk-666_*.json). */
export interface RagKeyColumnEntry {
  name: string;
  type: string;
  description: string;
  examples?: (string | number | boolean)[];
}

export interface RichRagTableMeta {
  tableName: string;
  description: string;
  purpose: string;
  keyColumns: RagKeyColumnEntry[];
  relationships: string;
  sampleQuestions: string[];
}

function buildDocumentContent(
  fullTableId: string,
  rich: RichRagTableMeta,
  columnLines: string
): string {
  const lines: string[] = [
    `Table: ${fullTableId}`,
    `Description: ${rich.description}`,
    `Purpose: ${rich.purpose}`,
    '',
    'Columns:',
    columnLines,
    '',
  ];
  if (rich.relationships) {
    lines.push(`Relationships: ${rich.relationships}`, '');
  }
  if (rich.sampleQuestions?.length) {
    lines.push('Sample Questions:');
    rich.sampleQuestions.forEach((q) => lines.push(`- ${q}`));
  }
  return lines.join('\n');
}

/**
 * Build rich metadata for one BigQuery table: LLM descriptions (default) or catalog metadata only.
 */
async function buildRichMetaForBigQueryTable(
  projectId: string,
  row: { datasetId: string; tableId: string; rowCount?: number },
  cols: ColumnSchema[],
  llmProvider: LLMProvider,
  llmApiKey: string,
  llmModel: string | undefined,
  columnDescriptionMode: 'generate' | 'metadata' | undefined
): Promise<RichRagTableMeta> {
  const { datasetId, tableId, rowCount } = row;
  const fullId = `${datasetId}.${tableId}`;

  if (columnDescriptionMode === 'metadata') {
    const rowHint =
      rowCount != null && Number.isFinite(rowCount)
        ? `Approximately ${Number(rowCount).toLocaleString()} row(s). `
        : '';
    const description = `${rowHint}Table \`${fullId}\` in BigQuery. Columns: ${cols.map((c) => c.name).join(', ')}.`;
    return {
      tableName: tableId,
      description,
      purpose: '',
      keyColumns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        description:
          (c.description && String(c.description).trim()) ||
          `Column \`${c.name}\` (${c.type}).`,
        examples: [],
      })),
      relationships: '',
      sampleQuestions: [],
    };
  }

  const tableSchema: RagTableSchemaForLlm = {
    projectId,
    datasetId,
    tableId,
    schema: cols.map((c) => ({
      name: c.name,
      type: c.type,
      mode: c.mode,
      description: c.description,
      nullable: c.nullable,
    })),
    rowCount,
    dataSourceType: 'bigquery',
  };

  const gen = await generateTableAndColumnDescriptions(
    tableSchema,
    llmProvider,
    llmApiKey,
    llmModel
  );

  return {
    tableName: tableId,
    description: gen.tableDescription,
    purpose: gen.purpose,
    keyColumns: cols.map((c) => ({
      name: c.name,
      type: c.type,
      description:
        (gen.columnDescriptions[c.name] && gen.columnDescriptions[c.name].trim()) ||
        (c.description && String(c.description).trim()) ||
        `Column \`${c.name}\` (${c.type}).`,
      examples: [],
    })),
    relationships: '',
    sampleQuestions: [],
  };
}

async function buildRichMetaForSqlTable(
  dataSourceType: 'redshift' | 'azure' | 'sqlserver' | 'snowflake' | 'mysql' | 'postgres' | 'postgresql' | 'airtable' | 'databricks',
  row: { database: string; schemaName?: string; tableId: string; rowCount?: number },
  cols: ColumnSchema[],
  llmProvider: LLMProvider,
  llmApiKey: string,
  llmModel: string | undefined,
  columnDescriptionMode: 'generate' | 'metadata' | undefined
): Promise<RichRagTableMeta> {
  const { database, schemaName, tableId, rowCount } = row;
  const fullId = schemaName ? `${schemaName}.${tableId}` : tableId;

  if (columnDescriptionMode === 'metadata') {
    const rowHint =
      rowCount != null && Number.isFinite(rowCount)
        ? `Approximately ${Number(rowCount).toLocaleString()} row(s). `
        : '';
    const description = `${rowHint}Table \`${fullId}\` in ${database}. Columns: ${cols.map((c) => c.name).join(', ')}.`;
    return {
      tableName: tableId,
      description,
      purpose: '',
      keyColumns: cols.map((c) => ({
        name: c.name,
        type: c.type,
        description:
          (c.description && String(c.description).trim()) ||
          `Column \`${c.name}\` (${c.type}).`,
        examples: [],
      })),
      relationships: '',
      sampleQuestions: [],
    };
  }

  const tableSchema: RagTableSchemaForLlm = {
    database,
    schemaName,
    tableId,
    schema: cols.map((c) => ({
      name: c.name,
      type: c.type,
      mode: c.mode,
      description: c.description,
      nullable: c.nullable,
    })),
    rowCount,
    dataSourceType,
  };

  const gen = await generateTableAndColumnDescriptions(
    tableSchema,
    llmProvider,
    llmApiKey,
    llmModel
  );

  return {
    tableName: tableId,
    description: gen.tableDescription,
    purpose: gen.purpose,
    keyColumns: cols.map((c) => ({
      name: c.name,
      type: c.type,
      description:
        (gen.columnDescriptions[c.name] && gen.columnDescriptions[c.name].trim()) ||
        (c.description && String(c.description).trim()) ||
        `Column \`${c.name}\` (${c.type}).`,
      examples: [],
    })),
    relationships: '',
    sampleQuestions: [],
  };
}

/** Build RichRagTableMeta from a persisted table row (for PUT /api/rag/table). */
function tableRecordToRichMeta(t: Record<string, unknown>): RichRagTableMeta {
  const name = String(t.name ?? '');
  const description = String(t.description ?? t.summary ?? '');
  const purpose = String(t.purpose ?? '');
  let keyColumns: RagKeyColumnEntry[] = Array.isArray(t.keyColumns)
    ? (t.keyColumns as RagKeyColumnEntry[])
    : [];
  const colSchemas = (t.columns as ColumnSchema[] | undefined) || [];
  if (keyColumns.length === 0 && colSchemas.length > 0) {
    keyColumns = colSchemas.map((c) => ({
      name: c.name,
      type: c.type,
      description:
        (c.description && String(c.description).trim()) ||
        (c.ragDescription && String(c.ragDescription).trim()) ||
        `Column \`${c.name}\` (${c.type}).`,
      examples: [],
    }));
  } else if (colSchemas.length > 0 && keyColumns.length > 0) {
    const cm = new Map(colSchemas.map((c) => [c.name, c]));
    keyColumns = keyColumns.map((k) => {
      const c = cm.get(k.name);
      return {
        name: k.name,
        type: c?.type || k.type,
        description:
          (c?.description && String(c.description).trim()) ||
          (k.description && String(k.description).trim()) ||
          `Column \`${k.name}\`.`,
        examples: k.examples,
      };
    });
  }
  return {
    tableName: name,
    description,
    purpose,
    keyColumns,
    relationships: String(t.relationships ?? ''),
    sampleQuestions: Array.isArray(t.sampleQuestions) ? (t.sampleQuestions as string[]) : [],
  };
}

/** Text blob for chat RAG retrieval (same shape as former per-table document `content`). */
function buildRagTextFromTableRecord(t: Record<string, unknown>): string {
  const rich = tableRecordToRichMeta(t);
  const fullId = String(
    t.id ?? (t.dataset != null && t.name != null ? `${t.dataset}.${t.name}` : t.name ?? rich.tableName)
  );
  const columnLines = rich.keyColumns.map((k) => `- ${k.name} (${k.type}): ${k.description}`).join('\n');
  return buildDocumentContent(fullId, rich, columnLines);
}

/**
 * Canonical KB storage root (same for ts-node dev and `node dist/backend/server.js`).
 * Resolves to `<repo>/backend/rag-indices` when the process cwd is the repo root.
 * Set `RAG_INDICES_DIR` to override (absolute path to the folder that contains `user_<id>/`).
 */
export function getRagIndicesRoot(): string {
  const env = process.env.RAG_INDICES_DIR?.trim();
  if (env) {
    return path.resolve(env);
  }
  const cwd = process.cwd();
  if (path.basename(cwd) === 'backend') {
    return path.join(cwd, 'rag-indices');
  }
  return path.join(cwd, 'backend', 'rag-indices');
}

function getUserRagDir(userId: number, _userName?: string | null): string {
  return path.join(getRagIndicesRoot(), `user_${userId}`);
}

export function createUserRAGDirectory(userId: number, _userName?: string | null): void {
  const dir = getUserRagDir(userId);
  fs.mkdirSync(dir, { recursive: true });
}

function loadKbJsonFiles(dir: string, indexes: unknown[], seenIds: Set<string>): void {
  if (!fs.existsSync(dir)) return;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    try {
      const fp = path.join(dir, file);
      const raw = fs.readFileSync(fp, 'utf-8');
      const data = JSON.parse(raw) as Record<string, unknown>;
      const id = String(data.id ?? file);
      if (seenIds.has(id)) continue;
      seenIds.add(id);
      indexes.push({
        ...data,
        filePath: fp,
      });
    } catch {
      // skip malformed
    }
  }
}

/** Safe filename segment for one KB file per BigQuery project. */
export function sanitizeKbFileSegment(projectId: string): string {
  return projectId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
}

/** e.g. `2026-02-25T04-09-43` (colons in time → hyphens, no ms/Z). */
export function formatRagFileDateTime(d = new Date()): string {
  return d.toISOString().replace(/:/g, '-').replace(/\.\d{3}Z$/, '');
}

/**
 * BigQuery KB JSON filename: `bigquery_<workspace>_<project>_<datetime>.json`
 * If workspace name is omitted, `bigquery_<project>_<datetime>.json` (matches e.g. `bigquery_adk-666_2026-02-25T04-09-43.json`).
 */
export function buildBigQueryRagFileName(workspaceName: string | undefined | null, projectId: string): string {
  const dt = formatRagFileDateTime();
  const proj = sanitizeKbFileSegment(projectId);
  const ws =
    workspaceName && String(workspaceName).trim()
      ? sanitizeKbFileSegment(String(workspaceName).trim())
      : '';
  if (ws) {
    return `bigquery_${ws}_${proj}_${dt}.json`;
  }
  return `bigquery_${proj}_${dt}.json`;
}

function buildSourceRagFileName(
  sourceKey: NonNullable<ReturnType<typeof getCanonicalSourceKey>>,
  workspaceName: string | undefined | null,
  identifier: string
): string {
  const dt = formatRagFileDateTime();
  const safeId = sanitizeKbFileSegment(identifier);
  const ws =
    workspaceName && String(workspaceName).trim()
      ? sanitizeKbFileSegment(String(workspaceName).trim())
      : '';
  if (ws) {
    return `${sourceKey}_${ws}_${safeId}_${dt}.json`;
  }
  return `${sourceKey}_${safeId}_${dt}.json`;
}

function scoreBigQueryIndexFileName(filePath: string, projectId: string): number {
  const file = path.basename(filePath);
  const safe = sanitizeKbFileSegment(projectId);
  if (file.startsWith('bigquery_')) return 2e15;
  if (file === `${safe}.json`) return 1e15;
  return 0;
}

function getCanonicalSourceKey(sourceType: unknown): 'airtable' | 'bigquery' | 'databricks' | 'postgresql' | 'redshift' | 'azure' | 'snowflake' | 'mysql' | null {
  const t = String(sourceType || '').toLowerCase().trim();
  if (!t) return null;
  if (t === 'sqlserver') return 'azure';
  if (t === 'postgres') return 'postgresql';
  if (t === 'airtable' || t === 'bigquery' || t === 'databricks' || t === 'postgresql' || t === 'redshift' || t === 'azure' || t === 'snowflake' || t === 'mysql') {
    return t;
  }
  return null;
}

function pickLatestKbEntry(
  entries: Array<{ fp: string; data: Record<string, unknown>; file: string }>
): { fp: string; data: Record<string, unknown>; file: string } | null {
  if (!entries.length) return null;
  return entries.sort((a, b) => {
    const at = new Date(String(a.data.updatedAt || a.data.createdAt || 0)).getTime();
    const bt = new Date(String(b.data.updatedAt || b.data.createdAt || 0)).getTime();
    return bt - at;
  })[0];
}

function cleanupSourceDuplicates(
  userId: number,
  sourceKey: ReturnType<typeof getCanonicalSourceKey>,
  keepPath: string
): void {
  if (!sourceKey) return;
  for (const entry of readUserKbIndexFiles(userId)) {
    const key = getCanonicalSourceKey(entry.data.dataSourceType);
    if (key !== sourceKey) continue;
    if (entry.fp === keepPath) continue;
    try {
      if (fs.existsSync(entry.fp)) fs.unlinkSync(entry.fp);
    } catch {
      // ignore
    }
  }
}

function resolveSourceKbPath(
  dir: string,
  sourceKey: NonNullable<ReturnType<typeof getCanonicalSourceKey>>,
  existingEntry: { fp: string } | null,
  workspaceName: string | undefined | null,
  identifier: string
): string {
  const existing = existingEntry?.fp;
  if (existing && path.basename(existing).startsWith(`${sourceKey}_`)) {
    return existing;
  }
  return path.join(dir, buildSourceRagFileName(sourceKey, workspaceName, identifier));
}

function enforceSingleKbFilePerSource(userId: number): void {
  const groups = new Map<NonNullable<ReturnType<typeof getCanonicalSourceKey>>, Array<{ fp: string; data: Record<string, unknown>; file: string }>>();
  for (const entry of readUserKbIndexFiles(userId)) {
    const key = getCanonicalSourceKey(entry.data.dataSourceType);
    if (!key) continue;
    const list = groups.get(key) || [];
    list.push(entry);
    groups.set(key, list);
  }
  for (const [sourceKey, entries] of groups) {
    if (entries.length <= 1) continue;
    let keep = entries[0];
    let bestScore = -1;
    for (const e of entries) {
      const t = new Date(String(e.data.updatedAt || e.data.createdAt || 0)).getTime();
      const canonicalScore = path.basename(e.fp).startsWith(`${sourceKey}_`) ? 1e15 : 0;
      const score = canonicalScore + t;
      if (score > bestScore) {
        bestScore = score;
        keep = e;
      }
    }
    cleanupSourceDuplicates(userId, sourceKey, keep.fp);
  }
}

/**
 * When multiple JSON files exist for the same BigQuery project (legacy names),
 * keep a single entry — prefer `bigquery_*.json`, then `<sanitizedProjectId>.json`, else newest `updatedAt`.
 */
function dedupeBigQueryIndexes(indexes: Array<Record<string, unknown>>): unknown[] {
  const rest: unknown[] = [];
  const sourceGroups = new Map<NonNullable<ReturnType<typeof getCanonicalSourceKey>>, Record<string, unknown>[]>();
  for (const idx of indexes) {
    const key = getCanonicalSourceKey(idx.dataSourceType);
    if (key) {
      const list = sourceGroups.get(key) || [];
      list.push(idx);
      sourceGroups.set(key, list);
    } else {
      rest.push(idx);
    }
  }
  const merged: unknown[] = [];
  for (const [sourceKey, group] of sourceGroups) {
    let best = group[0];
    let bestScore = -1;
    for (const idx of group) {
      const fp = String(idx.filePath || '');
      const t = new Date(String(idx.updatedAt || idx.createdAt || 0)).getTime();
      const score = (path.basename(fp).startsWith(`${sourceKey}_`) ? 1e15 : 0) + t;
      if (score > bestScore) {
        bestScore = score;
        best = idx;
      }
    }
    merged.push(best);
  }
  return [...rest, ...merged];
}

export async function getAllRAGIndexes(userId: number, _userName?: string | null): Promise<unknown[]> {
  enforceSingleKbFilePerSource(userId);
  const indexes: unknown[] = [];
  const seenIds = new Set<string>();
  const primary = getUserRagDir(userId);
  loadKbJsonFiles(primary, indexes, seenIds);
  // Older builds resolved __dirname to dist/backend/services/... and wrote under dist/backend/rag-indices
  const legacyDist = path.join(process.cwd(), 'dist', 'backend', 'rag-indices', `user_${userId}`);
  loadKbJsonFiles(legacyDist, indexes, seenIds);
  return dedupeBigQueryIndexes(indexes as Array<Record<string, unknown>>);
}

/** JSON files for this user: canonical dir first, then legacy dist layout (older builds). */
function readUserKbIndexFiles(userId: number): Array<{ fp: string; data: Record<string, unknown>; file: string }> {
  const out: Array<{ fp: string; data: Record<string, unknown>; file: string }> = [];
  const dirs = [
    getUserRagDir(userId),
    path.join(process.cwd(), 'dist', 'backend', 'rag-indices', `user_${userId}`),
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
      const fp = path.join(dir, file);
      try {
        const data = JSON.parse(fs.readFileSync(fp, 'utf-8')) as Record<string, unknown>;
        out.push({ fp, data, file });
      } catch {
        // skip malformed
      }
    }
  }
  return out;
}

function pickBestBigQueryKbEntry(
  projectId: string,
  entries: Array<{ fp: string; data: Record<string, unknown>; file: string }>
): { fp: string; data: Record<string, unknown>; file: string } {
  let best = entries[0];
  let bestScore = -1;
  for (const e of entries) {
    const { fp, data } = e;
    const t = new Date(String(data.updatedAt || data.createdAt || 0)).getTime();
    const score = scoreBigQueryIndexFileName(fp, projectId) + t;
    if (score > bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Merge BigQuery table rows: replace_all = this run only; else overwrite by table id + keep others. */
function mergeBigQueryTables(
  existingTables: Array<Record<string, unknown>> | undefined,
  incoming: Array<Record<string, unknown>>,
  mergeMode: 'replace_all' | 'replace_columns' | 'add_columns' | undefined
): Array<Record<string, unknown>> {
  if (mergeMode === 'replace_all') {
    return incoming;
  }
  const byId = new Map<string, Record<string, unknown>>();
  for (const t of existingTables || []) {
    const id = String((t as { id?: string }).id ?? '');
    if (id) byId.set(id, t);
  }
  for (const t of incoming) {
    const id = String((t as { id?: string }).id ?? '');
    if (id) byId.set(id, t);
  }
  return Array.from(byId.values());
}

function mergeDatasetLists(
  existing: unknown,
  incoming: string[],
  mergeMode: 'replace_all' | 'replace_columns' | 'add_columns' | undefined
): string[] {
  if (mergeMode === 'replace_all') {
    return [...new Set(incoming)];
  }
  const prev = Array.isArray(existing) ? (existing as string[]) : [];
  return [...new Set([...prev, ...incoming])];
}

export async function getRAGIndex(
  identifier: string,
  userId: number,
  _userName?: string | null
): Promise<{ id: string; filePath: string; [k: string]: unknown } | null> {
  const candidates: Array<{ fp: string; data: Record<string, unknown>; file: string }> = [];
  for (const entry of readUserKbIndexFiles(userId)) {
    const { fp, data, file } = entry;
    const pid = data.projectId ?? data.baseId ?? data.database;
    const idStr = String(data.id ?? '');
    if (
      pid === identifier ||
      idStr === identifier ||
      String(file).startsWith(`${identifier}_`) ||
      String(file).includes(identifier)
    ) {
      candidates.push(entry);
    }
  }
  if (candidates.length === 0) return null;
  if (candidates.length === 1) {
    const { fp, data } = candidates[0];
    return { ...data, id: String(data.id ?? identifier), filePath: fp };
  }
  const bqSameProject = candidates.filter(
    (c) => c.data.dataSourceType === 'bigquery' && String(c.data.projectId) === identifier
  );
  if (bqSameProject.length >= 1) {
    const best = pickBestBigQueryKbEntry(identifier, bqSameProject);
    return { ...best.data, id: String(best.data.id ?? identifier), filePath: best.fp };
  }
  const { fp, data } = candidates[0];
  return { ...data, id: String(data.id ?? identifier), filePath: fp };
}

export async function retrieveRAGContext(
  question: string,
  indexId: string,
  userId: number,
  topK: number,
  _userName?: string | null
): Promise<string> {
  let doc: Record<string, unknown> | null = null;
  for (const { data, file } of readUserKbIndexFiles(userId)) {
    if (String(data.id) === indexId || file.includes(indexId)) {
      doc = data;
      break;
    }
  }
  if (!doc) return '';
  const qWords = question.toLowerCase().split(/\s+/).filter((w) => w.length > 2);

  const tables = (doc.tables as Record<string, unknown>[]) || [];
  if (tables.length > 0) {
    const scored = tables.map((t) => {
      const text = buildRagTextFromTableRecord(t);
      const score = qWords.filter((w) => text.toLowerCase().includes(w)).length;
      return { text, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored
      .slice(0, topK)
      .map((x) => x.text)
      .filter(Boolean)
      .join('\n\n');
  }

  // Legacy indexes: chunked "documents" array (no longer written for new KBs)
  const documents = (doc.documents as Array<{ content?: string; metadata?: unknown }>) || [];
  if (!documents.length) return '';
  const scoredLegacy = documents.map((d) => {
    const text = `${d.content || ''} ${JSON.stringify(d.metadata || {})}`;
    const score = qWords.filter((w) => text.toLowerCase().includes(w)).length;
    return { d, score };
  });
  scoredLegacy.sort((a, b) => b.score - a.score);
  return scoredLegacy
    .slice(0, topK)
    .map((x) => x.d.content)
    .filter(Boolean)
    .join('\n\n');
}

export async function createRAGIndex(
  connectionConfig: { projectId?: string; serviceAccountKey?: string; apiKey?: string; baseId?: string; [k: string]: unknown },
  datasetsArray: string[],
  tablesArray: string[],
  userId: number,
  sourceType: 'bigquery' | 'airtable' | 'redshift' | 'azure' | 'sqlserver' | 'snowflake' | 'mysql' | 'postgres' | 'postgresql' | 'databricks',
  llmProvider: LLMProvider,
  llmApiKey: string,
  userName: string | null,
  columnsMap: { [tableId: string]: string[] },
  mergeMode?: 'replace_all' | 'replace_columns' | 'add_columns',
  columnDescriptionMode?: 'generate' | 'metadata',
  llmModel?: string,
  /** Used for RAG JSON filename: `bigquery_<workspace>_<project>_<datetime>.json` */
  workspaceName?: string | null
): Promise<{ indexId: string; filePath: string }> {
  createUserRAGDirectory(userId, userName);
  enforceSingleKbFilePerSource(userId);
  const dir = getUserRagDir(userId);

  if (sourceType === 'airtable') {
    const apiKey = connectionConfig.apiKey as string | undefined;
    const baseId = connectionConfig.baseId as string | undefined;
    if (!apiKey || !baseId) {
      throw new Error('Airtable apiKey and baseId are required');
    }

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const tablesOut: Array<Record<string, unknown>> = [];

    for (const tableId of wanted) {
      const schemas = await fetchAirtableSchema(tableId, { apiKey, baseId });
      const row = schemas[0];
      if (!row) continue;

      let cols = row.columns;
      const pick = columnsMap[tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        'airtable',
        {
          database: baseId,
          tableId: row.name || tableId,
          rowCount: undefined,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: tableId,
        tableName: row.name || tableId,
        name: row.name || tableId,
        dataset: '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No Airtable table schemas found for the selected tables.');
    }

    const sourceKey = getCanonicalSourceKey('airtable')!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, workspaceName, baseId);
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      baseId,
      dataSourceType: 'airtable',
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'bigquery') {
    const projectId = connectionConfig.projectId as string;
    const serviceAccountKey = connectionConfig.serviceAccountKey as string;
    if (!projectId || !serviceAccountKey) {
      throw new Error('BigQuery projectId and serviceAccountKey are required');
    }

    const allRows = await fetchBigQueryTableSchemas({ projectId, serviceAccountKey }, datasetsArray);
    const wanted = new Set(tablesArray.map((t) => t.trim()));
    const filtered = allRows.filter((r) => wanted.has(`${r.datasetId}.${r.tableId}`));

    const tablesOut: Array<Record<string, unknown>> = [];

    for (const row of filtered) {
      const tableId = `${row.datasetId}.${row.tableId}`;
      let cols = row.schema;
      const pick = columnsMap[tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }
      const rich = await buildRichMetaForBigQueryTable(
        projectId,
        { datasetId: row.datasetId, tableId: row.tableId, rowCount: row.rowCount },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: tableId,
        tableName: row.tableId,
        name: row.tableId,
        dataset: row.datasetId,
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    const sourceKey = getCanonicalSourceKey('bigquery')!;
    const bqFiles = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = bqFiles.length ? pickLatestKbEntry(bqFiles) : null;
    const existing = existingEntry?.data;

    const resolvedWorkspaceName =
      workspaceName != null && String(workspaceName).trim()
        ? String(workspaceName).trim()
        : ((existing?.workspaceName as string | undefined) ?? null);

    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, resolvedWorkspaceName, projectId);

    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const mergedDatasets = mergeDatasetLists(existing?.datasets, datasetsArray, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      projectId,
      workspaceName: resolvedWorkspaceName ?? undefined,
      dataSourceType: 'bigquery',
      datasetId: mergedDatasets[0] ?? datasetsArray[0],
      model: llmModel ?? (existing?.model as string | null) ?? null,
      datasets: mergedDatasets,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);

    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'redshift') {
    const username = connectionConfig.username as string | undefined;
    const password = connectionConfig.password as string | undefined;
    const database = connectionConfig.database as string | undefined;
    const connectionMethod = connectionConfig.connectionMethod as 'host' | 'url' | undefined;
    const usesPgPass = String(connectionConfig.authMethod || '').toLowerCase() === 'pgpass';
    const host = (connectionConfig.host || connectionConfig.server || connectionConfig.serverUrl || connectionConfig.jdbcUrl) as string | undefined;

    if (!username || (!usesPgPass && !password)) {
      throw new Error(usesPgPass ? 'Redshift username is required' : 'Redshift username and password are required');
    }
    if (connectionMethod !== 'url' && !database) {
      throw new Error('Redshift database is required for host connection mode');
    }
    if (!host) {
      throw new Error('Redshift host/server or JDBC URL is required');
    }

    const allRows = await fetchRedshiftTableSchemas({
      host: connectionConfig.host,
      server: connectionConfig.server,
      serverUrl: connectionConfig.serverUrl,
      port: connectionConfig.port,
      database: database || '',
      schema: connectionConfig.schema,
      schemas: connectionConfig.schemas,
      username,
      password,
      jdbcUrl: connectionConfig.jdbcUrl,
      connectionMethod,
    });

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const filtered = allRows.filter((r) => {
      const fullId = r.schemaName ? `${r.schemaName}.${r.tableId}` : r.tableId;
      return wanted.has(fullId) || wanted.has(r.tableId);
    });

    const tablesOut: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const fullId = row.schemaName ? `${row.schemaName}.${row.tableId}` : row.tableId;
      let cols = row.schema;
      const pick = columnsMap[fullId] || columnsMap[row.tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        'redshift',
        {
          database: row.database || database || '',
          schemaName: row.schemaName,
          tableId: row.tableId,
          rowCount: row.rowCount,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: fullId,
        tableName: row.tableId,
        name: row.tableId,
        schemaName: row.schemaName || '',
        dataset: row.schemaName || '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No Redshift table schemas found for the selected tables.');
    }

    const dbId = String(database || 'redshift');
    const sourceKey = getCanonicalSourceKey('redshift')!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, workspaceName, dbId);
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      database: dbId,
      dataSourceType: 'redshift',
      schema: connectionConfig.schema as string | undefined,
      schemas: connectionConfig.schemas as string | undefined,
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'azure' || sourceType === 'sqlserver') {
    const username = connectionConfig.username as string | undefined;
    const password = connectionConfig.password as string | undefined;
    const database = connectionConfig.database as string | undefined;
    const host = (connectionConfig.host || connectionConfig.server || connectionConfig.serverUrl) as string | undefined;

    if (!username || !password) {
      throw new Error('Azure SQL username and password are required');
    }
    if (!database) {
      throw new Error('Azure SQL database is required');
    }
    if (!host) {
      throw new Error('Azure SQL host/server is required');
    }

    const allRows = await fetchAzureSQLTableSchemas({
      host: connectionConfig.host,
      server: connectionConfig.server || connectionConfig.serverUrl,
      port: connectionConfig.port,
      database,
      schema: connectionConfig.schema,
      schemas: connectionConfig.schemas,
      username,
      password,
    });

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const filtered = allRows.filter((r) => {
      const fullId = r.schemaName ? `${r.schemaName}.${r.tableId}` : r.tableId;
      return wanted.has(fullId) || wanted.has(r.tableId);
    });

    const tablesOut: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const fullId = row.schemaName ? `${row.schemaName}.${row.tableId}` : row.tableId;
      let cols = row.schema;
      const pick = columnsMap[fullId] || columnsMap[row.tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        sourceType,
        {
          database,
          schemaName: row.schemaName,
          tableId: row.tableId,
          rowCount: row.rowCount,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: fullId,
        tableName: row.tableId,
        name: row.tableId,
        schemaName: row.schemaName || '',
        dataset: row.schemaName || '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No Azure SQL table schemas found for the selected tables.');
    }

    const sourceKey = getCanonicalSourceKey(sourceType)!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, workspaceName, String(database));
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      database,
      dataSourceType: sourceType,
      schema: connectionConfig.schema as string | undefined,
      schemas: connectionConfig.schemas as string | undefined,
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'snowflake') {
    const username = connectionConfig.username as string | undefined;
    const password = connectionConfig.password as string | undefined;
    const database = connectionConfig.database as string | undefined;
    const account = (connectionConfig.account || connectionConfig.host || connectionConfig.server) as string | undefined;
    const warehouse = connectionConfig.warehouse as string | undefined;

    if (!username || !password) {
      throw new Error('Snowflake username and password are required');
    }
    if (!database) {
      throw new Error('Snowflake database is required');
    }
    if (!account) {
      throw new Error('Snowflake account (or host/server) is required');
    }
    if (!warehouse) {
      throw new Error('Snowflake warehouse is required');
    }

    // Prefer explicit schemas from UI config; otherwise infer from selected table ids.
    const configuredSchemas = String(connectionConfig.schemas || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const inferredSchemas = tablesArray
      .map((t) => t.split('.'))
      .filter((parts) => parts.length >= 2)
      .map((parts) => parts[0].trim())
      .filter(Boolean);
    const schemasForFetch = [...new Set([...(configuredSchemas.length ? configuredSchemas : []), ...inferredSchemas])];

    const allRows = await fetchSnowflakeTableSchemas({
      account,
      host: connectionConfig.host,
      server: connectionConfig.server,
      port: connectionConfig.port,
      database,
      schema: connectionConfig.schema,
      schemas: schemasForFetch.length ? schemasForFetch.join(',') : connectionConfig.schemas,
      username,
      password,
      warehouse,
    });

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const filtered = allRows.filter((r) => {
      const fullId = r.schemaName ? `${r.schemaName}.${r.tableId}` : r.tableId;
      return wanted.has(fullId) || wanted.has(r.tableId);
    });

    const tablesOut: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const fullId = row.schemaName ? `${row.schemaName}.${row.tableId}` : row.tableId;
      let cols = row.schema;
      const pick = columnsMap[fullId] || columnsMap[row.tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        'snowflake',
        {
          database,
          schemaName: row.schemaName,
          tableId: row.tableId,
          rowCount: row.rowCount,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: fullId,
        tableName: row.tableId,
        name: row.tableId,
        schemaName: row.schemaName || '',
        dataset: row.schemaName || '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No Snowflake table schemas found for the selected tables.');
    }

    const sourceKey = getCanonicalSourceKey('snowflake')!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, workspaceName, String(database));
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      database,
      dataSourceType: 'snowflake',
      schema: connectionConfig.schema as string | undefined,
      schemas: schemasForFetch.length ? schemasForFetch.join(',') : (connectionConfig.schemas as string | undefined),
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'mysql') {
    const username = connectionConfig.username as string | undefined;
    const password = connectionConfig.password as string | undefined;
    const database = connectionConfig.database as string | undefined;
    const host = (connectionConfig.host || connectionConfig.server || connectionConfig.serverUrl) as string | undefined;

    if (!username || !password) {
      throw new Error('MySQL username and password are required');
    }
    if (!database) {
      throw new Error('MySQL database is required');
    }
    if (!host) {
      throw new Error('MySQL host/server is required');
    }

    const allRows = await fetchMySQLTableSchemas({
      host: connectionConfig.host,
      server: connectionConfig.server || connectionConfig.serverUrl,
      port: connectionConfig.port,
      database,
      schema: connectionConfig.schema,
      username,
      password,
    });

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const filtered = allRows.filter((r) => {
      const fullId = r.schemaName ? `${r.schemaName}.${r.tableId}` : r.tableId;
      return wanted.has(fullId) || wanted.has(r.tableId);
    });

    const tablesOut: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const fullId = row.schemaName ? `${row.schemaName}.${row.tableId}` : row.tableId;
      let cols = row.schema;
      const pick = columnsMap[fullId] || columnsMap[row.tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        'mysql',
        {
          database,
          schemaName: row.schemaName,
          tableId: row.tableId,
          rowCount: row.rowCount,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: fullId,
        tableName: row.tableId,
        name: row.tableId,
        schemaName: row.schemaName || '',
        dataset: row.schemaName || '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No MySQL table schemas found for the selected tables.');
    }

    const sourceKey = getCanonicalSourceKey('mysql')!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, workspaceName, String(database));
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      database,
      dataSourceType: 'mysql',
      schema: connectionConfig.schema as string | undefined,
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'databricks') {
    const connectionMethod = String(connectionConfig.connectionMethod || 'url').toLowerCase();
    const token = (connectionConfig.token || connectionConfig.accessToken) as string | undefined;
    const jdbcUrl = connectionConfig.jdbcUrl as string | undefined;
    const rawHost = (connectionConfig.serverHostname || connectionConfig.host || connectionConfig.server) as string | undefined;
    const database = (connectionConfig.database || connectionConfig.catalog) as string | undefined;

    if (connectionMethod === 'host') {
      if (!token) {
        throw new Error('Databricks host connection for Knowledge Base requires token/accessToken.');
      }
      if (!rawHost) {
        throw new Error('Databricks host/server is required');
      }
    } else {
      if (!jdbcUrl || !token) {
        throw new Error('Databricks jdbcUrl and token/accessToken are required');
      }
    }

    const configuredCatalog = (connectionConfig.catalog || database || '').toString().trim();
    const configuredSchemas = String(connectionConfig.schemas || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const inferredCatalogs = tablesArray
      .map((t) => t.split('.'))
      .filter((parts) => parts.length >= 3)
      .map((parts) => parts[0].trim())
      .filter(Boolean);
    const inferredSchemas = tablesArray
      .map((t) => t.split('.'))
      .filter((parts) => parts.length >= 2)
      .map((parts) => (parts.length >= 3 ? parts[1] : parts[0]).trim())
      .filter(Boolean);

    const catalogForFetch = configuredCatalog || inferredCatalogs[0] || database || 'workspace';
    const schemasForFetch = [...new Set([...(configuredSchemas.length ? configuredSchemas : []), ...inferredSchemas])];

    const allRows = await fetchDatabricksTableSchemas({
      host: connectionConfig.host,
      server: connectionConfig.server,
      serverHostname: connectionConfig.serverHostname,
      jdbcUrl,
      httpPath: connectionConfig.httpPath,
      connectionMethod: connectionConfig.connectionMethod,
      token: connectionConfig.token,
      accessToken: connectionConfig.accessToken,
      database,
      catalog: catalogForFetch,
      schema: connectionConfig.schema,
      schemas: schemasForFetch.length ? schemasForFetch.join(',') : connectionConfig.schemas,
    });

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const filtered = allRows.filter((r) => {
      const full3 = r.database && r.schemaName ? `${r.database}.${r.schemaName}.${r.tableId}` : '';
      const full2 = r.schemaName ? `${r.schemaName}.${r.tableId}` : r.tableId;
      return wanted.has(full3) || wanted.has(full2) || wanted.has(r.tableId);
    });

    const tablesOut: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const full3 = row.database && row.schemaName ? `${row.database}.${row.schemaName}.${row.tableId}` : '';
      const full2 = row.schemaName ? `${row.schemaName}.${row.tableId}` : row.tableId;
      const canonicalId = full3 || full2;
      let cols = row.schema;
      const pick = columnsMap[canonicalId] || columnsMap[full2] || columnsMap[row.tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        'databricks',
        {
          database: (row.database || catalogForFetch || database || 'databricks') as string,
          schemaName: row.schemaName,
          tableId: row.tableId,
          rowCount: row.rowCount,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: canonicalId,
        tableName: row.tableId,
        name: row.tableId,
        database: row.database || catalogForFetch || '',
        schemaName: row.schemaName || '',
        dataset: row.schemaName || '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No Databricks table schemas found for the selected tables.');
    }

    const sourceKey = getCanonicalSourceKey('databricks')!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(
      dir,
      sourceKey,
      existingEntry,
      workspaceName,
      String(catalogForFetch || database || 'databricks')
    );
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      database: catalogForFetch || database || undefined,
      catalog: catalogForFetch || undefined,
      dataSourceType: 'databricks',
      schema: connectionConfig.schema as string | undefined,
      schemas: schemasForFetch.length ? schemasForFetch.join(',') : (connectionConfig.schemas as string | undefined),
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  if (sourceType === 'postgres' || sourceType === 'postgresql') {
    const username = connectionConfig.username as string | undefined;
    const password = connectionConfig.password as string | undefined;
    const database = connectionConfig.database as string | undefined;
    const host = (connectionConfig.host || connectionConfig.server || connectionConfig.serverUrl) as string | undefined;

    if (!username || !password) {
      throw new Error('PostgreSQL username and password are required');
    }
    if (!database) {
      throw new Error('PostgreSQL database is required');
    }
    if (!host) {
      throw new Error('PostgreSQL host/server is required');
    }

    const allRows = await fetchPostgresSQLTableSchemas({
      host: connectionConfig.host,
      server: connectionConfig.server || connectionConfig.serverUrl,
      port: connectionConfig.port,
      database,
      schema: connectionConfig.schema,
      schemas: connectionConfig.schemas,
      username,
      password,
    });

    const wanted = new Set(tablesArray.map((t) => t.trim()).filter(Boolean));
    const filtered = allRows.filter((r) => {
      const fullId = r.schemaName ? `${r.schemaName}.${r.tableId}` : r.tableId;
      return wanted.has(fullId) || wanted.has(r.tableId);
    });

    const tablesOut: Array<Record<string, unknown>> = [];
    for (const row of filtered) {
      const fullId = row.schemaName ? `${row.schemaName}.${row.tableId}` : row.tableId;
      let cols = row.schema;
      const pick = columnsMap[fullId] || columnsMap[row.tableId];
      if (pick && pick.length > 0) {
        const set = new Set(pick);
        cols = cols.filter((c) => set.has(c.name));
      }

      const rich = await buildRichMetaForSqlTable(
        sourceType,
        {
          database,
          schemaName: row.schemaName,
          tableId: row.tableId,
          rowCount: row.rowCount,
        },
        cols,
        llmProvider,
        llmApiKey,
        llmModel,
        columnDescriptionMode
      );

      tablesOut.push({
        id: fullId,
        tableName: row.tableId,
        name: row.tableId,
        schemaName: row.schemaName || '',
        dataset: row.schemaName || '',
        summary: rich.description,
        description: rich.description,
        purpose: rich.purpose,
        keyColumns: rich.keyColumns,
        relationships: rich.relationships,
        sampleQuestions: rich.sampleQuestions,
      });
    }

    if (tablesOut.length === 0) {
      throw new Error('No PostgreSQL table schemas found for the selected tables.');
    }

    const sourceKey = getCanonicalSourceKey(sourceType)!;
    const existingEntries = readUserKbIndexFiles(userId).filter(
      (e) => getCanonicalSourceKey(e.data.dataSourceType) === sourceKey
    );
    const existingEntry = pickLatestKbEntry(existingEntries);
    const existing = existingEntry?.data;
    const canonicalPath = resolveSourceKbPath(dir, sourceKey, existingEntry, workspaceName, String(database));
    const existingTables = (existing?.tables as Array<Record<string, unknown>>) || undefined;
    const mergedTables = mergeBigQueryTables(existingTables, tablesOut, mergeMode);
    const now = new Date().toISOString();
    const stableId = String(existing?.id ?? `kb_${sourceKey}`);
    const questions = (existing?.questions as unknown[]) ?? [];

    const payload = {
      version: '1.0',
      id: stableId,
      database,
      dataSourceType: sourceType,
      schema: connectionConfig.schema as string | undefined,
      schemas: connectionConfig.schemas as string | undefined,
      model: llmModel ?? (existing?.model as string | null) ?? null,
      tables: mergedTables,
      questions,
      mergeMode: mergeMode === 'replace_all' ? 'replace_all' : (mergeMode ?? 'merge'),
      createdAt: String(existing?.createdAt ?? now),
      updatedAt: now,
    };

    fs.writeFileSync(canonicalPath, JSON.stringify(payload, null, 2), 'utf-8');
    cleanupSourceDuplicates(userId, sourceKey, canonicalPath);
    return { indexId: stableId, filePath: canonicalPath };
  }

  throw new Error(
    `Knowledge Base creation for "${sourceType}" is not implemented in this build. Use BigQuery or extend knowledge-base-index.ts.`
  );
}

export async function deleteRAGIndex(identifier: string, userId: number, _userName?: string | null): Promise<void> {
  const paths = new Set<string>();
  for (const { fp, data } of readUserKbIndexFiles(userId)) {
    const pid = data.projectId ?? data.baseId ?? data.database;
    const idStr = String(data.id ?? '');
    if (pid === identifier || idStr === identifier) {
      paths.add(fp);
    }
  }
  if (paths.size === 0) {
    const found = await getRAGIndex(identifier, userId);
    if (found?.filePath) paths.add(found.filePath);
  }
  for (const fp of paths) {
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch {
      // ignore
    }
  }
}

export async function addQuestionToRAGIndex(
  identifier: string,
  userId: number,
  question: string,
  query: string,
  answer: string | undefined,
  _userName?: string | null
): Promise<void> {
  const idx = await getRAGIndex(identifier, userId);
  if (!idx?.filePath) throw new Error('Knowledge Base not found');
  const raw = JSON.parse(fs.readFileSync(idx.filePath, 'utf-8')) as Record<string, unknown>;
  const questions = (raw.questions as unknown[]) || [];
  questions.push({ question, query, answer: answer ?? '' });
  raw.questions = questions;
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(idx.filePath, JSON.stringify(raw, null, 2), 'utf-8');
}

export async function deleteTablesFromRAGIndex(
  identifier: string,
  userId: number,
  tableIds: string[],
  _userName?: string | null
): Promise<void> {
  const idx = await getRAGIndex(identifier, userId);
  if (!idx?.filePath) throw new Error('Knowledge Base not found');
  const raw = JSON.parse(fs.readFileSync(idx.filePath, 'utf-8')) as Record<string, unknown>;
  const set = new Set(tableIds);
  raw.tables = ((raw.tables as any[]) || []).filter((t) => !set.has(t.id) && !set.has(t.name));
  if (Array.isArray(raw.documents)) {
    raw.documents = ((raw.documents as any[]) || []).filter((d) => {
      const id = d.metadata?.datasetId && d.metadata?.tableId ? `${d.metadata.datasetId}.${d.metadata.tableId}` : d.metadata?.tableId;
      return !set.has(id);
    });
  }
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(idx.filePath, JSON.stringify(raw, null, 2), 'utf-8');
}

export async function deleteQuestionsFromRAGIndex(
  identifier: string,
  userId: number,
  questionIndices: number[],
  _userName?: string | null
): Promise<void> {
  const idx = await getRAGIndex(identifier, userId);
  if (!idx?.filePath) throw new Error('Knowledge Base not found');
  const raw = JSON.parse(fs.readFileSync(idx.filePath, 'utf-8')) as Record<string, unknown>;
  const qs = ((raw.questions as unknown[]) || []).filter((_, i) => !questionIndices.includes(i));
  raw.questions = qs;
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(idx.filePath, JSON.stringify(raw, null, 2), 'utf-8');
}

export async function updateTableInRAGIndex(
  identifier: string,
  userId: number,
  tableId: string,
  updates: Record<string, unknown>,
  _userName?: string | null
): Promise<void> {
  const idx = await getRAGIndex(identifier, userId);
  if (!idx?.filePath) throw new Error('Knowledge Base not found');
  const raw = JSON.parse(fs.readFileSync(idx.filePath, 'utf-8')) as Record<string, unknown>;
  const tables = (raw.tables as Record<string, unknown>[]) || [];
  const i = tables.findIndex((t) => t.id === tableId || t.name === tableId);
  if (i >= 0) {
    const merged = { ...tables[i], ...updates } as Record<string, unknown>;
    delete merged.columns;

    const cols = updates.columns as ColumnSchema[] | undefined;
    if (updates.columns && Array.isArray(updates.columns) && !updates.keyColumns && cols?.length) {
      merged.keyColumns = cols.map((c) => ({
        name: c.name,
        type: c.type,
        description:
          (c.description && String(c.description)) ||
          (c.ragDescription && String(c.ragDescription)) ||
          '',
        examples: [] as (string | number | boolean)[],
      }));
    }
    tables[i] = merged;
  }
  raw.tables = tables;
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(idx.filePath, JSON.stringify(raw, null, 2), 'utf-8');
}

export async function updateQuestionInRAGIndex(
  identifier: string,
  userId: number,
  questionIndex: number,
  updates: Record<string, unknown>,
  _userName?: string | null
): Promise<void> {
  const idx = await getRAGIndex(identifier, userId);
  if (!idx?.filePath) throw new Error('Knowledge Base not found');
  const raw = JSON.parse(fs.readFileSync(idx.filePath, 'utf-8')) as Record<string, unknown>;
  const qs = ((raw.questions as any[]) || []).slice();
  if (qs[questionIndex]) qs[questionIndex] = { ...qs[questionIndex], ...updates };
  raw.questions = qs;
  raw.updatedAt = new Date().toISOString();
  fs.writeFileSync(idx.filePath, JSON.stringify(raw, null, 2), 'utf-8');
}
