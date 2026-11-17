// /runs: the live death counter, the chart of every attempt ("the internet getting better"),
// how far runs get per zone, and the paginated list of runs with what killed each one.
import './fonts.css';
import './pages/pages.css';
import { drawChart, nearestIndex, runAt, type ChartData, type ChartZone, type Point, type Rect } from './pages/chart.ts';
import { getJson, mountFlip, reducedMotion, watchCounter, type Counter } from './pages/common.ts';
import { duration, fmt, killerName, pageList, pct, relTime } from './pages/format.ts';
import { blobSvg, hazardIcon } from './pages/icons.ts';

interface Summary extends Counter {
  levelId: number; track?: number; current?: boolean; encore?: boolean; levelName: string; attempts: number; zones: ChartZone[]; zoneReach: number[];
  series: Point[]; records: Point[]; bucket: number; firstAt: number | null; lastAt: number | null;
}
interface RunJson { run: number; version: number; startedAt: number; endedAt: number; durationMs: number; progress: number; zone: number; cause: string; peakPlayers: number; clipId: string | null }
interface RunPage { page: number; pages: number; pageSize: number; total: number; best: boolean; record: Counter['record']; runs: RunJson[] }

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
interface LevelItem { track: number; levelId: number; name: string; encore: boolean; beaten: boolean; current: boolean }

/** Which level's runs are shown: ?level=<track>, else the one being played. */
let track: number | null = (() => { const v = Number(new URLSearchParams(location.search).get('level')); return Number.isInteger(v) && v > 0 ? v : null; })();
let viewingCurrent = true;
const levelQuery = () => (track === null ? '' : `level=${track}`);
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const reduced = reducedMotion();
const FONT = "'Atkinson Hyperlegible Next', system-ui, sans-serif";
const DISPLAY = "'Bagel Fat One', system-ui, sans-serif";

$('hero-blob').outerHTML = blobSvg('bob', 'calm');

// ---- header: live counters ---------------------------------------------------------------
const flip = mountFlip($('deaths'), (n) => `${fmt(n)} deaths`);
let firstCounter = true;
let lastDeaths = -1;
let zones: ChartZone[] = [];
function showCounter(c: Counter): void {
  if (!viewingCurrent && !firstCounter) return; // a past level's numbers don't change
  flip.set(c.deaths, !firstCounter && !reduced && c.deaths > lastDeaths);
  firstCounter = false;
  lastDeaths = c.deaths;
  $('online').textContent = fmt(c.online);
  $('record').textContent = c.record ? pct(c.record.progress) : '0%';
  $('record-run').textContent = c.record ? `run ${fmt(c.record.run)}` : '';
}

// ---- the chart -----------------------------------------------------------------------------
const canvas = $<HTMLCanvasElement>('chart-canvas');
const tip = $('tip');
let chart: ChartData | null = null;
let rect: Rect | null = null;
let hover: number | null = null;
let reveal = reduced ? 1 : 0;
let revealT0 = 0;
const phone = () => innerWidth <= 720;

function paint(): void {
  if (!chart) return;
  const box = canvas.getBoundingClientRect();
  const dpr = Math.min(2, devicePixelRatio || 1);
  const w = Math.round(box.width * dpr), h = Math.round(box.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  const g = canvas.getContext('2d')!;
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  rect = drawChart(g, box.width, box.height, chart, { phone: phone(), reveal, hover, font: FONT, display: DISPLAY });
}

function animateIn(): void {
  if (reduced) { reveal = 1; paint(); return; }
  revealT0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - revealT0) / 1100);
    reveal = 1 - Math.pow(1 - k, 3);
    paint();
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function pointerAt(clientX: number): void {
  if (!chart || !rect || !chart.series.length) return;
  const box = canvas.getBoundingClientRect();
  const x = clientX - box.left;
  if (x < rect.x - 10 || x > rect.x + rect.w + 10) { clearHover(); return; }
  const i = nearestIndex(chart.series, runAt(rect, x, Math.max(2, chart.lastRun)));
  if (i === hover) return;
  hover = i;
  paint();
  const [run, p] = chart.series[i]!;
  const zone = [...zones].reverse().find((z) => p >= z.start);
  const best = chart.bucket > 1 ? `best of runs ${fmt(run - ((run - 1) % chart.bucket))}–${fmt(run - ((run - 1) % chart.bucket) + chart.bucket - 1)}` : `run ${fmt(run)}`;
  tip.innerHTML = `<b>${pct(p)}</b> · ${esc(best)}<br>${zone ? `Zone ${zone.index + 1}: ${esc(zone.name)}` : ''}`;
  const px = rect.x + (Math.max(2, chart.lastRun) <= 1 ? 0 : ((run - 1) / (Math.max(2, chart.lastRun) - 1)) * rect.w);
  const py = rect.y + (1 - p) * rect.h;
  tip.style.left = `${Math.min(box.width - 90, Math.max(90, px))}px`;
  tip.style.top = `${py}px`;
  tip.classList.add('show');
}
function clearHover(): void {
  if (hover === null) return;
  hover = null;
  tip.classList.remove('show');
  paint();
}
canvas.addEventListener('pointermove', (e) => pointerAt(e.clientX));
canvas.addEventListener('pointerdown', (e) => pointerAt(e.clientX));
canvas.addEventListener('pointerleave', clearHover);
new ResizeObserver(() => paint()).observe(canvas);

