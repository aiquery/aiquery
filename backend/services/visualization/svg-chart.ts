/**
 * Pure SVG charts (rasterized with sharp) — no native canvas; works on all platforms.
 */
import {
  reconcilePlan,
  aggregateRows,
  histogramBins,
  num,
  pickFirstNumeric,
  pickFirstOrdinal,
  keys,
  CHART_PALETTE,
  sortCategoryLabels,
  sortStringsAsc,
  SVG_W,
  SVG_H,
  PAD,
  CHART_RASTER_SCALE,
  type ChartPlan,
} from './chart-plan';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const iw = () => SVG_W - PAD.l - PAD.r;
const ih = () => SVG_H - PAD.t - PAD.b;

const plotLeft = () => PAD.l;
const plotTop = () => PAD.t;
const plotW = () => iw();
const plotH = () => ih();

function wrapSvg(title: string, inner: string): string {
  const titleLines = title.split('\n').slice(0, 5);
  const tspans = titleLines
    .map(
      (ln, i) =>
        `<tspan x="${SVG_W / 2}" dy="${i === 0 ? 28 : 18}" text-anchor="middle" font-size="15" font-weight="600" font-family="system-ui,sans-serif" fill="#0f172a">${esc(
          ln.length > 100 ? `${ln.slice(0, 97)}…` : ln
        )}</tspan>`
    )
    .join('');
  const gradId = `bg-${Math.random().toString(36).slice(2, 9)}`;
  const rw = SVG_W * CHART_RASTER_SCALE;
  const rh = SVG_H * CHART_RASTER_SCALE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${rw}" height="${rh}" viewBox="0 0 ${SVG_W} ${SVG_H}">
  <defs>
    <linearGradient id="${gradId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#f8fafc"/>
      <stop offset="100%" style="stop-color:#f1f5f9"/>
    </linearGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#${gradId})"/>
  <text font-family="system-ui,sans-serif">${tspans}</text>
  ${inner}
</svg>`;
}

function formatTick(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  if (Number.isInteger(n)) return String(n);
  const t = n.toFixed(4);
  return t.replace(/\.?0+$/, '');
}

function niceYTicks(min: number, max: number, maxTicks = 6): number[] {
  if (min === max) {
    const pad = Math.abs(min) * 0.1 || 1;
    return niceYTicks(min - pad, max + pad, maxTicks);
  }
  const range = max - min;
  const rough = range / Math.max(maxTicks - 1, 1);
  const pow10 = Math.pow(10, Math.floor(Math.log10(Math.abs(rough) || 1)));
  const niceStepRaw = rough / pow10;
  const f = niceStepRaw <= 1 ? 1 : niceStepRaw <= 2 ? 2 : niceStepRaw <= 5 ? 5 : 10;
  const step = f * pow10;
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let x = lo; x <= hi + step * 0.001 && ticks.length < 14; x += step) {
    ticks.push(Math.round(x * 1e12) / 1e12);
  }
  return ticks.length ? ticks : [min, max];
}

/** Cartesian Y grid + ticks + baseline axes */
function yAxisAndGrid(yMin: number, yMax: number): string {
  const L = plotLeft();
  const T = plotTop();
  const W = plotW();
  const H = plotH();
  const ticks = niceYTicks(yMin, yMax, 6);
  let g = '';
  for (const t of ticks) {
    const y = T + H - ((t - yMin) / (yMax - yMin || 1)) * H;
    g += `<line x1="${L}" y1="${y}" x2="${L + W}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
    g += `<text x="${L - 10}" y="${y + 4}" text-anchor="end" font-size="11" fill="#475569" font-family="system-ui,sans-serif">${esc(
      formatTick(t)
    )}</text>`;
  }
  g += `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + H}" stroke="#64748b" stroke-width="1.5"/>`;
  g += `<line x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}" stroke="#64748b" stroke-width="1.5"/>`;
  return g;
}

