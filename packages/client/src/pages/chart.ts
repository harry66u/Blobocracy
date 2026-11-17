// "The internet getting better": every attempt's progress as a dot, the record as a pink
// line stepping up, zones as bands in the colors of their skies. Canvas, so tens of
// thousands of runs stay cheap; geometry helpers are pure and tested.
export type Point = [run: number, progress: number, at: number];
export interface ChartZone { index: number; name: string; sky: 'blue' | 'sunset' | 'purple'; start: number }
export interface ChartData { series: Point[]; records: Point[]; zones: ChartZone[]; lastRun: number; bucket: number }
export interface Rect { x: number; y: number; w: number; h: number }

const INK = '#2A1B3D', PINK = '#FF3B7A', BLOB = '#FFD21F', CREAM_HI = '#FFFBF1';
/** Light tints of each zone's sky, alternating so neighbouring zones of one sky still read apart. */
export const BAND: Record<ChartZone['sky'], [string, string]> = {
  blue: ['#E3F4FF', '#D3EDFF'],
  sunset: ['#FFE9D6', '#FFDDC6'],
  purple: ['#EEE3F8', '#E3D4F3'],
};
export const BAND_EDGE: Record<ChartZone['sky'], string> = { blue: '#5FBFFF', sunset: '#FF7E5F', purple: '#8A4DB3' };

/** Round tick values covering [min, max], about `count` of them. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? 10 * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1e6) / 1e6);
  return out;
}

/** The record line as a staircase: flat until the next record, then straight up; runs on to `lastRun`. */
export function recordSteps(records: readonly Point[], lastRun: number): [number, number][] {
  const out: [number, number][] = [];
  records.forEach(([run, p], i) => {
    if (i > 0) out.push([run, records[i - 1]![1]]);
    out.push([run, p]);
  });
  const last = records[records.length - 1];
  if (last && lastRun > last[0]) out.push([lastRun, last[1]]);
  return out;
}

/** Index of the series point nearest to `run` (series sorted by run). */
export function nearestIndex(series: readonly Point[], run: number): number {
  let lo = 0, hi = series.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid]![0] < run) lo = mid + 1; else hi = mid;
  }
  if (lo > 0 && Math.abs(series[lo - 1]![0] - run) <= Math.abs(series[lo]![0] - run)) return lo - 1;
  return lo;
}

export function plotRect(w: number, h: number, phone: boolean): Rect {
  const left = phone ? 26 : 150, right = phone ? 40 : 54, top = 14, bottom = 30;
  return { x: left, y: top, w: Math.max(10, w - left - right), h: Math.max(10, h - top - bottom) };
}

export const xOf = (r: Rect, run: number, maxRun: number) => r.x + (maxRun <= 1 ? 0 : ((run - 1) / (maxRun - 1)) * r.w);
export const yOf = (r: Rect, p: number) => r.y + (1 - p) * r.h;
export const runAt = (r: Rect, x: number, maxRun: number) => 1 + ((x - r.x) / r.w) * (maxRun - 1);

