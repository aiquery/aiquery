/**
 * rag.service.ts
 *
 * RAG (Retrieval-Augmented Generation) engine for AIquery.
 *
 * Flow:
 *  1. User selects tables from the Schema Manager
 *  2. POST /api/rag/generate → this service calls the LLM to produce
 *     rich semantic descriptions for each table and column
 *  3. The result is saved as a JSON index file to /backend/rag/<name>.json
 *  4. When the user asks a question, the chatbot loads the RAG index and
 *     injects the descriptions into the LLM prompt instead of raw DDL
 *
 * RAG index format: RagIndex (see types.ts)
 */

import fs from 'fs';
import path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import { resolveAnthropicModelId } from '../llm/anthropic-models';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import type {
  LLMModel,
  DataSourceType,
  TableSchema,
  RagIndex,
  RagTableEntry,
  RagColumnEntry,
  RagGenerationRequest,
  RagGenerationResult,
} from '../../types';

// ─── RAG Directory ────────────────────────────────────────────────────────────

const RAG_DIR = path.resolve(__dirname, '..', '..', 'rag');

export function ensureRagDir(): void {
  if (!fs.existsSync(RAG_DIR)) {
    fs.mkdirSync(RAG_DIR, { recursive: true });
  }
}

export function getRagDir(): string {
  ensureRagDir();
  return RAG_DIR;
}

// ─── List RAG Indexes ─────────────────────────────────────────────────────────

export interface RagIndexMeta {
  name: string;
  path: string;
  dataSource: DataSourceType;
  tables: number;
  createdAt: string;
  model: LLMModel;
}

export function listRagIndexes(): RagIndexMeta[] {
  ensureRagDir();
  const files = fs.readdirSync(RAG_DIR).filter((f) => f.endsWith('.json'));
  const result: RagIndexMeta[] = [];
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(RAG_DIR, file), 'utf-8');
      const index = JSON.parse(content) as RagIndex;
      result.push({
        name: file.replace('.json', ''),
        path: path.join(RAG_DIR, file),
        dataSource: index.dataSource,
        tables: index.tables.length,
        createdAt: index.createdAt,
        model: index.model,
      });
    } catch {
      // Skip malformed files
    }
  }
  return result.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

// ─── Load RAG Index ───────────────────────────────────────────────────────────

export function loadRagIndex(indexName: string): RagIndex | null {
  ensureRagDir();
  const filePath = path.join(RAG_DIR, `${indexName}.json`);
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RagIndex;
  } catch {
    return null;
  }
}

export function loadRagIndexByPath(filePath: string): RagIndex | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as RagIndex;
  } catch {
    return null;
  }
}

// ─── Delete RAG Index ─────────────────────────────────────────────────────────

export function deleteRagIndex(indexName: string): boolean {
  const filePath = path.join(RAG_DIR, `${indexName}.json`);
  if (!fs.existsSync(filePath)) return false;
  fs.unlinkSync(filePath);
  return true;
}

// ─── Build RAG Context String (for LLM prompt) ───────────────────────────────

export function buildRagContextString(index: RagIndex): string {
  const lines: string[] = [
    `Data Source: ${index.dataSource}`,
    `Database/Dataset: ${index.database || index.datasetId || 'N/A'}`,
    `Schema: ${index.schemaName || 'N/A'}`,
    '',
    '=== TABLE DESCRIPTIONS (from RAG index) ===',
    '',
  ];

  for (const table of index.tables) {
    lines.push(`TABLE: ${table.tableName}`);
    lines.push(`  Purpose: ${table.purpose}`);
    lines.push(`  Description: ${table.description}`);
    if (table.relationships?.length) {
      lines.push(`  Relationships: ${table.relationships.join(', ')}`);
    }
    lines.push(`  Key Columns:`);
    for (const col of table.keyColumns) {
      lines.push(`    - ${col.name} (${col.type}): ${col.description}`);
      if (col.examples?.length) {
        lines.push(`      Examples: ${col.examples.join(', ')}`);
      }
    }
    if (table.sampleQuestions?.length) {
      lines.push(`  Sample Questions:`);
      table.sampleQuestions.forEach((q) => lines.push(`    • ${q}`));
    }
    lines.push('');
  }

  return lines.join('\n');
}

// ─── LLM Prompt for RAG Generation ───────────────────────────────────────────

function buildRagGenerationPrompt(table: TableSchema, dataSource: DataSourceType): string {
  const colList = table.columns
    .map((c) => `  - ${c.name} (${c.type})${c.description ? ': ' + c.description : ''}`)
    .join('\n');

  return `You are a data analyst documenting a ${dataSource} database table for a RAG (Retrieval-Augmented Generation) system.

Given the following table schema, generate a comprehensive semantic description that will help an AI model generate accurate SQL queries.

Table: ${table.schema ? table.schema + '.' : ''}${table.name}
Columns:
${colList}

Respond with a JSON object in EXACTLY this format (no markdown, no extra text):
{
  "tableName": "${table.name}",
  "description": "A 2-3 sentence description of what this table stores",
  "purpose": "One sentence describing the business purpose of this table",
  "keyColumns": [
    {
      "name": "column_name",
      "type": "column_type",
      "description": "Clear description of what this column stores and its business meaning",
      "examples": ["example1", "example2"]
    }
  ],
  "relationships": ["description of foreign key or logical relationships to other tables"],
  "sampleQuestions": [
    "What is the total X by Y?",
    "How many Z in the last 30 days?"
  ]
}

Include ALL columns in keyColumns. For sampleQuestions, generate 3-5 realistic business questions that would require querying this table.`;
}

