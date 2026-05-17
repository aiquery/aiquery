/**
 * Shared chart planning: LLM field mapping + tabular helpers (no renderer).
 */
import type { ChartKind } from './chart-types';

export interface ChartPlan {
  chartType: ChartKind;
  title: string;
  subtitle?: string;
  xField: string | null;
  yField: string | null;
  colorField?: string | null;
  sizeField?: string | null;
  groupField?: string | null;
  valueField?: string | null;
  secondaryField?: string | null;
  binField?: string | null;
  xIsTemporal?: boolean;
  aggregation?: 'sum' | 'mean' | 'count' | 'none';
}

export function keys(row: Record<string, unknown>): string[] {
  return Object.keys(row || {});
}

export function pickFirstNumeric(rows: Record<string, unknown>[], ex: Set<string>): string | null {
  if (!rows.length) return null;
  for (const k of keys(rows[0])) {
    if (ex.has(k)) continue;
    const v = rows[0][k];
    if (typeof v === 'number' && Number.isFinite(v)) return k;
    if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return k;
  }
  return null;
}

export function pickFirstOrdinal(rows: Record<string, unknown>[], ex: Set<string>): string | null {
  if (!rows.length) return null;
  for (const k of keys(rows[0])) {
    if (ex.has(k)) continue;
    const v = rows[0][k];
    if (typeof v === 'string' || typeof v === 'boolean') return k;
  }
  return keys(rows[0]).find((k) => !ex.has(k)) ?? null;
}

export function reconcilePlan(plan: ChartPlan, rows: Record<string, unknown>[]): ChartPlan {
  const ks = rows.length ? keys(rows[0]) : [];
  const keySet = new Set(ks);
  const fix = (f: string | null | undefined): string | null =>
    f && keySet.has(f) ? f : null;

  let xField = fix(plan.xField);
  let yField = fix(plan.yField);
  const colorField = fix(plan.colorField ?? null);
  const sizeField = fix(plan.sizeField ?? null);
  const groupField = fix(plan.groupField ?? null);
  let valueField = fix(plan.valueField ?? null);
  const secondaryField = fix(plan.secondaryField ?? null);
  let binField = fix(plan.binField ?? null);

  if (!valueField && (plan.chartType === 'kpi' || plan.chartType === 'kpi_plus')) {
    valueField = pickFirstNumeric(rows, new Set());
  }
  if (!yField && plan.chartType !== 'kpi') {
    yField = pickFirstNumeric(rows, new Set([xField || '']));
  }
  if (!xField && plan.chartType !== 'kpi' && plan.chartType !== 'histogram') {
    xField = pickFirstOrdinal(rows, new Set([yField || '']));
  }
  if (plan.chartType === 'histogram' && !binField) {
    binField = yField || pickFirstNumeric(rows, new Set()) || xField;
  }

  return {
    ...plan,
    xField,
    yField,
    colorField,
    sizeField,
    groupField,
    valueField,
    secondaryField,
    binField,
  };
}

export function num(r: Record<string, unknown>, f: string): number | null {
  const v = r[f];
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function histogramBins(rows: Record<string, unknown>[], field: string, binCount = 14) {
  const nums = rows.map((r) => num(r, field)).filter((n): n is number => n != null);
  if (!nums.length) return { labels: ['0'], data: [0] };
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const span = max - min || 1;
  const step = span / binCount;
  const counts = new Array(binCount).fill(0);
  const labels: string[] = [];
  for (let i = 0; i < binCount; i++) {
    const lo = min + i * step;
    const hi = min + (i + 1) * step;
    labels.push(`${lo.toFixed(2)}–${hi.toFixed(2)}`);
  }
  for (const n of nums) {
    const idx = Math.min(binCount - 1, Math.max(0, Math.floor((n - min) / step)));
    counts[idx]++;
  }
  return { labels, data: counts };
}

export function aggregateRows(
  rows: Record<string, unknown>[],
  catField: string,
  valField: string,
  mode: 'sum' | 'mean' | 'count'
): { labels: string[]; data: number[] } {
  if (mode === 'count') {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = String(r[catField] ?? '');
      m.set(k, (m.get(k) || 0) + 1);
    }
    return { labels: [...m.keys()], data: [...m.values()] };
  }
  const m = new Map<string, number[]>();
  for (const r of rows) {
    const k = String(r[catField] ?? '');
    const v = num(r, valField);
    if (v == null) continue;
    if (!m.has(k)) m.set(k, []);
    m.get(k)!.push(v);
  }
  const labels = [...m.keys()];
  const data = labels.map((lab) => {
    const arr = m.get(lab) || [];
    if (mode === 'sum') return arr.reduce((a, b) => a + b, 0);
    return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
  });
  return { labels, data };
}

