/**
 * Supported chart kinds — aligned with ChatBot chart-type buttons and LLM output.
 */
export const CHART_KINDS = [
  'line',
  'bar',
  'pie',
  'histogram',
  'scatter',
  'box_plot',
  'grouped_bar',
  'bubble',
  'kpi',
  'kpi_plus',
  'area',
] as const;

export type ChartKind = (typeof CHART_KINDS)[number];

export function normalizeChartKind(input: string | undefined | null): ChartKind | null {
  if (!input || typeof input !== 'string') return null;
  const s = input.trim().toLowerCase().replace(/[\s-]+/g, '_');
  const map: Record<string, ChartKind> = {
    line: 'line',
    bar: 'bar',
    pie: 'pie',
    histogram: 'histogram',
    scatter: 'scatter',
    box: 'box_plot',
    boxplot: 'box_plot',
    box_plot: 'box_plot',
    grouped_bar: 'grouped_bar',
    groupedbar: 'grouped_bar',
    bubble: 'bubble',
    kpi: 'kpi',
    kpi_plus: 'kpi_plus',
    kpiplus: 'kpi_plus',
    area: 'area',
  };
  return map[s] ?? (CHART_KINDS.includes(s as ChartKind) ? (s as ChartKind) : null);
}
