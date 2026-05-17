/**
 * SVG chart → PNG via sharp (no native canvas).
 */
import sharp from 'sharp';
import { buildSvgChart } from './svg-chart';
import type { ChartPlan } from './chart-plan';

export async function renderChartToPng(plan: ChartPlan, rows: Record<string, unknown>[]): Promise<Buffer> {
  const svg = buildSvgChart(plan, rows);
  return sharp(Buffer.from(svg, 'utf8'))
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}
