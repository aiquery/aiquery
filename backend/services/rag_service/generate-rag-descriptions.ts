/**
 * RAG table/column description generation — aligned with personal_github/aiquery
 * `generateTableAndColumnDescriptions` + `llm.queryLLM` (single call per table, JSON parse with brace recovery).
 */

import { llm } from '../llm/llm.service';
import type { LLMProvider } from '../../helpers/llm-config';

/** Same shape as reference rag-service TableSchema (subset). */
export interface RagTableSchemaForLlm {
  projectId?: string;
  datasetId?: string;
  schemaName?: string;
  database?: string;
  tableId: string;
  schema: Array<{
    name: string;
    type: string;
    mode?: string;
    description?: string;
    nullable?: boolean;
  }>;
  description?: string;
  rowCount?: number;
  dataSourceType?: string;
}

function getFullTableName(schema: RagTableSchemaForLlm): string {
  const t = schema.dataSourceType;
  if (t === 'bigquery' && schema.projectId && schema.datasetId) {
    return `${schema.projectId}.${schema.datasetId}.${schema.tableId}`;
  }
  if (schema.schemaName) return `${schema.schemaName}.${schema.tableId}`;
  if (schema.database) return `${schema.database}.${schema.tableId}`;
  return schema.tableId;
}

function getDataSourceDisplayName(dataSourceType?: string): string {
  switch (dataSourceType) {
    case 'bigquery':
      return 'BigQuery';
    case 'airtable':
      return 'Airtable';
    case 'mysql':
      return 'MySQL';
    case 'postgres':
    case 'postgresql':
      return 'PostgreSQL';
    case 'snowflake':
      return 'Snowflake';
    case 'redshift':
      return 'Redshift';
    case 'databricks':
      return 'Databricks';
    default:
      return 'Database';
  }
}

/** Extract balanced JSON object from LLM output (from reference rag-service). */
function extractJsonObjectRobust(trimmedResponse: string): string {
  let jsonText = trimmedResponse.trim();

  const codeBlockMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch?.[1]) {
    jsonText = codeBlockMatch[1].trim();
  }

  const firstBrace = jsonText.indexOf('{');
  if (firstBrace === -1) return jsonText;

  let braceCount = 0;
  let inString = false;
  let escapeNext = false;
  let lastBrace = firstBrace;

  for (let i = firstBrace; i < jsonText.length; i++) {
    const char = jsonText[i];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }
    if (char === '\\') {
      escapeNext = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      continue;
    }
    if (!inString) {
      if (char === '{') braceCount++;
      else if (char === '}') {
        braceCount--;
        if (braceCount === 0) {
          lastBrace = i;
          break;
        }
      }
    }
  }

  if (lastBrace > firstBrace) {
    return jsonText.substring(firstBrace, lastBrace + 1);
  }
  return jsonText;
}

