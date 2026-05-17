/**
 * slack.service.ts
 *
 * Slack Bolt app integration for AIquery.
 *
 * Supported interactions:
 *   1. Slash command:  /sql <question>
 *   2. App mention:    @TextToSQL <question>
 *   3. Direct message: any message to the bot
 *
 * Per-channel datasource config is stored in memory (replace with DB for production).
 * Users can switch datasource with: /sql --source bigquery|azuresql|redshift <question>
 */

import { App, ExpressReceiver, LogLevel } from '@slack/bolt';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type KnownBlock = any;
import type { Application } from 'express';
import { generateSQL } from '../llm/llm.service';
import { executeQuery } from '../data_sources/datasource.service';
import { isProhibitedSQL } from '../query/sqlSafety';
import type { DataSourceType, LLMModel, SchemaContext } from '../../types';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChannelConfig {
  dataSource: DataSourceType;
  model: LLMModel;
  schemaContext?: SchemaContext;
  autoExecute: boolean;
}

interface ParsedCommand {
  question: string;
  dataSource?: DataSourceType;
  model?: LLMModel;
  execute?: boolean;
}

// ─── In-memory channel config store ──────────────────────────────────────────
// Maps channelId -> config. Replace with Redis/DB for multi-instance deployments.

const channelConfigs = new Map<string, ChannelConfig>();

function getChannelConfig(channelId: string): ChannelConfig {
  return channelConfigs.get(channelId) ?? {
    dataSource: (process.env.SLACK_DEFAULT_DATASOURCE as DataSourceType) || 'bigquery',
    model: (process.env.SLACK_DEFAULT_MODEL as LLMModel) || 'gemini-2-0-flash',
    autoExecute: process.env.SLACK_AUTO_EXECUTE === 'true',
  };
}

function setChannelConfig(channelId: string, config: Partial<ChannelConfig>): ChannelConfig {
  const current = getChannelConfig(channelId);
  const updated = { ...current, ...config };
  channelConfigs.set(channelId, updated);
  return updated;
}

// ─── Command Parser ───────────────────────────────────────────────────────────

const DATA_SOURCE_ALIASES: Record<string, DataSourceType> = {
  bigquery: 'bigquery', bq: 'bigquery',
  azuresql: 'azuresql', azure: 'azuresql', mssql: 'azuresql', sqlserver: 'azuresql',
  redshift: 'redshift', rs: 'redshift', aws: 'redshift',
};

const MODEL_ALIASES: Record<string, LLMModel> = {
  claude: 'claude-3-7-sonnet', 'claude-3-7-sonnet': 'claude-3-7-sonnet', anthropic: 'claude-3-7-sonnet',
  gemini: 'gemini-2-0-flash', 'gemini-2-0-flash': 'gemini-2-0-flash', google: 'gemini-2-0-flash',
  gpt: 'gpt-4o-mini', 'gpt-4o-mini': 'gpt-4o-mini', openai: 'gpt-4o-mini', chatgpt: 'gpt-4o-mini',
};

function parseCommand(text: string): ParsedCommand {
  let remaining = text.trim();
  let dataSource: DataSourceType | undefined;
  let model: LLMModel | undefined;
  let execute: boolean | undefined;

  // --source <ds>
  const sourceMatch = remaining.match(/--source\s+(\S+)/i);
  if (sourceMatch) {
    dataSource = DATA_SOURCE_ALIASES[sourceMatch[1].toLowerCase()];
    remaining = remaining.replace(sourceMatch[0], '').trim();
  }

  // --model <model>
  const modelMatch = remaining.match(/--model\s+(\S+)/i);
  if (modelMatch) {
    model = MODEL_ALIASES[modelMatch[1].toLowerCase()];
    remaining = remaining.replace(modelMatch[0], '').trim();
  }

  // --run or --execute
  const runMatch = remaining.match(/--(?:run|execute)/i);
  if (runMatch) {
    execute = true;
    remaining = remaining.replace(runMatch[0], '').trim();
  }

  return { question: remaining, dataSource, model, execute };
}

