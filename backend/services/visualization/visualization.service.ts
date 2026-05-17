/**
 * LLM-driven chart generation from query result rows → PNG in temp visualizations folder.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import { getLLMConfig } from '../../helpers/llm-config';
import { chatCompletionWithUserKey } from '../llm/llm.service';
import { CHART_KINDS, normalizeChartKind } from './chart-types';
import type { ChartKind } from './chart-types';
import type { ChartPlan } from './chart-plan';
import { renderChartToPng } from './render-chart';

const VIS_DIR = path.join(os.tmpdir(), 'visualizations');

function ensureVisDir(): void {
  fs.mkdirSync(VIS_DIR, { recursive: true });
}

export function isDataVisualizable(data: unknown): boolean {
  if (!Array.isArray(data) || data.length === 0) return false;
  if (typeof data[0] !== 'object' || data[0] === null) return false;
  const keys = Object.keys(data[0] as object);
  if (keys.length === 0) return false;
  if (data.length > 50000) return false;
  return true;
}

function rowsToCsvSample(rows: Record<string, unknown>[], max = 30): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const lines = [cols.join(',')];
  for (let i = 0; i < Math.min(max, rows.length); i++) {
    lines.push(cols.map((c) => JSON.stringify((rows[i] as Record<string, unknown>)[c] ?? '')).join(','));
  }
  return lines.join('\n');
}

function inferColumnHints(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  return cols
    .map((c) => {
      const v = (rows[0] as Record<string, unknown>)[c];
      const t =
        typeof v === 'number'
          ? 'number'
          : v instanceof Date
            ? 'date'
            : typeof v === 'boolean'
              ? 'boolean'
              : 'string';
      return `${c}:${t}`;
    })
    .join('; ');
}

const SYSTEM_PROMPT = `You are a data visualization expert. Given a user question and a tabular sample, respond with ONLY a JSON object (no markdown fences) describing the chart.

Allowed chartType values (exactly one):
${CHART_KINDS.map((k) => `"${k}"`).join(', ')}

Schema:
{
  "chartType": "<one allowed value>",
  "title": "concise chart title",
  "subtitle": "optional string",
  "xField": "exact column name or null",
  "yField": "exact column name or null",
  "colorField": "optional or null",
  "sizeField": "optional or null",
  "groupField": "for grouped_bar — second category column or null",
  "valueField": "for kpi / kpi_plus — primary numeric column or null",
  "secondaryField": "for kpi_plus — second numeric column for sparkline or null",
  "binField": "for histogram — column to bin or null",
  "xIsTemporal": true only if xField is dates/times,
  "aggregation": "sum" | "mean" | "count" | "none"
}

Rules:
- Use ONLY column names that appear in the sample header.
- pie: yField = measure, xField or colorField = category.
- histogram: set binField to the numeric column to distribute.
- box_plot: yField = numeric measure; xField = category.
- bubble: scatter with sizeField for bubble size.
- grouped_bar: groupField + xField (series) + yField.
- kpi: valueField = single number to highlight (or mean of column).
- kpi_plus: valueField + secondaryField (trend) + xField for time if present.
`;

function parseChartPlanFromLLM(raw: string, forcedChart: ChartKind | null): ChartPlan {
  let jsonStr = raw.replace(/```json\n?/gi, '').replace(/```/g, '').trim();
  const first = jsonStr.indexOf('{');
  const last = jsonStr.lastIndexOf('}');
  if (first >= 0 && last > first) jsonStr = jsonStr.slice(first, last + 1);
  const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
  const ct =
    normalizeChartKind(forcedChart ?? (parsed.chartType as string)) ?? 'bar';
  const agg = String(parsed.aggregation || '');
  return {
    chartType: ct,
    title: String(parsed.title || 'Chart'),
    subtitle: parsed.subtitle != null ? String(parsed.subtitle) : undefined,
    xField: parsed.xField != null && parsed.xField !== '' ? String(parsed.xField) : null,
    yField: parsed.yField != null && parsed.yField !== '' ? String(parsed.yField) : null,
    colorField: parsed.colorField != null && parsed.colorField !== '' ? String(parsed.colorField) : null,
    sizeField: parsed.sizeField != null && parsed.sizeField !== '' ? String(parsed.sizeField) : null,
    groupField: parsed.groupField != null && parsed.groupField !== '' ? String(parsed.groupField) : null,
    valueField: parsed.valueField != null && parsed.valueField !== '' ? String(parsed.valueField) : null,
    secondaryField: parsed.secondaryField != null && parsed.secondaryField !== '' ? String(parsed.secondaryField) : null,
    binField: parsed.binField != null && parsed.binField !== '' ? String(parsed.binField) : null,
    xIsTemporal: Boolean(parsed.xIsTemporal),
    aggregation: ['sum', 'mean', 'count', 'none'].includes(agg)
      ? (agg as ChartPlan['aggregation'])
      : undefined,
  };
}

function fallbackPlan(rows: Record<string, unknown>[], forced: ChartKind | null): ChartPlan {
  const keys = rows.length ? Object.keys(rows[0]) : [];
  const first = keys[0];
  const second = keys[1];
  const numKey =
    keys.find((k) => typeof (rows[0] as Record<string, unknown>)[k] === 'number') || second || first;
  const catKey = keys.find((k) => k !== numKey) || first;
  return {
    chartType: forced ?? 'bar',
    title: 'Query results',
    xField: catKey,
    yField: numKey,
    aggregation: 'sum',
  };
}

export const visualizationService = {
  isDataVisualizable,

  async generateLLMVisualization(opts: {
    data: Record<string, unknown>[];
    question: string;
    chartType?: string;
    userStyleRequest?: string;
    userId?: number;
  }): Promise<{ success: boolean; imagePath?: string; chartType?: string; error?: string }> {
    const { data, question, userId } = opts;
    const forced = normalizeChartKind(opts.chartType || undefined);

    if (!isDataVisualizable(data)) {
      return { success: false, error: 'Data is not visualizable' };
    }

    ensureVisDir();

    let plan: ChartPlan;
    try {
      const llmConfig = await getLLMConfig(userId);
      if (!llmConfig) {
        plan = fallbackPlan(data, forced);
      } else {
        const userMsg = [
          `User question: ${question}`,
          opts.userStyleRequest ? `Additional style/chart instruction: ${opts.userStyleRequest}` : '',
          forced ? `User selected chart type (must use this chartType): ${forced}` : '',
          `Column hints: ${inferColumnHints(data)}`,
          `CSV sample:\n${rowsToCsvSample(data)}`,
        ]
          .filter(Boolean)
          .join('\n\n');

        const raw = await chatCompletionWithUserKey(
          llmConfig.provider,
          llmConfig.apiKey,
          userMsg,
          {
            systemPrompt: SYSTEM_PROMPT,
            jsonMode: true,
            model: llmConfig.model,
            maxTokens: 1500,
            temperature: 0.08,
          }
        );
        plan = parseChartPlanFromLLM(raw, forced);
        if (forced) plan.chartType = forced;
      }
    } catch (e) {
      console.warn('[visualization] LLM chart planning failed, using heuristic fallback:', e);
      plan = fallbackPlan(data, forced);
    }

    try {
      const png = await renderChartToPng(plan, data);
      const fileName = `${randomUUID()}.png`;
      const fullPath = path.join(VIS_DIR, fileName);
      fs.writeFileSync(fullPath, png);
      // Return absolute path so Slack upload / fs.readFile use the real file; API layers send basename only.
      return { success: true, imagePath: fullPath, chartType: plan.chartType };
    } catch (e) {
      console.error('[visualization] Chart render failed:', e);
      return {
        success: false,
        error: e instanceof Error ? e.message : 'Render failed',
      };
    }
  },
};