function sanitizePotentialJson(text: string): string {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/^\s*```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'");
}

function stripColumnNamePrefix(desc: string, colName: string): string {
  const d = desc.trim();
  const re = new RegExp(`^${colName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*:\\s*`, 'i');
  return d.replace(re, '').trim() || d;
}

function derivePurposeFromNarrative(tableDescription: string): string {
  const t = tableDescription.trim();
  const parts = t.split(/\n+/).map((x) => x.trim()).filter(Boolean);
  if (parts.length >= 2) return parts.slice(1).join(' ').slice(0, 800);
  const sentences = t.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length >= 2) return sentences.slice(1).join(' ').trim().slice(0, 800);
  return '';
}

function buildMetadataFallbackDescriptions(
  tableSchema: RagTableSchemaForLlm
): { tableDescription: string; purpose: string; columnDescriptions: Record<string, string> } {
  const tableName = getFullTableName(tableSchema);
  const colNames = tableSchema.schema.map((c) => c.name).join(', ');
  const rowHint =
    tableSchema.rowCount != null && Number.isFinite(tableSchema.rowCount)
      ? ` Approximately ${Number(tableSchema.rowCount).toLocaleString()} row(s).`
      : '';
  const tableDescription = `Table \`${tableName}\` from ${getDataSourceDisplayName(tableSchema.dataSourceType)}. It contains columns: ${colNames}.${rowHint}`.trim();
  const columnDescriptions: Record<string, string> = {};
  for (const field of tableSchema.schema) {
    columnDescriptions[field.name] =
      (field.description && String(field.description).trim()) ||
      `Column \`${field.name}\` (${field.type}) in table \`${tableName}\`.`;
  }
  return {
    tableDescription,
    purpose: derivePurposeFromNarrative(tableDescription),
    columnDescriptions,
  };
}

/**
 * One LLM call per table — table narrative + every column description (reference implementation).
 */
export async function generateTableAndColumnDescriptions(
  tableSchema: RagTableSchemaForLlm,
  llmProvider: LLMProvider,
  apiKey: string | undefined,
  model: string | undefined
): Promise<{ tableDescription: string; purpose: string; columnDescriptions: Record<string, string> }> {
  const schemaText = tableSchema.schema
    .map(
      (field) =>
        `  - ${field.name} (${field.type}${field.mode ? `, ${field.mode}` : ''})${field.description ? `: ${field.description}` : ''}`
    )
    .join('\n');

  const dataSourceDisplayName = getDataSourceDisplayName(tableSchema.dataSourceType);
  const tableName = getFullTableName(tableSchema);
  const columnsList = tableSchema.schema.map((field) => field.name).join(', ');

  const prompt = `You are a data analyst. Analyze the following ${dataSourceDisplayName} table schema and generate descriptions for the table and all its columns.

Table: ${tableName}
${tableSchema.description ? `Existing Table Description: ${tableSchema.description}\n` : ''}
Schema:
${schemaText}
${tableSchema.rowCount ? `\nRow Count: ${tableSchema.rowCount.toLocaleString()}` : ''}

Please provide:
1. A table description (4-6 sentences) that explains:
   - What kind of data this table contains
   - The main purpose/use case
   - Key fields and their significance
   - Any important relationships or patterns

2. A description for each column (1-2 sentences each) that explains:
   - What the column represents or stores
   - Its purpose in the context of the table
   - Any important details about the data type or usage

Please format your response as JSON with the following structure:
{
  "tableDescription": "Description of the table...",
  "columns": {
    "${tableSchema.schema[0]?.name || 'column1'}": "Description of column 1...",
    "${tableSchema.schema[1]?.name || 'column2'}": "Description of column 2...",
    ...
  }
}

Make sure to include ALL columns: ${columnsList}

Response (JSON only, no additional text):`;

  if (!apiKey?.trim()) {
    throw new Error('LLM API key is required to generate Knowledge Base descriptions');
  }

  llm.setProvider(llmProvider);
  const response = await llm.queryLLM(prompt, true, false, apiKey, model);
  const trimmedResponse = response.trim();

  let jsonText = sanitizePotentialJson(extractJsonObjectRobust(trimmedResponse));

  let parsed: { tableDescription?: string; table_description?: string; columns?: Record<string, string>; columnDescriptions?: Record<string, string> };
  try {
    parsed = JSON.parse(jsonText);
  } catch (parseError: unknown) {
    // Retry once with aggressive extraction for partial / fenced model output.
    const retrySource = sanitizePotentialJson(trimmedResponse);
    const firstBrace = retrySource.indexOf('{');
    const lastBrace = retrySource.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      const retryText = retrySource.substring(firstBrace, lastBrace + 1);
      try {
        parsed = JSON.parse(retryText);
      } catch {
        const msg = parseError instanceof Error ? parseError.message : String(parseError);
        console.error('[RAG] JSON parse error:', msg);
        console.error('[RAG] JSON text (first 500):', jsonText.substring(0, 500));
        return buildMetadataFallbackDescriptions(tableSchema);
      }
    } else {
      const msg = parseError instanceof Error ? parseError.message : String(parseError);
      console.error('[RAG] JSON parse error:', msg);
      console.error('[RAG] JSON text (first 500):', jsonText.substring(0, 500));
      return buildMetadataFallbackDescriptions(tableSchema);
    }
  }

  const tableDescription = (parsed.tableDescription || parsed.table_description || '').trim();
  const columns = parsed.columns || parsed.columnDescriptions || {};

  const columnDescriptions: Record<string, string> = {};
  for (const field of tableSchema.schema) {
    const raw =
      columns[field.name] ||
      columns[field.name.toLowerCase()] ||
      (columns as Record<string, string>)[field.name] ||
      '';
    columnDescriptions[field.name] = raw
      ? stripColumnNamePrefix(raw.trim(), field.name)
      : '';
  }

  const purpose = derivePurposeFromNarrative(tableDescription);

  return {
    tableDescription,
    purpose,
    columnDescriptions,
  };
}