/** Rotated axis title (Y) and horizontal (X) */
function axisTitles(xLabel: string, yLabel: string): string {
  const cx = plotLeft() + plotW() / 2;
  const yBottom = SVG_H - 22;
  const yLeft = plotTop() + plotH() / 2;
  return `<text x="${cx}" y="${yBottom}" text-anchor="middle" font-size="13" font-weight="600" fill="#334155" font-family="system-ui,sans-serif">${esc(
    humanFieldName(xLabel)
  )}</text>
  <text transform="translate(28, ${yLeft}) rotate(-90)" text-anchor="middle" font-size="13" font-weight="600" fill="#334155" font-family="system-ui,sans-serif">${esc(
    humanFieldName(yLabel)
  )}</text>`;
}

function humanFieldName(f: string): string {
  if (!f) return '';
  return f
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function quartiles(sorted: number[]) {
  if (!sorted.length) return { min: 0, q1: 0, med: 0, q3: 0, max: 0 };
  const q = (p: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.round((sorted.length - 1) * p)))];
  return {
    min: sorted[0],
    q1: q(0.25),
    med: q(0.5),
    q3: q(0.75),
    max: sorted[sorted.length - 1],
  };
}

function aggregationLabel(agg: string | undefined): string {
  const a = (agg || 'sum').toLowerCase();
  if (a === 'mean') return 'average';
  if (a === 'count') return 'count';
  if (a === 'none') return 'value';
  return 'sum';
}

/**
 * @param categoryField — column used for slice labels (e.g. customer, year, month)
 * @param valueField — numeric column aggregated per slice
 */