/** Draws the chart; `reveal` 0..1 sweeps it in from the left. */
export function drawChart(g: CanvasRenderingContext2D, w: number, h: number, d: ChartData, o: { phone: boolean; reveal: number; hover: number | null; font: string; display: string }): Rect {
  const r = plotRect(w, h, o.phone);
  const maxRun = Math.max(2, d.lastRun);
  g.clearRect(0, 0, w, h);

  // zone bands (bottom = start of the level)
  const zones = [...d.zones].sort((a, b) => a.start - b.start);
  zones.forEach((z, i) => {
    const y0 = yOf(r, i + 1 < zones.length ? zones[i + 1]!.start : 1), y1 = yOf(r, z.start);
    g.fillStyle = BAND[z.sky][z.index % 2]!;
    g.fillRect(r.x, y0, r.w, y1 - y0);
    g.fillStyle = BAND_EDGE[z.sky];
    g.fillRect(r.x, y0, 5, y1 - y0);
  });
  // percent grid and labels
  g.textAlign = 'left';
  g.font = `700 ${o.phone ? 11 : 12.5}px ${o.font}`;
  for (const p of [0, 0.25, 0.5, 0.75, 1]) {
    const y = Math.round(yOf(r, p)) + 0.5;
    g.strokeStyle = 'rgba(42,27,61,.14)';
    g.lineWidth = 1;
    g.setLineDash([3, 5]);
    g.beginPath(); g.moveTo(r.x, y); g.lineTo(r.x + r.w, y); g.stroke();
    g.setLineDash([]);
    g.fillStyle = 'rgba(42,27,61,.72)';
    g.textBaseline = 'middle';
    g.fillText(`${p * 100}%`, r.x + r.w + 8, y);
  }
  // run ticks
  g.textAlign = 'center';
  g.textBaseline = 'top';
  for (const t of niceTicks(1, maxRun, o.phone ? 3 : 7)) {
    if (t < 1 || !Number.isInteger(t)) continue;
    const x = xOf(r, t, maxRun);
    g.fillStyle = 'rgba(42,27,61,.4)';
    g.fillRect(Math.round(x), r.y + r.h, 1, 5);
    g.fillStyle = 'rgba(42,27,61,.72)';
    g.fillText(`run ${Math.round(t).toLocaleString('en-US')}`, Math.min(r.x + r.w - 20, Math.max(r.x + 24, x)), r.y + r.h + 9);
  }
  g.strokeStyle = INK;
  g.lineWidth = 2.5;
  g.strokeRect(r.x, r.y, r.w, r.h);

  // reveal: everything data-ish is clipped to a sweep from the left
  g.save();
  g.beginPath();
  g.rect(r.x, r.y - 30, r.w * o.reveal + 1, r.h + 34);
  g.clip();
  // every attempt
  const n = d.series.length;
  const rad = n > 3000 ? 1.6 : n > 1200 ? 2.1 : n > 400 ? 2.6 : 3.2;
  g.fillStyle = 'rgba(42,27,61,.30)';
  g.beginPath();
  for (const [run, p] of d.series) {
    const x = xOf(r, run, maxRun), y = yOf(r, p);
    g.moveTo(x + rad, y);
    g.arc(x, y, rad, 0, Math.PI * 2);
  }
  g.fill();
  // the record staircase: an ink outline under hot pink
  const steps = recordSteps(d.records, d.lastRun);
  if (steps.length) {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    for (const [col, lw] of [[INK, 7.5], [PINK, 4]] as const) {
      g.strokeStyle = col;
      g.lineWidth = lw;
      g.beginPath();
      steps.forEach(([run, p], i) => { const x = xOf(r, run, maxRun), y = yOf(r, p); if (i) g.lineTo(x, y); else g.moveTo(x, y); });
      g.stroke();
    }
    for (const [run, p] of d.records) {
      g.beginPath();
      g.arc(xOf(r, run, maxRun), yOf(r, p), 4.6, 0, Math.PI * 2);
      g.fillStyle = BLOB;
      g.fill();
      g.lineWidth = 2.4;
      g.strokeStyle = INK;
      g.stroke();
    }
  }
  g.restore();

  // zone names on little cream tags, over the dots
  zones.forEach((z, i) => {
    const y0 = yOf(r, i + 1 < zones.length ? zones[i + 1]!.start : 1), y1 = yOf(r, z.start);
    if (y1 - y0 < 15) return;
    const label = o.phone ? `${z.index + 1}` : z.name;
    g.font = `800 ${o.phone ? 11 : 12.5}px ${o.font}`;
    const tw = g.measureText(label).width, th = o.phone ? 18 : 22;
    const lw = o.phone ? th : tw + 16;
    const lx = r.x - 8 - lw, ly = (y0 + y1) / 2 - th / 2;
    g.fillStyle = BAND[z.sky][z.index % 2]!;
    g.strokeStyle = BAND_EDGE[z.sky];
    g.lineWidth = 2;
    g.beginPath();
    g.roundRect(lx, ly, lw, th, th / 2);
    g.fill();
    g.stroke();
    g.fillStyle = INK;
    g.textBaseline = 'middle';
    g.textAlign = 'center';
    g.fillText(label, lx + lw / 2, ly + th / 2 + 0.5);
  });

  if (!d.series.length) {
    const msg = o.phone ? 'No runs yet. Go first!' : 'No runs yet. Somebody has to go first!';
    let size = o.phone ? 20 : 26;
    g.font = `400 ${size}px ${o.display}`;
    const tw = g.measureText(msg).width;
    if (tw > r.w - 24) { size = Math.max(12, Math.floor((size * (r.w - 24)) / tw)); g.font = `400 ${size}px ${o.display}`; }
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 6;
    g.lineJoin = 'round';
    g.strokeStyle = CREAM_HI;
    g.strokeText(msg, r.x + r.w / 2, r.y + r.h / 2);
    g.fillStyle = INK;
    g.fillText(msg, r.x + r.w / 2, r.y + r.h / 2);
  }

  // hovered attempt
  if (o.hover !== null && d.series[o.hover]) {
    const [run, p] = d.series[o.hover]!;
    const x = xOf(r, run, maxRun), y = yOf(r, p);
    g.strokeStyle = 'rgba(42,27,61,.45)';
    g.lineWidth = 1.5;
    g.setLineDash([4, 4]);
    g.beginPath(); g.moveTo(x, r.y); g.lineTo(x, r.y + r.h); g.stroke();
    g.setLineDash([]);
    g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2);
    g.fillStyle = CREAM_HI; g.fill();
    g.lineWidth = 3; g.strokeStyle = INK; g.stroke();
    g.beginPath(); g.arc(x, y, 3, 0, Math.PI * 2); g.fillStyle = PINK; g.fill();
  }
  return r;
}