// ─── Slack Message Formatters ─────────────────────────────────────────────────

const DS_EMOJI: Record<DataSourceType, string> = {
  mysql: ':dolphin:',
  postgresql: ':elephant:',
  snowflake: ':snowflake:',
  databricks: ':bricks:',
  airtable: ':clipboard:',
  bigquery: ':large_blue_circle:',
  azuresql: ':large_blue_diamond:',
  redshift: ':large_orange_circle:',
};

const DS_LABEL: Record<DataSourceType, string> = {
  mysql: 'MySQL',
  postgresql: 'PostgreSQL',
  snowflake: 'Snowflake',
  databricks: 'Databricks',
  airtable: 'Airtable',
  bigquery: 'BigQuery',
  azuresql: 'Azure SQL',
  redshift: 'Amazon Redshift',
};

const MODEL_LABEL: Record<LLMModel, string> = {
  'claude-3-7-sonnet': 'Claude 3.7 Sonnet',
  'gemini-2-0-flash': 'Gemini 2.0 Flash',
  'gpt-4o-mini': 'GPT-4o Mini',
};

function formatSQL(sql: string): string {
  return `\`\`\`sql\n${sql}\n\`\`\``;
}

function formatResultsTable(rows: Record<string, unknown>[], maxRows = 10): string {
  if (!rows || rows.length === 0) return '_No rows returned._';

  const displayRows = rows.slice(0, maxRows);
  const columns = Object.keys(displayRows[0]);

  // Calculate column widths
  const widths = columns.map((col) =>
    Math.max(col.length, ...displayRows.map((r) => String(r[col] ?? '').length))
  );

  const header = columns.map((col, i) => col.padEnd(widths[i])).join(' | ');
  const separator = widths.map((w) => '-'.repeat(w)).join('-+-');
  const dataRows = displayRows.map((row) =>
    columns.map((col, i) => String(row[col] ?? '').padEnd(widths[i])).join(' | ')
  );

  const table = [header, separator, ...dataRows].join('\n');
  const truncated = rows.length > maxRows
    ? `\n_... and ${rows.length - maxRows} more rows_`
    : '';

  return `\`\`\`\n${table}\n\`\`\`${truncated}`;
}

function buildSQLBlocks(params: {  // eslint-disable-line
  question: string;
  sql: string;
  explanation: string;
  model: LLMModel;
  dataSource: DataSourceType;
  latencyMs: number;
  rows?: Record<string, unknown>[];
  totalRows?: number;
  queryLatencyMs?: number;
  error?: string;
}) {
  const {
    question, sql, explanation, model, dataSource,
    latencyMs, rows, totalRows, queryLatencyMs, error,
  } = params;

  const blocks: KnownBlock[] = [
    // Header
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `${DS_EMOJI[dataSource]} *AIquery Result*\n> ${question}`,
      },
    },
    { type: 'divider' },
    // SQL
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Generated SQL* _(${DS_LABEL[dataSource]})_\n${formatSQL(sql)}`,
      },
    },
    // Explanation
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Explanation*\n${explanation}`,
      },
    },
    // Metadata
    {
      type: 'context',
      elements: [
        {
          type: 'mrkdwn',
          text: `:robot_face: ${MODEL_LABEL[model]}  |  :zap: SQL generated in *${latencyMs}ms*  |  ${DS_EMOJI[dataSource]} ${DS_LABEL[dataSource]}`,
        },
      ],
    },
  ];

  // Query results
  if (rows !== undefined && !error) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Query Results* — ${totalRows ?? rows.length} row${(totalRows ?? rows.length) !== 1 ? 's' : ''} in ${queryLatencyMs ?? 0}ms\n${formatResultsTable(rows)}`,
      },
    });
  }

  // Error
  if (error) {
    blocks.push({ type: 'divider' });
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `:warning: *Execution Error*\n\`\`\`\n${error}\n\`\`\``,
      },
    });
  }

  return blocks;
}