function pieSlices(
  labels: string[],
  data: number[],
  colors: string[],
  valueField: string,
  categoryField: string,
  aggregation: string | undefined
): string {
  const sum = data.reduce((a, b) => a + b, 0) || 1;
  const cx = SVG_W * 0.38;
  const cy = SVG_H / 2 + 8;
  const r = Math.min(iw() * 0.42, ih() * 0.55);
  const catTitle = humanFieldName(categoryField);
  const valTitle = humanFieldName(valueField);
  const aggWord = aggregationLabel(aggregation);

  /** Keys beside & under the pie (left column avoids overlapping the chart title at top) */
  const keyAround = `
  <text x="20" y="108" font-size="12" font-weight="700" fill="#0f172a" font-family="system-ui,sans-serif">Chart keys</text>
  <text x="20" y="128" font-size="10" fill="#334155" font-family="system-ui,sans-serif">${esc(`Slices → ${catTitle}`)}</text>
  <text x="20" y="144" font-size="9" fill="#64748b" font-family="system-ui,sans-serif">${esc(
    `(each wedge = one ${catTitle.toLowerCase()})`
  )}</text>
  <text x="20" y="164" font-size="10" fill="#334155" font-family="system-ui,sans-serif">${esc(`Values → ${valTitle}`)}</text>
  <text x="20" y="180" font-size="9" fill="#64748b" font-family="system-ui,sans-serif">${esc(`(${aggWord} for each slice)`)}</text>
  <text x="${cx}" y="${cy + r + 24}" text-anchor="middle" font-size="10" fill="#475569" font-family="system-ui,sans-serif">${esc(
    `${catTitle} × ${valTitle} (${aggWord})`
  )}</text>`;

  let a0 = -Math.PI / 2;
  let paths = '';
  let annotations = '';
  for (let i = 0; i < data.length; i++) {
    const lab = labels[i] ?? '';
    const frac = data[i] / sum;
    const a1 = a0 + frac * 2 * Math.PI;
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy + r * Math.sin(a1);
    const large = a1 - a0 > Math.PI ? 1 : 0;
    paths += `<path d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} Z" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="2"/>`;

    const mid = (a0 + a1) / 2;
    const span = a1 - a0;
    const outside = span < 0.18 || frac < 0.04;
    const labelR = outside ? r * 1.12 : r * 0.62;
    const tx = cx + labelR * Math.cos(mid);
    const ty = cy + labelR * Math.sin(mid);
    const pctNum = frac * 100;
    const pctStr = pctNum < 10 && pctNum % 1 !== 0 ? `${pctNum.toFixed(1)}%` : `${Math.round(pctNum)}%`;
    const valStr = formatTick(data[i]);
    const fs = outside ? 10 : Math.min(12, 9 + Math.floor(frac * 40));
    const labelStroke = 'rgba(255,255,255,0.92)';
    const showCatOnSlice = span >= 0.14 && frac >= 0.05;
    const catLine = showCatOnSlice ? esc(lab.slice(0, 16)) : '';
    let dy = showCatOnSlice ? -14 : -5;
    if (showCatOnSlice) {
      annotations += `<text x="${tx}" y="${ty + dy}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(8, fs - 3)}" font-weight="700" fill="#0f172a" stroke="${labelStroke}" stroke-width="2" paint-order="stroke fill" font-family="system-ui,sans-serif">${catLine}</text>`;
      dy = 6;
    } else {
      dy = -5;
    }
    annotations += `<text x="${tx}" y="${ty + dy}" text-anchor="middle" dominant-baseline="middle" font-size="${fs}" font-weight="700" fill="#0f172a" stroke="${labelStroke}" stroke-width="2.5" paint-order="stroke fill" font-family="system-ui,sans-serif">${esc(
      pctStr
    )}</text>`;
    annotations += `<text x="${tx}" y="${ty + dy + (fs > 10 ? 14 : 12)}" text-anchor="middle" dominant-baseline="middle" font-size="${Math.max(8, fs - 2)}" font-weight="600" fill="#0f172a" stroke="${labelStroke}" stroke-width="2" paint-order="stroke fill" font-family="system-ui,sans-serif">${esc(
      valStr
    )}</text>`;

    a0 = a1;
  }
  const legX = SVG_W * 0.62;
  let legY = PAD.t + 36;
  let leg = `<text x="${legX}" y="${legY - 8}" font-size="11" font-weight="600" fill="#475569" font-family="system-ui,sans-serif">${esc(
    `Legend · ${catTitle} → ${valTitle} (${aggWord})`
  )}</text>`;
  labels.forEach((lab, i) => {
    const frac = data[i] / sum;
    const pctStr = `${Math.round(frac * 100)}%`;
    const valStr = formatTick(data[i]);
    leg += `<rect x="${legX}" y="${legY + i * 22}" width="12" height="12" rx="2" fill="${colors[i % colors.length]}"/>`;
    leg += `<text x="${legX + 18}" y="${legY + 10 + i * 22}" font-size="11" font-family="system-ui,sans-serif" fill="#1e293b">${esc(
      `${catTitle}: ${lab.slice(0, 22)} → ${valStr} (${pctStr})`
    )}</text>`;
  });
  return keyAround + paths + annotations + leg;
}

function seriesLegend(items: { label: string; color: string }[], x: number, y: number): string {
  let s = `<text x="${x}" y="${y}" font-size="12" font-weight="600" fill="#475569" font-family="system-ui,sans-serif">Series</text>`;
  items.forEach((it, i) => {
    s += `<rect x="${x}" y="${y + 8 + i * 18}" width="12" height="12" rx="2" fill="${it.color}"/>`;
    s += `<text x="${x + 18}" y="${y + 18 + i * 18}" font-size="11" fill="#1e293b" font-family="system-ui,sans-serif">${esc(
      it.label.slice(0, 28)
    )}</text>`;
  });
  return s;
}