function chartLabel(s: Summary): string {
  if (!s.attempts) return 'No runs yet.';
  const first = s.series.slice(0, Math.max(1, Math.floor(s.series.length / 10)));
  const last = s.series.slice(-Math.max(1, Math.floor(s.series.length / 10)));
  const avg = (a: Point[]) => a.reduce((t, p) => t + p[1], 0) / a.length;
  return `Chart of ${fmt(s.attempts)} attempts. Early runs got ${pct(avg(first))} of the way on average; recent runs get ${pct(avg(last))}. `
    + `The record went up ${s.records.length} times, to ${s.record ? pct(s.record.progress) : '0%'}.`;
}

function showZones(s: Summary): void {
  const total = Math.max(1, s.attempts);
  $('zones').innerHTML = s.zones.map((z, i) => {
    const n = s.zoneReach[i] ?? 0;
    return `<div class="zone"><div class="sky ${z.sky}" aria-hidden="true">${i + 1}</div><div class="body">
      <div class="name">${esc(z.name)}</div>
      <div class="n">${fmt(n)}<small>${n === 1 ? 'run' : 'runs'}</small></div>
      <div class="meter" role="img" aria-label="${pct(n / total)} of runs reached zone ${i + 1}, ${esc(z.name)}"><i ${n ? '' : 'class="none" '}style="width:${(100 * n) / total}%"></i></div>
    </div></div>`;
  }).join('');
}

// ---- the list ------------------------------------------------------------------------------
const list = $('runs');
const head = list.querySelector('.head')!.outerHTML;
let best = new URLSearchParams(location.search).get('best') === '1';
let page = Math.max(1, Number(new URLSearchParams(location.search).get('page')) || 1);
let recordProgress = 0;

const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';

function bar(p: number, label: string): string {
  const ticks = zones.filter((z) => z.start > 0).map((z) => `<i class="tick" style="left:${z.start * 100}%"></i>`).join('');
  const flag = recordProgress > 0 ? `<i class="flag" style="left:${recordProgress * 100}%"></i>` : '';
  return `<span class="bar"><span class="track" role="img" aria-label="${label}"><i class="fill" style="width:${Math.max(0.5, p * 100)}%"></i>${ticks}${flag}</span><b>${pct(p)}</b></span>`;
}

function row(r: RunJson, now: number, recordRun: number | null): string {
  const isRecord = recordRun === r.run;
  const badge = r.cause === 'win' ? '<span class="badge">Winner!</span>'
    : isRecord ? '<span class="badge">Record</span>'
      : recordProgress >= 0.1 && r.progress >= recordProgress - 0.05 ? '<span class="badge close">So close</span>' : '';
  const killer = killerName(r.cause);
  const when = relTime(r.endedAt, now);
  const zone = zones[r.zone];
  const watch = r.clipId
    ? `<a class="btn yellow" href="/c/${encodeURIComponent(r.clipId)}" aria-label="Watch run ${fmt(r.run)}">${PLAY}Watch</a>`
    : '';
  return `<li>
    <span class="no">Run ${fmt(r.run)} ${badge}<span class="when-m">${esc(when)}</span></span>
    ${bar(r.progress, `${pct(r.progress)} of the way${zone ? `, zone ${zone.index + 1}: ${esc(zone.name)}` : ''}`)}
    <span class="killer">${hazardIcon(r.cause, '')}<span>${r.cause === 'win' ? 'Made it!' : esc(killer)}</span></span>
    <span class="dur"><span class="lbl">lasted </span>${duration(r.durationMs)}</span>
    <span class="when">${esc(when)}</span>
    <span class="watch">${watch}</span>
  </li>`;
}

async function loadPage(push = false): Promise<void> {
  list.classList.add('loading');
  try {
    const data = await getJson<RunPage>(`/api/runs?page=${page}${best ? '&best=1' : ''}${track === null ? '' : `&${levelQuery()}`}`);
    page = data.page;
    recordProgress = data.record?.progress ?? recordProgress;
    const now = Date.now();
    list.innerHTML = head + (data.runs.length
      ? data.runs.map((r) => row(r, now, data.record?.run ?? null)).join('')
      : '<li class="empty">No runs yet. Somebody has to go first.</li>');
    $('list-sub').textContent = best
      ? `The ${fmt(data.total)} runs, furthest first.`
      : `${fmt(data.total)} runs, newest first.`;
    pager(data);
    if (push) {
      const q = new URLSearchParams({ ...(track !== null && !viewingCurrent ? { level: String(track) } : {}), ...(best ? { best: '1' } : {}), ...(page > 1 ? { page: String(page) } : {}) });
      history.replaceState(null, '', `/runs${[...q].length ? `?${q}` : ''}`);
    }
    notice('');
  } catch {
    notice('The history book is catching its breath. The runs will be back in a moment.');
  } finally {
    list.classList.remove('loading');
  }
}

