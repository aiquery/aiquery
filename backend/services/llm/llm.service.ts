/**
 * llm.service.ts
 *
 * Multi-LLM router for AIquery.
 * Supports: Claude 3.7 Sonnet, Gemini 2.0 Flash, GPT-4o Mini
 *
 * Features:
 * - RAG-aware SQL generation (uses RAG index when available)
 * - Dialect-specific prompts for all 8 data sources
 * - AI-powered data analysis summary for query results
 * - Multi-turn conversation history
 */

import Anthropic from '@anthropic-ai/sdk';
import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';

import type {
  LLMModel,
  TextToSQLRequest,
  TextToSQLResponse,
  QueryResult,
  DataSourceType,
  SchemaContext,
  TableSchema,
} from '../../types';
import type { RagIndex } from '../../types';
import { LLMProvider } from '../../helpers/llm-config';

import { resolveAnthropicModelId } from './anthropic-models';
export { resolveAnthropicModelId, DEFAULT_ANTHROPIC_API_MODEL } from './anthropic-models';

import {
  buildSystemPrompt,
  buildUserMessage,
  buildConversationMessages,
  buildAnalysisSummaryPrompt,
  getInterpretSQLResultsSystemPrompt,
  buildInterpretSQLResultsUserContent,
  buildExplainSQLPrompt,
} from './prompts';

import { loadRagIndex, loadRagIndexByPath } from '../rag_service/rag.service';
import { executeQuery } from '../data_sources/datasource.service';
import { isProhibitedSQL } from '../query/sqlSafety';

/** Remove markdown asterisks from interpretation (user-visible titles should not use * or **). */
function stripInterpretationAsterisks(text: string): string {
  return text.replace(/\*+/g, '');
}

/** If stripping removes everything (e.g. draft was only `**`), keep a readable fallback. */
function interpretationAfterStrip(original: string, stripped: string): string {
  const t = stripped.trim();
  if (t.length > 0) return stripped;
  const o = original.trim();
  if (o.length === 0) return '';
  /** Drop bold/italic markers without deleting all content */
  const soft = o.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\*([^*]+)\*/g, '$1').replace(/\*+/g, '');
  return soft.trim() || o;
}

/** Parse JSON interpretation `{ draft, should_chart?, chart_type? }` from LLM; fallback to plain text. */
function parseInterpretationDraft(raw: string): string {
  if (!raw || !String(raw).trim()) return '';
  let s = raw.trim();
  s = s.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/m, '').trim();
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first >= 0 && last > first) s = s.slice(first, last + 1);

  const fromStringField = (text: string): string | null => {
    if (!text.trim()) return null;
    const stripped = stripInterpretationAsterisks(text);
    return interpretationAfterStrip(text, stripped);
  };

  try {
    const parsed = JSON.parse(s) as Record<string, unknown>;
    const keys = ['draft', 'interpretation', 'content', 'answer', 'summary', 'text'] as const;
    for (const k of keys) {
      const v = parsed[k];
      if (typeof v === 'string' && v.trim()) {
        const out = fromStringField(v);
        if (out) return out;
      }
    }
  } catch {
    /* try loose extraction (unescaped newlines / truncated JSON) */
  }

  const loose =
    extractJsonStringValueForKey(s, 'draft') ||
    extractJsonStringValueForKey(s, 'interpretation') ||
    extractJsonStringValueForKey(raw, 'draft') ||
    extractJsonStringValueForKey(raw, 'interpretation');
  if (loose) {
    const out = fromStringField(loose);
    if (out) return out;
  }

  const strippedRaw = stripInterpretationAsterisks(raw);
  if (strippedRaw.trim()) return strippedRaw.trim();
  return raw.trim();
}

// ─── Lazy-initialized clients ─────────────────────────────────────────────────

let anthropicClient: Anthropic | null = null;
let openaiClient: OpenAI | null = null;
let googleClient: GoogleGenerativeAI | null = null;