// ─── Call LLM for single table ────────────────────────────────────────────────

async function describeTableWithLLM(
  table: TableSchema,
  dataSource: DataSourceType,
  model: LLMModel
): Promise<RagTableEntry> {
  const prompt = buildRagGenerationPrompt(table, dataSource);

  let rawJson = '';

  if (model === 'claude-3-7-sonnet') {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: resolveAnthropicModelId('claude-3-7-sonnet'),
      max_tokens: 2000,
      temperature: 0,
      messages: [{ role: 'user', content: prompt }],
    });
    rawJson = (response.content[0] as { type: string; text: string }).text;

  } else if (model === 'gemini-2-0-flash') {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY || '');
    const gemini = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0,
        maxOutputTokens: 2000,
      },
    });
    const result = await gemini.generateContent(prompt);
    rawJson = result.response.text();

  } else {
    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_completion_tokens: 2000,
      response_format: { type: 'json_object' },
      messages: [{ role: 'user', content: prompt }],
    });
    rawJson = response.choices[0].message.content || '{}';
  }

  // Parse and validate
  const cleaned = rawJson.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned) as RagTableEntry;

  // Ensure all columns are included (fill in any missing)
  const existingCols = new Set((parsed.keyColumns || []).map((c: RagColumnEntry) => c.name));
  const missingCols: RagColumnEntry[] = table.columns
    .filter((c) => !existingCols.has(c.name))
    .map((c) => ({
      name: c.name,
      type: c.type,
      description: c.description || `${c.name} field`,
    }));

  return {
    tableName: parsed.tableName || table.name,
    description: parsed.description || '',
    purpose: parsed.purpose || '',
    keyColumns: [...(parsed.keyColumns || []), ...missingCols],
    relationships: parsed.relationships || [],
    sampleQuestions: parsed.sampleQuestions || [],
  };
}

// ─── Main: Generate RAG Index ─────────────────────────────────────────────────

export async function generateRagIndex(
  request: RagGenerationRequest
): Promise<RagGenerationResult> {
  ensureRagDir();

  const { dataSource, tables, model, database, schemaName, projectId, datasetId } = request;
  const start = Date.now();

  // Generate descriptions for each table (sequential to avoid rate limits)
  const ragTables: RagTableEntry[] = [];
  for (const table of tables) {
    console.log(`[RAG] Describing table: ${table.name} using ${model}...`);
    const entry = await describeTableWithLLM(table, dataSource, model);
    ragTables.push(entry);
  }

  // Build the index
  const indexName = request.indexName || buildIndexName(dataSource, database || schemaName || projectId || 'default');
  const ragIndex: RagIndex = {
    version: '1.0',
    createdAt: new Date().toISOString(),
    dataSource,
    database,
    schemaName,
    projectId,
    datasetId,
    model,
    tables: ragTables,
  };

  // Save to disk
  const indexPath = path.join(RAG_DIR, `${indexName}.json`);
  fs.writeFileSync(indexPath, JSON.stringify(ragIndex, null, 2), 'utf-8');

  console.log(`[RAG] Index saved to: ${indexPath}`);

  return {
    indexPath,
    indexName,
    tablesProcessed: ragTables.length,
    model,
    latencyMs: Date.now() - start,
  };
}

function buildIndexName(dataSource: DataSourceType, namespace: string): string {
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const safe = namespace.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 30);
  return `${dataSource}_${safe}_${ts}`;
}

// ─── Knowledge Base (per-user JSON) + table discovery for /api/rag/tables ─────

export {
  fetchBigQueryTableSchemas,
  fetchPostgresSQLTableSchemas,
  fetchRedshiftTableSchemas,
  fetchAzureSQLTableSchemas,
  fetchMySQLTableSchemas,
  fetchSnowflakeTableSchemas,
  fetchDatabricksTableSchemas,
} from './schema-discovery';
export { fetchDatabricksCatalogs, fetchDatabricksSchemas } from '../data_sources/databricks.service';
export {
  createUserRAGDirectory,
  createRAGIndex,
  getRagIndicesRoot,
  getRAGIndex,
  retrieveRAGContext,
  getAllRAGIndexes,
  addQuestionToRAGIndex,
  deleteRAGIndex,
  deleteTablesFromRAGIndex,
  deleteQuestionsFromRAGIndex,
  updateTableInRAGIndex,
  updateQuestionInRAGIndex,
} from './knowledge-base-index';
