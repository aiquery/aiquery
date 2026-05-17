/**
 * routes.ts — AIquery Express API router v2.0
 *
 * POST /api/aiquery          — text-to-SQL + optional execute + analysis summary
 * GET  /api/health
 * GET  /api/models
 * GET  /api/schema              — fetch schema (any data source)
 * GET  /api/namespaces          — list databases/schemas
 * POST /api/execute             — execute SQL
 * POST /api/validate            — validate connection
 * POST /api/rag/generate        — generate RAG index
 * GET  /api/rag/list            — list RAG indexes
 * GET  /api/rag/file/:name      — load file-based RAG index (not /rag/:name — avoids shadowing /tables, /columns, etc.)
 * DELETE /api/rag/file/:name    — delete file-based RAG index
 * POST /api/summary             — generate analysis summary
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { generateSQL, generateAnalysisSummary } from '../services/llm/llm.service';
import { fetchSchema, executeQuery, listNamespaces, validateConnection } from '../services/data_sources/datasource.service';
import { generateRagIndex, listRagIndexes, loadRagIndex, deleteRagIndex } from '../services/rag_service/rag.service';
import { isProhibitedSQL } from '../services/query/sqlSafety';
import type { SchemaContext, DataSourceType, LLMModel } from '../types';

const router: Router = Router();

// ─── Health ───────────────────────────────────────────────────────────────────

router.get('/health', (_req: Request, res: Response) => {
  res.json({
    status: 'ok',
    service: 'AIquery API',
    version: '2.0.0',
    timestamp: new Date().toISOString(),
  });
});

// ─── Models & Data Sources ────────────────────────────────────────────────────

router.get('/models', (_req: Request, res: Response) => {
  res.json({
    models: [
      {
        id: 'claude-3-7-sonnet',
        name: 'Claude 3.7 Sonnet',
        provider: 'Anthropic',
        description: "Anthropic's most intelligent model with extended thinking",
        contextWindow: 200000,
        strengths: ['Complex reasoning', 'Multi-table joins', 'Nuanced queries'],
      },
      {
        id: 'gemini-2-0-flash',
        name: 'Gemini 2.0 Flash',
        provider: 'Google',
        description: "Google's fastest multimodal model with excellent SQL generation",
        contextWindow: 1000000,
        strengths: ['Ultra-fast responses', 'Large context', 'Multi-dialect SQL'],
      },
      {
        id: 'gpt-4o-mini',
        name: 'GPT-4o Mini',
        provider: 'OpenAI',
        description: "OpenAI's efficient and capable model for structured output",
        contextWindow: 128000,
        strengths: ['Reliable JSON output', 'Cost-effective', 'Strong SQL accuracy'],
      },
    ],
    dataSources: [
      { id: 'mysql', name: 'MySQL', dialect: 'MySQL SQL', icon: '🐬' },
      { id: 'postgresql', name: 'PostgreSQL', dialect: 'PostgreSQL SQL', icon: '🐘' },
      { id: 'snowflake', name: 'Snowflake', dialect: 'Snowflake SQL', icon: '❄️' },
      { id: 'databricks', name: 'Databricks', dialect: 'Spark SQL', icon: '🧱' },
      { id: 'airtable', name: 'Airtable', dialect: 'Airtable Formula', icon: '📋' },
      { id: 'bigquery', name: 'Google BigQuery', dialect: 'BigQuery Standard SQL', icon: '🔵' },
      { id: 'azuresql', name: 'Azure SQL', dialect: 'T-SQL', icon: '🔷' },
      { id: 'redshift', name: 'Amazon Redshift', dialect: 'Redshift SQL', icon: '🟠' },
    ],
  });
});

// ─── Main Text-to-SQL Endpoint ────────────────────────────────────────────────

const TextToSQLSchema = z.object({
  question: z.string().min(1),
  model: z.enum(['claude-3-7-sonnet', 'gemini-2-0-flash', 'gpt-4o-mini']),
  schemaContext: z.any().optional(),
  executeQuery: z.boolean().optional().default(false),
  conversationHistory: z.array(z.any()).optional().default([]),
  connectionConfig: z.any().optional(),
  ragIndexPath: z.string().optional(),
});

router.post('/aiquery', async (req: Request, res: Response) => {
  const parsed = TextToSQLSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });
  }
  try {
    const result = await generateSQL(parsed.data as Parameters<typeof generateSQL>[0]);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Internal server error' });
  }
});

// ─── Schema Fetch ─────────────────────────────────────────────────────────────

router.get('/schema', async (req: Request, res: Response) => {
  const { dataSource, projectId, datasetId, database, schemaName, tableName } = req.query as Record<string, string>;
  const connectionConfig = req.headers['x-datasource-config']
    ? JSON.parse(req.headers['x-datasource-config'] as string)
    : undefined;

  if (!dataSource) return res.status(400).json({ error: 'dataSource query parameter is required' });

  try {
    const tables = await fetchSchema(dataSource as DataSourceType, {
      projectId, datasetId, database, schemaName, tableName, config: connectionConfig,
    });
    const schemaContext: SchemaContext = {
      dataSource: dataSource as DataSourceType,
      projectId, datasetId, database, schemaName, tables,
    };
    return res.json({ schemaContext, tableCount: tables.length });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Schema fetch failed' });
  }
});

// ─── List Namespaces ──────────────────────────────────────────────────────────

router.get('/namespaces', async (req: Request, res: Response) => {
  const { dataSource, projectId } = req.query as Record<string, string>;
  const connectionConfig = req.headers['x-datasource-config']
    ? JSON.parse(req.headers['x-datasource-config'] as string)
    : undefined;

  if (!dataSource) return res.status(400).json({ error: 'dataSource query parameter is required' });

  try {
    const namespaces = await listNamespaces(dataSource as DataSourceType, { projectId, config: connectionConfig });
    return res.json({ namespaces });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Namespace listing failed' });
  }
});

// ─── Execute SQL ──────────────────────────────────────────────────────────────

router.post('/execute', async (req: Request, res: Response) => {
  const { sql, dataSource, projectId, connectionConfig } = req.body;
  if (!sql || !dataSource) return res.status(400).json({ error: 'sql and dataSource are required' });

  const safety = isProhibitedSQL(sql);
  if (safety.prohibited) {
    return res.status(400).json({
      error: 'Execution of this SQL is not allowed.',
      detail: `Prohibited command: "${safety.keyword}". Only read-only queries (e.g. SELECT) are permitted. Prohibited: alter, delete, drop, insert, truncate, update.`,
    });
  }

  try {
    const result = await executeQuery(dataSource as DataSourceType, sql, { projectId, config: connectionConfig });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Query execution failed' });
  }
});

// ─── Validate Connection ──────────────────────────────────────────────────────

router.post('/validate', async (req: Request, res: Response) => {
  const { dataSource, projectId, connectionConfig } = req.body;
  if (!dataSource) return res.status(400).json({ error: 'dataSource is required' });

  try {
    const valid = await validateConnection(dataSource as DataSourceType, { projectId, config: connectionConfig });
    return res.json({ valid, dataSource });
  } catch (err) {
    return res.json({ valid: false, error: err instanceof Error ? err.message : 'Validation failed' });
  }
});

// ─── RAG: Generate Index ──────────────────────────────────────────────────────

router.post('/rag/generate', async (req: Request, res: Response) => {
  const schema = z.object({
    dataSource: z.string(),
    tables: z.array(z.any()).min(1),
    model: z.enum(['claude-3-7-sonnet', 'gemini-2-0-flash', 'gpt-4o-mini']),
    database: z.string().optional(),
    schemaName: z.string().optional(),
    projectId: z.string().optional(),
    datasetId: z.string().optional(),
    indexName: z.string().optional(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Invalid request', details: parsed.error.errors });

  try {
    const result = await generateRagIndex({
      ...parsed.data,
      dataSource: parsed.data.dataSource as DataSourceType,
      model: parsed.data.model as LLMModel,
    });
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'RAG generation failed' });
  }
});

// ─── RAG: List Indexes ────────────────────────────────────────────────────────

router.get('/rag/list', (_req: Request, res: Response) => {
  try {
    return res.json({ indexes: listRagIndexes() });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Failed to list RAG indexes' });
  }
});

// ─── RAG: Load / delete file-based index (must not use /rag/:name — it shadows /api/rag/tables, /columns, …) ───

router.get('/rag/file/:name', (req: Request, res: Response) => {
  const index = loadRagIndex(String(req.params.name));
  if (!index) return res.status(404).json({ error: `RAG index "${req.params.name}" not found` });
  return res.json(index);
});

router.delete('/rag/file/:name', (req: Request, res: Response) => {
  const deleted = deleteRagIndex(String(req.params.name));
  if (!deleted) return res.status(404).json({ error: `RAG index "${req.params.name}" not found` });
  return res.json({ success: true, deleted: req.params.name });
});

// ─── Analysis Summary ─────────────────────────────────────────────────────────

router.post('/summary', async (req: Request, res: Response) => {
  const { question, sql, queryResult, model, dataSource } = req.body;
  if (!question || !sql || !queryResult || !model || !dataSource) {
    return res.status(400).json({ error: 'question, sql, queryResult, model, dataSource are required' });
  }
  try {
    const summary = await generateAnalysisSummary(
      question, sql, queryResult, model as LLMModel, dataSource as DataSourceType
    );
    return res.json({ summary });
  } catch (err) {
    return res.status(500).json({ error: err instanceof Error ? err.message : 'Summary generation failed' });
  }
});

export default router;