function getAnthropicClient(): Anthropic {
  if (!anthropicClient) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
    anthropicClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropicClient;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is not set');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

function getGoogleClient(): GoogleGenerativeAI {
  if (!googleClient) {
    if (!process.env.GOOGLE_AI_API_KEY) throw new Error('GOOGLE_AI_API_KEY is not set');
    googleClient = new GoogleGenerativeAI(process.env.GOOGLE_AI_API_KEY);
  }
  return googleClient;
}

// ─── Parse LLM JSON Response ──────────────────────────────────────────────────

/** Extract a JSON string value for "key": "..." with proper escape handling (handles long SQL). */
function extractJsonStringValueForKey(text: string, key: string): string | null {
  const re = new RegExp(`"${key}"\\s*:\\s*"`, 'm');
  const match = text.match(re);
  if (!match || match.index === undefined) return null;
  let i = match.index + match[0].length;
  let out = '';
  let escaped = false;
  for (; i < text.length; i++) {
    const c = text[i];
    if (escaped) {
      if (c === 'n') out += '\n';
      else if (c === 'r') out += '\r';
      else if (c === 't') out += '\t';
      else if (c === '"') out += '"';
      else if (c === '\\') out += '\\';
      else if (c === '/') out += '/';
      else out += '\\' + c;
      escaped = false;
      continue;
    }
    if (c === '\\') {
      escaped = true;
      continue;
    }
    if (c === '"') break;
    out += c;
  }
  const t = out.trim();
  return t.length > 0 ? t : null;
}

/** When JSON is truncated or the model uses markdown, still recover SQL. */
function extractSqlFromLooseText(cleaned: string): string {
  const fence = cleaned.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fence && /^\s*(?:WITH|SELECT)\b/i.test(fence[1])) {
    return fence[1].trim();
  }
  const semi = cleaned.match(/\b(WITH\b[\s\S]+;)\s*$/im);
  if (semi) return semi[1].trim();
  const semiSel = cleaned.match(/\b(SELECT\b[\s\S]+;)\s*$/im);
  if (semiSel) return semiSel[1].trim();
  const noSemi = cleaned.match(/\b(WITH\b[\s\S]+)/i);
  if (noSemi && !/^\s*\{/.test(noSemi[1])) return noSemi[1].trim();
  const noSemiSel = cleaned.match(/\b(SELECT\b[\s\S]+)/i);
  if (noSemiSel && !/^\s*\{/.test(noSemiSel[1])) return noSemiSel[1].trim();
  return '';
}

function parseSQLResponse(raw: string): { sql: string; explanation: string } {
  const cleaned = raw
    .replace(/```json\n?/gi, '')
    .replace(/```\n?/g, '')
    .trim();

  if (!cleaned) {
    return { sql: '', explanation: '' };
  }

  let sql = '';
  let explanation = '';

  try {
    const parsed = JSON.parse(cleaned) as {
      sql?: string;
      query?: string;
      explanation?: string;
    };
    sql = (parsed.sql || parsed.query || '').trim();
    explanation = (parsed.explanation || '').trim();
  } catch {
    sql = extractJsonStringValueForKey(cleaned, 'sql') || '';
    if (!explanation) {
      const exp = extractJsonStringValueForKey(cleaned, 'explanation');
      if (exp) explanation = exp;
    }
    if (!sql) {
      const legacy = cleaned.match(/"sql"\s*:\s*"([\s\S]*?)(?:",\s*"explanation"|"$)/);
      if (legacy) {
        sql = legacy[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\').trim();
      }
    }
    if (!explanation) {
      const expMatch = cleaned.match(/"explanation"\s*:\s*"([\s\S]*?)"\s*\}?/);
      if (expMatch) explanation = expMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
    }
  }

  if (!sql) {
    sql =
      extractJsonStringValueForKey(cleaned, 'sql') ||
      extractJsonStringValueForKey(cleaned, 'query') ||
      '';
  }
  if (!sql) {
    sql = extractSqlFromLooseText(cleaned);
  }

  if (!explanation) {
    explanation = 'Query generated successfully.';
  }

  return { sql: sql.trim(), explanation: explanation.trim() };
}

// ─── Claude (Anthropic) — model id via resolveAnthropicModelId (retired 3.x snapshots remapped) ─

async function generateWithClaude(
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const client = getAnthropicClient();
  const messages: Anthropic.MessageParam[] = [
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];
  const response = await client.messages.create({
    model: resolveAnthropicModelId('claude-3-7-sonnet'),
    max_tokens: 2048,
    temperature: 0,
    system: systemPrompt,
    messages,
  });
  return (response.content[0] as { type: string; text: string }).text;
}

// ─── Gemini 2.0 Flash ─────────────────────────────────────────────────────────

async function generateWithGemini(
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const client = getGoogleClient();
  const model = client.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction: systemPrompt,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
      maxOutputTokens: 2048,
    },
  });
  const chatHistory = history.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  const chat = model.startChat({ history: chatHistory });
  const result = await chat.sendMessage(userMessage);
  return result.response.text();
}