export function buildSvgChart(plan: ChartPlan, rows: Record<string, unknown>[]): string {
  const p = reconcilePlan(plan, rows);
  const slice = rows.slice(0, 5000);
  const titleBlock = p.subtitle ? `${p.title}\n${p.subtitle}` : p.title;

  if (p.chartType === 'kpi') {
    const vf = p.valueField || p.yField || pickFirstNumeric(slice, new Set());
    const nums = vf ? slice.map((r) => num(r, vf)).filter((n): n is number => n != null) : [];
    const agg =
      !vf || !nums.length
        ? 'N/A'
        : p.aggregation === 'sum'
          ? String(nums.reduce((a, b) => a + b, 0))
          : p.aggregation === 'count'
            ? String(nums.length)
            : String(Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * 1000) / 1000);
    const inner = `<text x="${SVG_W / 2}" y="${SVG_H / 2 + 12}" text-anchor="middle" font-size="48" font-weight="bold" font-family="system-ui,sans-serif" fill="#4f46e5">${esc(
      agg
    )}</text>
    <text x="${SVG_W / 2}" y="${SVG_H / 2 + 58}" text-anchor="middle" font-size="14" fill="#64748b" font-family="system-ui,sans-serif">${vf ? esc(humanFieldName(vf)) : 'Value'}</text>`;
    return wrapSvg(titleBlock, inner);
  }

  if (p.chartType === 'kpi_plus') {
    const vf = p.valueField || p.yField || pickFirstNumeric(slice, new Set());
    const sf = p.secondaryField || pickFirstNumeric(slice, new Set([vf || '']));
    const xf = p.xField || pickFirstOrdinal(slice, new Set([vf || '', sf || '']));
    const nums = vf ? slice.map((r) => num(r, vf!)).filter((n): n is number => n != null) : [];
    const primary = !nums.length
      ? 0
      : p.aggregation === 'count'
        ? nums.length
        : p.aggregation === 'sum' || p.aggregation === 'none'
          ? nums.reduce((a, b) => a + b, 0)
          : nums.reduce((a, b) => a + b, 0) / nums.length;
    const primaryStr = Number.isInteger(primary) ? String(primary) : String(Math.round(primary * 1000) / 1000);
    const pts =
      xf && sf
        ? slice
            .map((r) => {
              const yy = num(r, sf!);
              if (yy == null) return null;
              return yy;
            })
            .filter((n): n is number => n != null)
        : [];
    const maxY = pts.length ? Math.max(...pts) : 1;
    const minY = pts.length ? Math.min(...pts) : 0;
    const ch = ih() * 0.4;
    const topY = PAD.t + 102;
    let d = '';
    const rngY = maxY - minY || 1;
    pts.forEach((v, i) => {
      const px = PAD.l + (i / Math.max(pts.length - 1, 1)) * iw();
      const py = topY + ch - ((v - minY) / rngY) * ch;
      d += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
    });
    const line = pts.length
      ? `<path d="${d}" fill="none" stroke="${CHART_PALETTE[3]}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`
      : '';
    const kpiText = `<text x="${SVG_W / 2}" y="${PAD.t + 72}" text-anchor="middle" font-size="20" font-weight="600" fill="#0f172a" font-family="system-ui,sans-serif">KPI: ${esc(
      primaryStr
    )}</text>
    <text x="${SVG_W / 2}" y="${PAD.t + 94}" text-anchor="middle" font-size="12" fill="#64748b" font-family="system-ui,sans-serif">${vf ? esc(humanFieldName(vf)) : ''}${
      sf ? ` · Trend: ${esc(humanFieldName(sf))}` : ''
    }</text>`;
    const miniAxes =
      pts.length > 0
        ? `<text x="${PAD.l + iw() / 2}" y="${topY + ch + 22}" text-anchor="middle" font-size="11" fill="#64748b" font-family="system-ui,sans-serif">${esc(
            humanFieldName(sf || 'measure')
          )}</text>`
        : '';
    return wrapSvg(titleBlock, kpiText + line + miniAxes);
  }

  const xf = p.xField || pickFirstOrdinal(slice, new Set());
  const yf = p.yField || pickFirstNumeric(slice, new Set());
  if (!xf || !yf) {
    const k0 = slice.length ? keys(slice[0])[0] : 'x';
    const k1 = slice.length ? keys(slice[0])[1] || k0 : 'y';
    const raw = slice.length ? aggregateRows(slice, k0, k1, 'sum') : { labels: ['—'], data: [0] };
    const sorted = sortCategoryLabels(raw.labels, raw.data);
    return wrapSvg(titleBlock, barRects(sorted.labels, sorted.data, k0, k1, { gradient: true }));
  }

  switch (p.chartType) {
    case 'pie': {
      const raw = aggregateRows(slice, xf, yf, p.aggregation === 'mean' ? 'mean' : 'sum');
      const sorted = sortCategoryLabels(raw.labels, raw.data);
      return wrapSvg(
        titleBlock,
        pieSlices(sorted.labels, sorted.data, CHART_PALETTE, yf, xf, p.aggregation)
      );
    }

    case 'histogram': {
      const field = p.binField || yf || xf;
      const { labels, data } = histogramBins(slice, field!, 14);
      return wrapSvg(
        titleBlock,
        barRects(labels, data, `${field} (range)`, 'Frequency', { singleHue: CHART_PALETTE[5], histogram: true })
      );
    }

    case 'scatter': {
      const pts = slice
        .map((r) => {
          const x = num(r, xf);
          const y = num(r, yf);
          if (x == null || y == null) return null;
          return { x, y };
        })
        .filter(Boolean) as { x: number; y: number }[];
      if (!pts.length) return wrapSvg(titleBlock, axisFrame() + axisTitles(xf, yf));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rx = maxX - minX || 1;
      const ry = maxY - minY || 1;
      const circles = pts
        .map((pt, i) => {
          const px = plotLeft() + ((pt.x - minX) / rx) * plotW();
          const py = plotTop() + plotH() - ((pt.y - minY) / ry) * plotH();
          return `<circle cx="${px}" cy="${py}" r="6" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}" fill-opacity="0.85" stroke="#fff" stroke-width="1"/>`;
        })
        .join('');
      return wrapSvg(titleBlock, scatterAxes(minX, maxX, minY, maxY) + circles + axisTitles(xf, yf));
    }

    case 'bubble': {
      const sf = p.sizeField || pickFirstNumeric(slice, new Set([xf, yf]));
      const pts = slice
        .map((r) => {
          const x = num(r, xf);
          const y = num(r, yf);
          const rv = sf ? num(r, sf) : null;
          if (x == null || y == null) return null;
          const rad = rv != null ? Math.max(5, Math.min(32, Math.sqrt(Math.abs(rv)) * 2.2)) : 12;
          return { x, y, r: rad };
        })
        .filter(Boolean) as { x: number; y: number; r: number }[];
      if (!pts.length) return wrapSvg(titleBlock, axisFrame() + axisTitles(xf, yf));
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const rx = maxX - minX || 1;
      const ry = maxY - minY || 1;
      const circles = pts
        .map((pt, i) => {
          const px = plotLeft() + ((pt.x - minX) / rx) * plotW();
          const py = plotTop() + plotH() - ((pt.y - minY) / ry) * plotH();
          return `<circle cx="${px}" cy="${py}" r="${pt.r}" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}" fill-opacity="0.55" stroke="#fff" stroke-width="1.5"/>`;
        })
        .join('');
      const sizeNote = sf
        ? `<text x="${plotLeft() + plotW() / 2}" y="${PAD.t - 8}" text-anchor="middle" font-size="11" fill="#64748b" font-family="system-ui,sans-serif">Bubble size ∝ ${esc(
            humanFieldName(sf)
          )}</text>`
        : '';
      return wrapSvg(titleBlock, sizeNote + scatterAxes(minX, maxX, minY, maxY) + circles + axisTitles(xf, yf));
    }

    case 'box_plot': {
      const cat = xf;
      const val = yf;
      const map = new Map<string, number[]>();
      for (const r of slice) {
        const k = String(r[cat] ?? '');
        const n = num(r, val);
        if (n == null) continue;
        if (!map.has(k)) map.set(k, []);
        map.get(k)!.push(n);
      }
      const labels = sortStringsAsc([...map.keys()]).slice(0, 24);
      const allVals = labels.flatMap((lab) => map.get(lab) || []);
      if (!allVals.length) return wrapSvg(titleBlock, axisFrame() + axisTitles(xf, yf));
      const ch = plotH();
      const cw = plotW() / Math.max(labels.length, 1);
      const globalMin = Math.min(0, ...allVals);
      const globalMax = Math.max(...allVals, 1e-9);
      let parts = yAxisAndGrid(globalMin, globalMax) + axisTitles(xf, yf);
      labels.forEach((lab, i) => {
        const arr = (map.get(lab) || []).sort((a, b) => a - b);
        if (!arr.length) return;
        const q = quartiles(arr);
        const cx = plotLeft() + i * cw + cw / 2;
        const lo = Math.min(...arr);
        const hi = Math.max(...arr);
        const rng = hi - lo || 1e-9;
        const y = (v: number) => plotTop() + ch - ((v - globalMin) / (globalMax - globalMin || 1)) * ch;
        const yMin = y(q.min);
        const yMax = y(q.max);
        const yQ1 = y(q.q1);
        const yQ3 = y(q.q3);
        const yMed = y(q.med);
        parts += `<line x1="${cx}" y1="${yMax}" x2="${cx}" y2="${yMin}" stroke="#64748b" stroke-width="1.5"/>`;
        parts += `<rect x="${cx - cw * 0.22}" y="${Math.min(yQ3, yQ1)}" width="${cw * 0.44}" height="${Math.abs(yQ1 - yQ3)}" fill="${CHART_PALETTE[i % CHART_PALETTE.length]}" fill-opacity="0.45" stroke="#334155" stroke-width="1"/>`;
        parts += `<line x1="${cx - cw * 0.32}" y1="${yMed}" x2="${cx + cw * 0.32}" y2="${yMed}" stroke="#0f172a" stroke-width="2"/>`;
        parts += `<text x="${cx}" y="${plotTop() + ch + 14}" text-anchor="middle" font-size="9" fill="#475569" font-family="system-ui,sans-serif" transform="rotate(-35 ${cx} ${plotTop() + ch + 14})">${esc(
          lab.slice(0, 14)
        )}</text>`;
      });
      return wrapSvg(titleBlock, parts);
    }

    case 'grouped_bar': {
      const gf = p.groupField;
      if (!gf) {
        const raw = aggregateRows(slice, xf, yf, 'sum');
        const sorted = sortCategoryLabels(raw.labels, raw.data);
        return wrapSvg(titleBlock, barRects(sorted.labels, sorted.data, xf, yf, { gradient: true }));
      }
      const xVals = sortStringsAsc([...new Set(slice.map((r) => String(r[xf] ?? '')))].slice(0, 16));
      const groups = sortStringsAsc([...new Set(slice.map((r) => String(r[gf] ?? '')))].slice(0, 8));
      const maxV = Math.max(
        1,
        ...xVals.flatMap((xv) =>
          groups.map((g) => {
            const row = slice.find((r) => String(r[xf] ?? '') === xv && String(r[gf] ?? '') === g);
            return row ? num(row, yf) ?? 0 : 0;
          })
        )
      );
      const yMin = 0;
      const yMax = maxV;
      let parts = yAxisAndGrid(yMin, yMax) + axisTitles(xf, yf);
      const cw = plotW() / Math.max(xVals.length, 1);
      const bw = (cw * 0.82) / Math.max(groups.length, 1);
      xVals.forEach((xv, xi) => {
        groups.forEach((g, gi) => {
          const row = slice.find((r) => String(r[xf] ?? '') === xv && String(r[gf] ?? '') === g);
          const v = row ? num(row, yf) ?? 0 : 0;
          const h = (v / (yMax - yMin || 1)) * plotH();
          const x = plotLeft() + xi * cw + gi * bw + cw * 0.06;
          const y = plotTop() + plotH() - h;
          parts += `<rect x="${x}" y="${y}" width="${bw * 0.9}" height="${h}" fill="${CHART_PALETTE[gi % CHART_PALETTE.length]}" rx="3" stroke="#fff" stroke-width="1"/>`;
        });
        parts += `<text x="${plotLeft() + xi * cw + cw / 2}" y="${plotTop() + plotH() + 12}" text-anchor="middle" font-size="9" fill="#475569" font-family="system-ui,sans-serif" transform="rotate(-30 ${plotLeft() + xi * cw + cw / 2} ${plotTop() + plotH() + 12})">${esc(
          xv.slice(0, 10)
        )}</text>`;
      });
      parts += seriesLegend(
        groups.map((g, i) => ({ label: g, color: CHART_PALETTE[i % CHART_PALETTE.length] })),
        SVG_W - 168,
        PAD.t + 28
      );
      return wrapSvg(titleBlock, parts);
    }

    case 'line': {
      const raw = aggregateRows(slice, xf, yf, p.aggregation === 'mean' ? 'mean' : 'sum');
      const sorted = sortCategoryLabels(raw.labels, raw.data);
      return wrapSvg(titleBlock, linePath(sorted.labels, sorted.data, false, xf, yf));
    }

    case 'area': {
      const raw = aggregateRows(slice, xf, yf, p.aggregation === 'mean' ? 'mean' : 'sum');
      const sorted = sortCategoryLabels(raw.labels, raw.data);
      return wrapSvg(titleBlock, linePath(sorted.labels, sorted.data, true, xf, yf));
    }

    case 'bar':
    default: {
      const raw = aggregateRows(slice, xf, yf, p.aggregation === 'mean' ? 'mean' : 'sum');
      const sorted = sortCategoryLabels(raw.labels, raw.data);
      return wrapSvg(titleBlock, barRects(sorted.labels, sorted.data, xf, yf, { gradient: true }));
    }
  }
}