function pager(d: RunPage): void {
  const el = $('pager');
  if (d.pages <= 1) { el.innerHTML = ''; return; }
  const nums = pageList(d.page, d.pages, phone() ? 1 : 2).map((p) => (p === null
    ? '<span class="gap" aria-hidden="true">…</span>'
    : `<button type="button" class="num" data-p="${p}" ${p === d.page ? 'aria-current="page"' : ''} aria-label="Page ${p}">${p}</button>`)).join('');
  el.innerHTML = `<button type="button" class="btn small" data-p="${d.page - 1}" ${d.page <= 1 ? 'aria-disabled="true" tabindex="-1"' : ''}>‹ ${best ? 'Better' : 'Newer'}</button>
    ${nums}
    <button type="button" class="btn small" data-p="${d.page + 1}" ${d.page >= d.pages ? 'aria-disabled="true" tabindex="-1"' : ''}>${best ? 'Worse' : 'Older'} ›</button>`;
}
$('pager').addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest<HTMLElement>('[data-p]');
  if (!b || b.getAttribute('aria-disabled') === 'true') return;
  page = Number(b.dataset.p);
  void loadPage(true).then(() => $('list-title').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' }));
});
function setFilter(b: boolean): void {
  if (best === b) return;
  best = b;
  page = 1;
  $('f-latest').setAttribute('aria-pressed', String(!b));
  $('f-best').setAttribute('aria-pressed', String(b));
  void loadPage(true);
}
$('f-latest').addEventListener('click', () => setFilter(false));
$('f-best').addEventListener('click', () => setFilter(true));
$('f-latest').setAttribute('aria-pressed', String(!best));
$('f-best').setAttribute('aria-pressed', String(best));

function notice(text: string): void {
  const n = $('notice');
  n.textContent = text;
  n.classList.toggle('show', !!text);
}

// ---- which level ---------------------------------------------------------------------------
/** A pill per level once there is more than one (default: the level being played). */
async function mountLevels(): Promise<void> {
  try {
    const l = await getJson<{ current: number; levels: LevelItem[] }>('/api/levels');
    if (l.levels.length < 2) return;
    const nav = document.createElement('div');
    nav.className = 'seg levels';
    nav.setAttribute('role', 'group');
    nav.setAttribute('aria-label', 'Which level');
    const label = (x: LevelItem) => (x.encore ? `Level ${x.levelId} encore` : `Level ${x.levelId}`);
    nav.innerHTML = l.levels.map((x) => `<button type="button" data-track="${x.track}" aria-pressed="${(track ?? l.current) === x.track}" title="${esc(x.name)}${x.beaten ? ' (beaten)' : ''}">${esc(label(x))}${x.beaten ? ' <span aria-hidden="true">★</span>' : ''}${x.current ? ' <i class="live" aria-hidden="true"></i>' : ''}</button>`).join('');
    $('level-name').insertAdjacentElement('beforebegin', nav);
    nav.addEventListener('click', (e) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('[data-track]');
      if (!b) return;
      const t = Number(b.dataset.track);
      if (t === (track ?? l.current)) return;
      track = t;
      for (const x of nav.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
      page = 1;
      void loadSummary().then(() => loadPage(true));
    });
  } catch { /* one level: no picker */ }
}

async function loadSummary(): Promise<void> {
  const s = await getJson<Summary>(`/api/summary${track === null ? '' : `?${levelQuery()}`}`);
  viewingCurrent = s.current !== false;
  zones = s.zones;
  recordProgress = s.record?.progress ?? 0;
  $('level-name').textContent = `${s.levelName} · ${viewingCurrent ? 'every attempt so far' : s.encore ? 'the encore' : 'every attempt it took'}`;
  const words = document.querySelector('.h-words');
  if (words) words.textContent = viewingCurrent ? 'deaths so far' : 'deaths it took';
  $('attempts').textContent = fmt(s.attempts);
  firstCounter = true;
  showCounter(s);
  showZones(s);
  chart = { series: s.series, records: s.records, zones: s.zones, lastRun: Math.max(s.attempts, s.series.at(-1)?.[0] ?? 1), bucket: s.bucket };
  canvas.setAttribute('aria-label', chartLabel(s));
  animateIn();
}

// ---- go ------------------------------------------------------------------------------------
async function boot(): Promise<void> {
  void mountLevels();
  try {
    await document.fonts?.ready;
    await loadSummary();
  } catch {
    notice('The history book is catching its breath. The chart will be back in a moment.');
  }
  await loadPage();
  watchCounter((c) => showCounter(c));
}
void boot();