// ─── GPT-4o Mini ──────────────────────────────────────────────────────────────

async function generateWithOpenAI(
  systemPrompt: string,
  userMessage: string,
  history: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> {
  const client = getOpenAIClient();
  const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
    { role: 'system', content: systemPrompt },
    ...history.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    { role: 'user', content: userMessage },
  ];
  const response = await client.chat.completions.create({
    model: 'gpt-4o-mini',
    temperature: 0,
    ...openAiMaxTokensParam(2048),
    response_format: { type: 'json_object' },
    messages,
  });
  return response.choices[0].message.content || '{}';
}

// ─── Generate Analysis Summary ────────────────────────────────────────────────

export async function generateAnalysisSummary(
  question: string,
  sql: string,
  queryResult: QueryResult,
  model: LLMModel,
  dataSource: DataSourceType
): Promise<string> {
  const prompt = buildAnalysisSummaryPrompt(
    question,
    sql,
    queryResult.rows,
    queryResult.totalRows,
    dataSource
  );

  try {
    let summary = '';
    if (model === 'claude-3-7-sonnet') {
      const client = getAnthropicClient();
      const response = await client.messages.create({
        model: resolveAnthropicModelId('claude-3-7-sonnet'),
        max_tokens: 512,
        temperature: 0.15,
        messages: [{ role: 'user', content: prompt }],
      });
      summary = (response.content[0] as { type: string; text: string }).text;
    } else if (model === 'gemini-2-0-flash') {
      const client = getGoogleClient();
      const gemini = client.getGenerativeModel({
        model: 'gemini-2.0-flash',
        generationConfig: { temperature: 0.15, maxOutputTokens: 512 },
      });
      const result = await gemini.generateContent(prompt);
      summary = result.response.text();
    } else {
      const client = getOpenAIClient();
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        temperature: 0.15,
        ...openAiMaxTokensParam(512),
        messages: [{ role: 'user', content: prompt }],
      });
      summary = response.choices[0].message.content || '';
    }
    return summary.trim();
  } catch (err) {
    console.error('[LLM] Analysis summary generation failed:', err);
    return '';
  }
}

// ─── Main: generateSQL ────────────────────────────────────────────────────────