function axisFrame(): string {
  return `<rect x="${plotLeft()}" y="${plotTop()}" width="${plotW()}" height="${plotH()}" fill="none" stroke="#cbd5e1" stroke-width="1"/>`;
}

/** Numeric X/Y scatter axes with tick labels */
function scatterAxes(minX: number, maxX: number, minY: number, maxY: number): string {
  const xTicks = niceYTicks(minX, maxX, 5);
  const yTicks = niceYTicks(minY, maxY, 5);
  let s = '';
  const L = plotLeft();
  const T = plotTop();
  const W = plotW();
  const H = plotH();
  for (const t of yTicks) {
    const y = T + H - ((t - minY) / (maxY - minY || 1)) * H;
    s += `<line x1="${L}" y1="${y}" x2="${L + W}" y2="${y}" stroke="#e2e8f0" stroke-width="1"/>`;
    s += `<text x="${L - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#475569" font-family="system-ui,sans-serif">${esc(formatTick(t))}</text>`;
  }
  for (const t of xTicks) {
    const x = L + ((t - minX) / (maxX - minX || 1)) * W;
    s += `<line x1="${x}" y1="${T}" x2="${x}" y2="${T + H}" stroke="#e2e8f0" stroke-width="1"/>`;
    s += `<text x="${x}" y="${T + H + 16}" text-anchor="middle" font-size="10" fill="#475569" font-family="system-ui,sans-serif">${esc(formatTick(t))}</text>`;
  }
  s += `<line x1="${L}" y1="${T}" x2="${L}" y2="${T + H}" stroke="#64748b" stroke-width="1.5"/>`;
  s += `<line x1="${L}" y1="${T + H}" x2="${L + W}" y2="${T + H}" stroke="#64748b" stroke-width="1.5"/>`;
  return s;
}