/** Vibrant series / bar colors (used in rotation) */
export const CHART_PALETTE = [
  '#6366f1',
  '#8b5cf6',
  '#ec4899',
  '#f43f5e',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#06b6d4',
  '#3b82f6',
  '#a855f7',
  '#84cc16',
  '#f472b6',
  '#0ea5e9',
];

/** @deprecated use CHART_PALETTE — kept for imports */
export const COLORS = CHART_PALETTE;

/** Monday → Sunday order for weekday names */
const WEEKDAY_MON_FIRST: Record<string, number> = {
  monday: 0,
  mon: 0,
  tuesday: 1,
  tue: 1,
  tues: 1,
  wednesday: 2,
  wed: 2,
  thursday: 3,
  thu: 3,
  thur: 3,
  thurs: 3,
  friday: 4,
  fri: 4,
  saturday: 5,
  sat: 5,
  sunday: 6,
  sun: 6,
};

const MONTH_ORDER: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function weekdayRank(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\.$/, '');
  if (WEEKDAY_MON_FIRST[t] !== undefined) return WEEKDAY_MON_FIRST[t];
  return null;
}

function monthRank(s: string): number | null {
  const t = s.trim().toLowerCase().replace(/\.$/, '');
  if (MONTH_ORDER[t] !== undefined) return MONTH_ORDER[t];
  return null;
}

function quarterRank(s: string): number | null {
  const m = s.trim().toUpperCase().match(/^Q([1-4])$/);
  if (m) return parseInt(m[1], 10) - 1;
  return null;
}

function numericStringRank(s: string): number | null {
  const t = s.trim().replace(/,/g, '');
  if (/^-?\d+(\.\d+)?$/.test(t)) return parseFloat(t);
  return null;
}

/** Ascending sort for category axis: weekdays, months, quarters, dates, years, numbers, else locale */
export function compareLabelsAsc(a: string, b: string): number {
  const wa = weekdayRank(a);
  const wb = weekdayRank(b);
  if (wa !== null && wb !== null) return wa - wb;
  if (wa !== null) return -1;
  if (wb !== null) return 1;

  const ma = monthRank(a);
  const mb = monthRank(b);
  if (ma !== null && mb !== null) return ma - mb;
  if (ma !== null) return -1;
  if (mb !== null) return 1;

  const qa = quarterRank(a);
  const qb = quarterRank(b);
  if (qa !== null && qb !== null) return qa - qb;
  if (qa !== null) return -1;
  if (qb !== null) return 1;

  const da = Date.parse(a.trim());
  const db = Date.parse(b.trim());
  if (!Number.isNaN(da) && !Number.isNaN(db)) return da - db;
  if (!Number.isNaN(da)) return -1;
  if (!Number.isNaN(db)) return 1;

  const na = numericStringRank(a);
  const nb = numericStringRank(b);
  if (na !== null && nb !== null) return na - nb;
  if (na !== null) return -1;
  if (nb !== null) return 1;

  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/** Sort category labels (and paired values) in chronological / logical ascending order */
export function sortCategoryLabels(labels: string[], data: number[]): { labels: string[]; data: number[] } {
  if (labels.length !== data.length || labels.length === 0) {
    return { labels: [...labels], data: [...data] };
  }
  const pairs = labels.map((l, i) => ({ l, d: data[i] }));
  pairs.sort((p, q) => compareLabelsAsc(p.l, q.l));
  return { labels: pairs.map((p) => p.l), data: pairs.map((p) => p.d) };
}

export function sortStringsAsc(strings: string[]): string[] {
  return [...strings].sort(compareLabelsAsc);
}

function escXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** SVG title — multi-line via tspan */
export function svgTitle(yStart: number, text: string): string {
  const lines = text.split('\n').slice(0, 4);
  return lines
    .map(
      (line, i) =>
        `<tspan x="460" dy="${i === 0 ? 0 : 20}" text-anchor="middle">${escXml(line)}</tspan>`
    )
    .join('');
}

export const SVG_W = 920;
export const SVG_H = 520;
/** Padding: extra left/bottom for y-tick numbers and axis titles */
export const PAD = { l: 104, r: 56, t: 92, b: 88 };

/**
 * Output PNG pixel size = logical viewBox × scale (sharper text/lines when displayed).
 * Override with env CHART_RASTER_SCALE (1–4, default 2).
 */
function parseChartRasterScale(): number {
  const raw = typeof process !== 'undefined' && process.env?.CHART_RASTER_SCALE;
  const n = raw != null ? parseInt(String(raw), 10) : 2;
  if (Number.isFinite(n) && n >= 1 && n <= 4) return n;
  return 2;
}

export const CHART_RASTER_SCALE = parseChartRasterScale();