export async function generateSQL(request: TextToSQLRequest): Promise<TextToSQLResponse> {
  const {
    question,
    model,
    schemaContext,
    executeQuery: shouldExecute,
    conversationHistory = [],
    connectionConfig,
    ragIndexPath,
  } = request;

  const dataSource = schemaContext?.dataSource || 'postgresql';
  const start = Date.now();

  // ── Load RAG index if available ──────────────────────────────────────────
  let ragIndex: RagIndex | undefined;
  const ragPath = ragIndexPath || schemaContext?.ragIndexPath;
  if (ragPath) {
    ragIndex = loadRagIndexByPath(ragPath) || loadRagIndex(ragPath) || undefined;
    if (ragIndex) {
      console.log(`[LLM] Using RAG index: ${ragPath} (${ragIndex.tables.length} tables)`);
    }
  }

  // ── Build prompts ────────────────────────────────────────────────────────
  const systemPrompt = buildSystemPrompt(dataSource);
  const userMessage = buildUserMessage(question, schemaContext, ragIndex);
  const history = buildConversationMessages(conversationHistory);

  // ── Call selected LLM ────────────────────────────────────────────────────
  let rawResponse: string;
  try {
    switch (model) {
      case 'claude-3-7-sonnet':
        rawResponse = await generateWithClaude(systemPrompt, userMessage, history);
        break;
      case 'gemini-2-0-flash':
        rawResponse = await generateWithGemini(systemPrompt, userMessage, history);
        break;
      case 'gpt-4o-mini':
        rawResponse = await generateWithOpenAI(systemPrompt, userMessage, history);
        break;
      default:
        throw new Error(`Unknown model: ${model}`);
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : 'LLM call failed';
    return { sql: '', explanation: '', model, latencyMs: Date.now() - start, error };
  }

  const { sql, explanation } = parseSQLResponse(rawResponse);
  const latencyMs = Date.now() - start;

  // ── Execute query if requested ───────────────────────────────────────────
  let queryResults: QueryResult | undefined;
  let analysisSummary: string | undefined;

  if (shouldExecute && sql) {
    const safety = isProhibitedSQL(sql);
    if (safety.prohibited) {
      return {
        sql,
        explanation,
        model,
        latencyMs,
        error: `Execution not allowed: prohibited command "${safety.keyword}". Only read-only queries (SELECT) are permitted. Prohibited: alter, delete, drop, insert, truncate, update.`,
      };
    }
    try {
      queryResults = await executeQuery(dataSource, sql, {
        projectId: schemaContext?.projectId,
        config: connectionConfig,
      });

      if (queryResults && queryResults.rows.length > 0) {
        analysisSummary = await generateAnalysisSummary(
          question, sql, queryResults, model, dataSource
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err.message : 'Query execution failed';
      return { sql, explanation, model, latencyMs, error };
    }
  }

  return { sql, explanation, model, latencyMs, queryResults, analysisSummary };
}

// ─── Server facade: user API keys + setProvider (used by server.ts) ───────────

let activeProvider: LLMProvider | null = null;

function mapLlmDataSourceToDataSource(ds: string): DataSourceType {
  switch (ds) {
    case 'bigquery':
      return 'bigquery';
    case 'airtable':
      return 'airtable';
    case 'redshift':
      return 'redshift';
    case 'sqlserver':
      return 'azuresql';
    case 'snowflake':
      return 'snowflake';
    case 'mysql':
      return 'mysql';
    case 'postgresql':
      return 'postgresql';
    case 'databricks':
      return 'databricks';
    default:
      return 'postgresql';
  }
}

/**
 * OpenAI deprecates `max_tokens` for chat completions; o-series / gpt-5+ reject it and require
 * `max_completion_tokens` instead. Using `max_completion_tokens` for all chat completions is supported.
 */
function openAiMaxTokensParam(maxTokens: number): { max_completion_tokens: number } {
  return { max_completion_tokens: maxTokens };
}

/**
 * gpt-5* and o-series models reject custom temperature; only the default (1) is allowed.
 * Omit the parameter so the API uses its default.
 */
function openAiTemperatureParam(model: string, requested: number): { temperature?: number } {
  const m = model.toLowerCase();
  if (
    m.startsWith('gpt-5') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  ) {
    return {};
  }
  return { temperature: requested };
}

/**
 * Some OpenAI models (gpt-5*, o-series) reject or mishandle `response_format: { type: 'json_object' }`,
 * which caused empty interpretations and failed follow-up JSON. Omit it and rely on prompt + loose parse.
 */
function openAiUseJsonObjectFormat(model: string): boolean {
  const m = model.toLowerCase();
  if (
    m.startsWith('gpt-5') ||
    m.startsWith('o1') ||
    m.startsWith('o3') ||
    m.startsWith('o4')
  ) {
    return false;
  }
  return true;
}

function resolveProvider(llmConfig: Record<string, unknown> | undefined): LLMProvider {
  const p = llmConfig?.provider;
  if (typeof p === 'string') {
    const x = p.toLowerCase();
    if (x === 'gemini') return LLMProvider.GEMINI;
    if (x === 'anthropic' || x === 'claude') return LLMProvider.ANTHROPIC;
    if (x === 'openai') return LLMProvider.OPENAI;
  }
  return activeProvider ?? LLMProvider.OPENAI;
}

function buildSchemaContextFromLlmConfig(
  dataSource: DataSourceType,
  llmConfig: Record<string, unknown>
): SchemaContext {
  const tables: TableSchema[] = [];
  const tf = llmConfig.tableFields as Array<{ name?: string; type?: string }> | undefined;
  const tableName = (llmConfig.tableName as string) || 'table';
  if (tf && Array.isArray(tf) && tf.length > 0) {
    tables.push({
      name: tableName,
      columns: tf.map((f) => ({
        name: String(f.name ?? ''),
        type: String(f.type ?? 'string'),
      })),
    });
  }

  const ctx: SchemaContext = {
    dataSource,
    tables,
  };

  if (typeof llmConfig.projectId === 'string') ctx.projectId = llmConfig.projectId;
  if (llmConfig.datasets !== undefined) {
    const d = llmConfig.datasets;
    const first =
      typeof d === 'string'
        ? d.split(',')[0]?.trim()
        : Array.isArray(d)
          ? String(d[0] ?? '')
          : '';
    if (first) ctx.datasetId = first;
  }
  if (typeof llmConfig.database === 'string') ctx.database = llmConfig.database;
  if (typeof llmConfig.schema === 'string') ctx.schemaName = llmConfig.schema;
  if (typeof llmConfig.baseId === 'string') ctx.baseId = llmConfig.baseId;

  return ctx;
}

/** Maps UI labels (e.g. "Gemini 2.0 Flash") to API model ids — same case-sensitivity issue as Claude. */
export function resolveGeminiModelId(raw?: string | null): string {
  const fallback =
    process.env.GEMINI_MODEL?.trim() ||
    process.env.GOOGLE_AI_MODEL?.trim() ||
    'gemini-2.0-flash';
  if (raw == null || !String(raw).trim()) return fallback;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (lower.startsWith('gemini-')) return s;
  if (lower.includes('gemini') || lower.includes('flash')) return fallback;
  return fallback;
}

/** Maps UI labels (e.g. "GPT-4o Mini") to OpenAI model ids. */
export function resolveOpenAiModelId(raw?: string | null): string {
  const fallback = process.env.OPENAI_MODEL?.trim() || 'gpt-4o-mini';
  if (raw == null || !String(raw).trim()) return fallback;
  const s = String(raw).trim();
  const lower = s.toLowerCase();
  if (
    lower.startsWith('gpt-') ||
    lower.startsWith('o1') ||
    lower.startsWith('o3') ||
    lower.startsWith('o4') ||
    lower.startsWith('chatgpt-')
  ) {
    return s;
  }
  if (lower.includes('gpt') || lower.includes('4o') || lower.includes('mini')) return fallback;
  return fallback;
}

/** Exported for visualization and other features that need structured LLM output with user API keys. */
export async function chatCompletionWithUserKey(
  provider: LLMProvider,
  apiKey: string,
  userContent: string,
  opts: {
    systemPrompt?: string;
    jsonMode?: boolean;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    /** OpenAI only: improves reproducibility when combined with low temperature (e.g. SQL JSON). */
    seed?: number;
    /** Optional trace label (convertToSQL / interpretSQLResults / explainSQL / chart). */
    callSite?: string;
  }
): Promise<string> {
  const maxTokens = opts.maxTokens ?? 4096;
  const temperature = opts.temperature ?? 0.1;
  const startedAt = Date.now();
  const callSite = opts.callSite || 'unspecified';
  const promptChars = userContent?.length ?? 0;

  if (provider === LLMProvider.OPENAI) {
    const client = new OpenAI({ apiKey });
    const model = resolveOpenAiModelId(opts.model);
    const useJsonObjectResponseFormat = Boolean(opts.jsonMode && openAiUseJsonObjectFormat(model));
    let effectiveUserContent = userContent;
    if (opts.jsonMode && !useJsonObjectResponseFormat) {
      effectiveUserContent = `${userContent}\n\nReply with a single JSON object only. No markdown code fences and no text before or after the JSON.`;
    }
    console.log(
      `[LLM][call] site=${callSite} provider=openai model=${model} jsonMode=${opts.jsonMode ? 'true' : 'false'} jsonObjectFormat=${useJsonObjectResponseFormat ? 'true' : 'false'} maxTokens=${maxTokens} promptChars=${promptChars}`
    );
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
    if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
    messages.push({ role: 'user', content: effectiveUserContent });
    const res = await client.chat.completions.create({
      model,
      ...openAiTemperatureParam(model, temperature),
      ...openAiMaxTokensParam(maxTokens),
      messages,
      ...(useJsonObjectResponseFormat ? { response_format: { type: 'json_object' as const } } : {}),
      ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    console.log(
      `[LLM][done] site=${callSite} provider=openai model=${model} latencyMs=${Date.now() - startedAt}`
    );
    return res.choices[0]?.message?.content ?? '';
  }

  if (provider === LLMProvider.GEMINI) {
    const client = new GoogleGenerativeAI(apiKey);
    const modelName = resolveGeminiModelId(opts.model);
    console.log(
      `[LLM][call] site=${callSite} provider=gemini model=${modelName} jsonMode=${opts.jsonMode ? 'true' : 'false'} maxTokens=${maxTokens} promptChars=${promptChars}`
    );
    const gen = client.getGenerativeModel({
      model: modelName,
      systemInstruction: opts.systemPrompt,
      generationConfig: {
        temperature,
        maxOutputTokens: maxTokens,
        ...(opts.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    });
    const result = await gen.generateContent(userContent);
    console.log(
      `[LLM][done] site=${callSite} provider=gemini model=${modelName} latencyMs=${Date.now() - startedAt}`
    );
    return result.response.text();
  }

  if (provider === LLMProvider.ANTHROPIC) {
    const client = new Anthropic({ apiKey });
    const model = resolveAnthropicModelId(opts.model);
    console.log(
      `[LLM][call] site=${callSite} provider=anthropic model=${model} jsonMode=${opts.jsonMode ? 'true' : 'false'} maxTokens=${maxTokens} promptChars=${promptChars}`
    );
    const res = await client.messages.create({
      model,
      max_tokens: maxTokens,
      temperature,
      system: opts.systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    });
    console.log(
      `[LLM][done] site=${callSite} provider=anthropic model=${model} latencyMs=${Date.now() - startedAt}`
    );
    const block = res.content[0];
    return block && block.type === 'text' ? block.text : '';
  }

  throw new Error(`Unsupported LLM provider: ${provider}`);
}

/** Used by server routes: website chat, explain, RAG (setProvider only). */
export const llm = {
  setProvider(provider: LLMProvider): void {
    activeProvider = provider;
  },

  async queryLLM(
    prompt: string,
    useJson: boolean,
    _useLightModel: boolean,
    apiKey: string,
    model?: string
  ): Promise<string> {
    const provider = activeProvider ?? LLMProvider.OPENAI;
    return chatCompletionWithUserKey(provider, apiKey, prompt, {
      jsonMode: useJson === true,
      model,
      maxTokens: useJson ? 4096 : 2048,
      temperature: 0.15,
    });
  },

  async convertToSQL(
    question: string,
    llmDataSourceType: string,
    llmConfig: Record<string, unknown>
  ): Promise<string> {
    const provider = resolveProvider(llmConfig);
    const apiKey = String(llmConfig.apiKey ?? '');
    if (!apiKey) throw new Error('LLM API key is required');

    const dataSource = mapLlmDataSourceToDataSource(llmDataSourceType);
    const schemaContext = buildSchemaContextFromLlmConfig(dataSource, llmConfig);
    const systemPrompt = buildSystemPrompt(dataSource);
    let userMessage = buildUserMessage(question, schemaContext, undefined);
    const rag = llmConfig.ragContext;
    const uploadedTabular =
      typeof question === 'string' &&
      question.includes('--- Uploaded Tabular Data Context ---');
    /** When an upload is present, put RAG *after* the question so the model does not anchor on warehouse tables. */
    if (typeof rag === 'string' && rag.trim()) {
      if (uploadedTabular) {
        userMessage = `${userMessage}\n\n=== KNOWLEDGE BASE CONTEXT (reference only) ===\n${rag.trim()}\n\n(For questions about the uploaded file/spreadsheet, use the inline UNNEST/STRUCT CTE from the upload — do not use the tables above as a substitute for the file.)`;
      } else {
        userMessage = `=== KNOWLEDGE BASE CONTEXT ===\n${rag.trim()}\n\n${userMessage}`;
      }
    }

    const model = llmConfig.model as string | undefined;
    /** Inline UNNEST/STRUCT SQL can be very long; low limits truncate JSON mid-stream → empty sql. */
    const maxTokens = uploadedTabular ? 16384 : 8192;
    const raw = await chatCompletionWithUserKey(provider, apiKey, userMessage, {
      systemPrompt,
      jsonMode: true,
      model,
      maxTokens,
      temperature: 0,
      ...(provider === LLMProvider.OPENAI ? { seed: 42 } : {}),
      callSite: 'convertToSQL',
    });
    const trimmedRaw = String(raw ?? '').trim();
    if (!trimmedRaw) {
      throw new Error(
        'LLM returned an empty response for SQL generation. The request may have timed out, been blocked, or the prompt was too large—try again or use a smaller file sample.'
      );
    }
    const { sql } = parseSQLResponse(raw);
    if (!sql.trim()) {
      console.warn(
        '[LLM] convertToSQL: empty sql after parse; rawLen=%s preview=%s',
        trimmedRaw.length,
        trimmedRaw.slice(0, 1500)
      );
    }
    return sql;
  },

  async interpretSQLResults(
    question: string,
    sql: string,
    rows: unknown[],
    userName: string,
    apiKey: string,
    ragContext?: string,
    model?: string
  ): Promise<string> {
    const provider = activeProvider ?? LLMProvider.OPENAI;
    const sample = Array.isArray(rows) ? rows.slice(0, 15) : [];
    const totalRows = Array.isArray(rows) ? rows.length : 0;
    const userContent = buildInterpretSQLResultsUserContent(
      question,
      sql,
      sample,
      totalRows,
      userName,
      ragContext
    );
    const raw = await chatCompletionWithUserKey(provider, apiKey, userContent, {
      systemPrompt: getInterpretSQLResultsSystemPrompt(),
      jsonMode: true,
      model,
      maxTokens: 8192,
      temperature: 0.15,
      callSite: 'interpretSQLResults',
    });
    return parseInterpretationDraft(raw);
  },

  async explainSQL(sqlQuery: string, apiKey: string, model?: string): Promise<string> {
    const provider = activeProvider ?? LLMProvider.OPENAI;
    const prompt = buildExplainSQLPrompt(sqlQuery);
    return chatCompletionWithUserKey(provider, apiKey, prompt, {
      systemPrompt:
        'You write accurate, detailed SQL explanations. Follow the user structure exactly. Use clear markdown-style section headers.',
      jsonMode: false,
      model,
      maxTokens: 8192,
      temperature: 0.12,
      callSite: 'explainSQL',
    });
  },
};