function barRects(
  labels: string[],
  data: number[],
  xLabel: string,
  yLabel: string,
  opts?: { singleHue?: string; histogram?: boolean; gradient?: boolean }
): string {
  const max = Math.max(...data, 1e-9);
  const yMin = 0;
  const yMax = max;
  let parts = yAxisAndGrid(yMin, yMax) + axisTitles(xLabel, opts?.histogram ? 'Count' : yLabel);
  const n = labels.length;
  const cw = plotW() / n;
  const barW = cw * (opts?.histogram ? 0.88 : 0.68);
  const ch = plotH();
  for (let i = 0; i < n; i++) {
    const h = (data[i] / max) * ch;
    const x = plotLeft() + i * cw + (cw - barW) / 2;
    const y = plotTop() + ch - h;
    const fill =
      opts?.singleHue ||
      (opts?.gradient ? CHART_PALETTE[i % CHART_PALETTE.length] : CHART_PALETTE[i % CHART_PALETTE.length]);
    parts += `<rect x="${x}" y="${y}" width="${barW}" height="${h}" fill="${fill}" rx="4" stroke="#fff" stroke-width="1"/>`;
    const lx = x + barW / 2;
    const ly = plotTop() + ch + (n > 12 ? 10 : 18);
    const rot = n > 10 ? -40 : 0;
    if (rot) {
      parts += `<text x="${lx}" y="${ly}" text-anchor="end" font-size="9" fill="#475569" font-family="system-ui,sans-serif" transform="rotate(${rot} ${lx} ${ly})">${esc(
        labels[i].slice(0, 16)
      )}</text>`;
    } else {
      parts += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="10" fill="#475569" font-family="system-ui,sans-serif">${esc(labels[i].slice(0, 14))}</text>`;
    }
  }
  return parts;
}

function linePath(labels: string[], vals: number[], fillArea: boolean, xf: string, yf: string): string {
  const max = Math.max(...vals, 1e-9);
  const min = Math.min(0, ...vals);
  const yMin = min;
  const yMax = max;
  let parts = yAxisAndGrid(yMin, yMax) + axisTitles(xf, yf);
  const ch = plotH();
  const n = vals.length;
  const step = plotW() / Math.max(n - 1, 1);
  let pts = '';
  for (let i = 0; i < n; i++) {
    const px = plotLeft() + i * step;
    const py = plotTop() + ch - ((vals[i] - yMin) / (yMax - yMin || 1)) * ch;
    pts += i === 0 ? `M ${px} ${py}` : ` L ${px} ${py}`;
  }
  const strokeC = CHART_PALETTE[3];
  const fillC = CHART_PALETTE[0];
  const line = `<path d="${pts}" fill="none" stroke="${strokeC}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (fillArea) {
    const lastX = plotLeft() + (n - 1) * step;
    const baseY = plotTop() + ch;
    const areaD = `${pts} L ${lastX} ${baseY} L ${plotLeft()} ${baseY} Z`;
    parts += `<path d="${areaD}" fill="${fillC}" fill-opacity="0.35" stroke="none"/>` + line;
  } else {
    parts += line;
  }
  for (let i = 0; i < n; i++) {
    const px = plotLeft() + i * step;
    const py = plotTop() + ch - ((vals[i] - yMin) / (yMax - yMin || 1)) * ch;
    parts += `<circle cx="${px}" cy="${py}" r="4" fill="#fff" stroke="${strokeC}" stroke-width="2"/>`;
  }
  for (let i = 0; i < n; i++) {
    const px = plotLeft() + i * step;
    const showEvery = n > 15 ? Math.ceil(n / 15) : 1;
    if (i % showEvery !== 0 && i !== n - 1) continue;
    const ty = plotTop() + ch + (n > 12 ? 12 : 18);
    const tf =
      n > 12 ? ` transform="rotate(-35 ${px} ${plotTop() + ch + 12})"` : '';
    parts += `<text x="${px}" y="${ty}" text-anchor="middle" font-size="9" fill="#475569" font-family="system-ui,sans-serif"${tf}>${esc(
      labels[i].slice(0, 12)
    )}</text>`;
  }
  return parts;
}