function buildHelpBlocks(config: ChannelConfig): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:wave: AIquery Bot — Help*\nConvert plain English to SQL and query your data warehouses directly from Slack.',
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Usage*\n• `/sql <question>` — Generate SQL from your question\n• `/sql --run <question>` — Generate SQL and execute it immediately\n• `/sql --source <ds> <question>` — Use a specific data source\n• `/sql --model <model> <question>` — Use a specific LLM model\n• `/sql config` — Show current channel configuration\n• `/sql set-source <bigquery|azuresql|redshift>` — Set default data source\n• `/sql set-model <claude|gemini|gpt>` — Set default LLM model\n• `/sql set-autorun <on|off>` — Toggle automatic query execution\n• `/sql help` — Show this help message',
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*Examples*\n• `/sql Show me total revenue by region this quarter`\n• `/sql --source redshift --run Top 5 products by sales last month`\n• `/sql --model claude What are the daily active users for the past 7 days?`',
      },
    },
    { type: 'divider' },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*Current Channel Config*\n• Data Source: ${DS_EMOJI[config.dataSource]} ${DS_LABEL[config.dataSource]}\n• Model: :robot_face: ${MODEL_LABEL[config.model]}\n• Auto-execute: ${config.autoExecute ? ':white_check_mark: On' : ':x: Off'}`,
      },
    },
  ];
}

function buildConfigBlocks(config: ChannelConfig): KnownBlock[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: '*:gear: Channel Configuration*',
      },
    },
    {
      type: 'section',
      fields: [
        { type: 'mrkdwn', text: `*Data Source*\n${DS_EMOJI[config.dataSource]} ${DS_LABEL[config.dataSource]}` },
        { type: 'mrkdwn', text: `*LLM Model*\n:robot_face: ${MODEL_LABEL[config.model]}` },
        { type: 'mrkdwn', text: `*Auto-execute*\n${config.autoExecute ? ':white_check_mark: On' : ':x: Off'}` },
        { type: 'mrkdwn', text: `*Schema Tables*\n${config.schemaContext?.tables.length ?? 0} loaded` },
      ],
    },
  ];
}

// ─── Core Query Handler ───────────────────────────────────────────────────────

async function handleQuery(params: {
  question: string;
  channelId: string;
  userId: string;
  overrideDataSource?: DataSourceType;
  overrideModel?: LLMModel;
  forceExecute?: boolean;
}): Promise<{
  sql: string;
  explanation: string;
  model: LLMModel;
  dataSource: DataSourceType;
  latencyMs: number;
  rows?: Record<string, unknown>[];
  totalRows?: number;
  queryLatencyMs?: number;
  error?: string;
}> {
  const config = getChannelConfig(params.channelId);
  const dataSource = params.overrideDataSource ?? config.dataSource;
  const model = params.overrideModel ?? config.model;
  const shouldExecute = params.forceExecute ?? config.autoExecute;

  // Build schema context from channel config
  const schemaContext: SchemaContext = config.schemaContext ?? {
    dataSource,
    tables: [],
  };
  // Always use the resolved datasource
  schemaContext.dataSource = dataSource;

  const sqlResult = await generateSQL({ question: params.question, model, schemaContext, executeQuery: false, conversationHistory: [] });
  const { sql, explanation } = sqlResult;
  const latencyMs = 0; // Will be measured by caller

  let rows: Record<string, unknown>[] | undefined;
  let totalRows: number | undefined;
  let queryLatencyMs: number | undefined;
  let error: string | undefined;

  if (shouldExecute && sql) {
    const safety = isProhibitedSQL(sql);
    if (safety.prohibited) {
      error = `Execution not allowed: prohibited command "${safety.keyword}". Only read-only queries (SELECT) are permitted.`;
    } else {
      try {
        const result = await executeQuery(dataSource, sql, {
          projectId: schemaContext.projectId || process.env.BIGQUERY_PROJECT_ID,
        });
        rows = result.rows as Record<string, unknown>[];
        totalRows = result.totalRows;
        queryLatencyMs = result.latencyMs;
      } catch (err) {
        error = err instanceof Error ? err.message : 'Query execution failed';
      }
    }
  }

  return { sql, explanation, model, dataSource, latencyMs, rows, totalRows, queryLatencyMs, error };
}

// ─── Slack App Factory ────────────────────────────────────────────────────────

export function createSlackApp(expressApp: Application): App | null {
  const signingSecret = process.env.SLACK_SIGNING_SECRET;
  const botToken = process.env.SLACK_BOT_TOKEN;

  if (!signingSecret || !botToken) {
    console.warn('[Slack] SLACK_SIGNING_SECRET or SLACK_BOT_TOKEN not set — Slack bot disabled.');
    return null;
  }

  // Use ExpressReceiver to mount on the existing Express app
  const receiver = new ExpressReceiver({
    signingSecret,
    app: expressApp,
    endpoints: '/slack/events',
    processBeforeResponse: true,
  });

  const slackApp = new App({
    token: botToken,
    receiver,
    logLevel: process.env.NODE_ENV === 'development' ? LogLevel.DEBUG : LogLevel.WARN,
  });

  // ── /sql slash command ──────────────────────────────────────────────────────

  slackApp.command('/sql', async ({ command, ack, respond }) => {
    await ack();

    const text = command.text.trim();
    const channelId = command.channel_id;
    const config = getChannelConfig(channelId);

    // ── Config sub-commands ─────────────────────────────────────────────────

    if (!text || text === 'help') {
      await respond({ blocks: buildHelpBlocks(config), response_type: 'ephemeral' });
      return;
    }

    if (text === 'config') {
      await respond({ blocks: buildConfigBlocks(config), response_type: 'ephemeral' });
      return;
    }

    const setSourceMatch = text.match(/^set-source\s+(\S+)$/i);
    if (setSourceMatch) {
      const ds = DATA_SOURCE_ALIASES[setSourceMatch[1].toLowerCase()];
      if (!ds) {
        await respond({ text: `:x: Unknown data source. Use: \`bigquery\`, \`azuresql\`, or \`redshift\``, response_type: 'ephemeral' });
        return;
      }
      const updated = setChannelConfig(channelId, { dataSource: ds });
      await respond({ text: `${DS_EMOJI[ds]} Default data source set to *${DS_LABEL[ds]}* for this channel.`, response_type: 'in_channel' });
      return;
    }

    const setModelMatch = text.match(/^set-model\s+(\S+)$/i);
    if (setModelMatch) {
      const m = MODEL_ALIASES[setModelMatch[1].toLowerCase()];
      if (!m) {
        await respond({ text: `:x: Unknown model. Use: \`claude\`, \`gemini\`, or \`gpt\``, response_type: 'ephemeral' });
        return;
      }
      setChannelConfig(channelId, { model: m });
      await respond({ text: `:robot_face: Default model set to *${MODEL_LABEL[m]}* for this channel.`, response_type: 'in_channel' });
      return;
    }

    const setAutorunMatch = text.match(/^set-autorun\s+(on|off)$/i);
    if (setAutorunMatch) {
      const autoExecute = setAutorunMatch[1].toLowerCase() === 'on';
      setChannelConfig(channelId, { autoExecute });
      await respond({ text: `Auto-execute is now *${autoExecute ? 'ON' : 'OFF'}* for this channel.`, response_type: 'in_channel' });
      return;
    }

    // ── SQL generation ──────────────────────────────────────────────────────

    const parsed = parseCommand(text);
    if (!parsed.question) {
      await respond({ text: ':x: Please provide a question. Example: `/sql Show me total revenue by region`', response_type: 'ephemeral' });
      return;
    }

    // Post a "thinking" message immediately
    await respond({
      response_type: 'in_channel',
      text: `:hourglass_flowing_sand: Generating SQL for: _${parsed.question}_`,
    });

    const startTime = Date.now();
    try {
      const result = await handleQuery({
        question: parsed.question,
        channelId,
        userId: command.user_id,
        overrideDataSource: parsed.dataSource,
        overrideModel: parsed.model,
        forceExecute: parsed.execute,
      });
      result.latencyMs = Date.now() - startTime;

      await respond({
        response_type: 'in_channel',
        blocks: buildSQLBlocks({ question: parsed.question, ...result }),
        text: `SQL generated for: ${parsed.question}`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to generate SQL';
      await respond({
        response_type: 'in_channel',
        text: `:x: *Error:* ${errMsg}`,
      });
    }
  });

  // ── App mention: @TextToSQL <question> ─────────────────────────────────────

  slackApp.event('app_mention', async ({ event, say }) => {
    // Strip the bot mention from the text
    const text = (event.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
    const channelId = event.channel;

    if (!text || text === 'help') {
      const config = getChannelConfig(channelId);
      await say({ blocks: buildHelpBlocks(config), text: 'AIquery Help' });
      return;
    }

    const parsed = parseCommand(text);
    if (!parsed.question) {
      await say({ text: ':x: Please include a question after mentioning me.' });
      return;
    }

    // Acknowledge immediately
    await say({ text: `:hourglass_flowing_sand: Generating SQL for: _${parsed.question}_` });

    const startTime = Date.now();
    try {
      const result = await handleQuery({
        question: parsed.question,
        channelId,
        userId: event.user || '',
        overrideDataSource: parsed.dataSource,
        overrideModel: parsed.model,
        forceExecute: parsed.execute,
      });
      result.latencyMs = Date.now() - startTime;

      await say({
        blocks: buildSQLBlocks({ question: parsed.question, ...result }),
        text: `SQL generated for: ${parsed.question}`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to generate SQL';
      await say({ text: `:x: *Error:* ${errMsg}` });
    }
  });

  // ── Direct messages ────────────────────────────────────────────────────────

  slackApp.message(async ({ message, say }) => {
    // Only handle DMs (channel type 'im') to avoid processing every channel message
    if ((message as { channel_type?: string }).channel_type !== 'im') return;

    const text = ((message as { text?: string }).text || '').trim();
    const channelId = (message as { channel?: string }).channel || '';

    if (!text || text === 'help') {
      const config = getChannelConfig(channelId);
      await say({ blocks: buildHelpBlocks(config), text: 'AIquery Help' });
      return;
    }

    const parsed = parseCommand(text);
    if (!parsed.question) return;

    await say({ text: `:hourglass_flowing_sand: Generating SQL for: _${parsed.question}_` });

    const startTime = Date.now();
    try {
      const result = await handleQuery({
        question: parsed.question,
        channelId,
        userId: (message as { user?: string }).user || '',
        overrideDataSource: parsed.dataSource,
        overrideModel: parsed.model,
        forceExecute: parsed.execute,
      });
      result.latencyMs = Date.now() - startTime;

      await say({
        blocks: buildSQLBlocks({ question: parsed.question, ...result }),
        text: `SQL generated for: ${parsed.question}`,
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : 'Failed to generate SQL';
      await say({ text: `:x: *Error:* ${errMsg}` });
    }
  });

  console.log('[Slack] Bot initialized — listening on /slack/events');
  return slackApp;
}

// ─── Public API for schema management ────────────────────────────────────────

export function setChannelSchema(channelId: string, schemaContext: SchemaContext): void {
  setChannelConfig(channelId, { schemaContext });
}

export function getChannelConfigPublic(channelId: string): ChannelConfig {
  return getChannelConfig(channelId);
}
