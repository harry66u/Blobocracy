// The private stats page (/stats?key=…): where players came from, how long they stayed,
// whether they came back, and what they shared. Server-rendered HTML, no scripts from
// anywhere else, readable on a phone.
import { addDays, etDay, type Analytics, type SourceSummary } from './analytics';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
const n = (x: number) => x.toLocaleString('en-US');
const rate = (part: number, whole: number) => (whole > 0 ? `${Math.round((part / whole) * 100)}%` : '–');

const LINKS: [string, string][] = [
  ['Show HN', 'hn'], ['r/WebGames', 'webgames'], ['r/IndieGaming', 'indiegaming'], ['r/playmygame', 'playmygame'],
  ['X / Twitter', 'x'], ['Bluesky', 'bluesky'], ['Discord servers', 'discord'], ['Friends & family', 'friends'],
];

function chart(daily: { day: string; visitors: number; played: number }[]): string {
  const W = 720, H = 200, padL = 40, padB = 26, padT = 10;
  const max = Math.max(4, ...daily.map((d) => d.visitors));
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const bw = (W - padL) / daily.length;
  const y = (v: number) => padT + (H - padT - padB) * (1 - v / top);
  const grid = [0, 0.5, 1].map((f) => {
    const v = Math.round(top * f);
    return `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}" class="grid"/><text x="${padL - 6}" y="${y(v) + 4}" class="axis" text-anchor="end">${n(v)}</text>`;
  }).join('');
  const bars = daily.map((d, i) => {
    const x = padL + i * bw + 1, w = Math.max(1, bw - 2), h = H - padB - y(d.visitors);
    const label = `${d.day}: ${n(d.visitors)} visitors, ${n(d.played)} played`;
    // hit target is the full column, larger than the mark
    return `<g class="col" tabindex="0" aria-label="${label}"><title>${label}</title><rect x="${padL + i * bw}" y="${padT}" width="${bw}" height="${H - padT - padB}" class="hit"/>`
      + (d.visitors > 0 ? `<path d="M${x},${H - padB} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${Math.max(0, w - 8)} q4,0 4,4 v${Math.max(0, h - 4)} z" class="bar"/>` : '') + '</g>';
  }).join('');
  const ticks = daily.map((d, i) => (i % Math.ceil(daily.length / 7) === 0 || i === daily.length - 1)
    ? `<text x="${padL + i * bw + bw / 2}" y="${H - 8}" class="axis" text-anchor="middle">${d.day.slice(5)}</text>` : '').join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Visitors per day (US Eastern)">${grid}${bars}${ticks}</svg>`;
}

function sourceRows(rows: SourceSummary[]): string {
  if (!rows.length) return '<tr><td colspan="10" class="empty">No visits in this range yet.</td></tr>';
  return rows.map((r) => `<tr>
    <th scope="row">${esc(r.source)}</th>
    <td>${n(r.visitors)}</td><td>${n(r.fresh)}</td>
    <td>${rate(r.played, r.visitors)}</td>
    <td>${rate(r.stay[1], r.loads)}</td><td>${rate(r.stay[2], r.loads)}</td><td>${rate(r.stay[3], r.loads)}</td>
    <td>${rate(r.nextDay, r.cohortMature)}</td><td>${rate(r.week, r.weekMature)}</td>
    <td>${n(r.shares)}</td></tr>`).join('');
}

export function renderDashboard(a: Analytics, nowMs: number, days: number, siteUrl: string, key: string, extra: { budget: Record<string, unknown>; online: number }): string {
  const to = etDay(nowMs), from = addDays(to, -(days - 1));
  const s = a.summary(from, to);
  const tot = s.sources.reduce((t, r) => ({
    visitors: t.visitors + r.visitors, fresh: t.fresh + r.fresh, played: t.played + r.played, loads: t.loads + r.loads,
    stay2: t.stay2 + r.stay[1], shares: t.shares + r.shares, next: t.next + r.nextDay, mature: t.mature + r.cohortMature,
    week: t.week + r.week, weekMature: t.weekMature + r.weekMature,
  }), { visitors: 0, fresh: 0, played: 0, loads: 0, stay2: 0, shares: 0, next: 0, mature: 0, week: 0, weekMature: 0 });
  const site = siteUrl.replace(/\/+$/, '');
  const shareKinds = Object.entries(s.shares).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<li><b>${n(v)}</b> ${esc(k.replace(':', ' via '))}</li>`).join('') || '<li>None yet.</li>';
  const range = [1, 7, 30, 90].map((d) => `<a href="?key=${encodeURIComponent(key)}&amp;days=${d}"${d === days ? ' aria-current="page"' : ''}>${d === 1 ? 'Today' : `${d} days`}</a>`).join('');
  const b = extra.budget;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Blobocracy stats</title><style>
:root{--bg:#FFF1D6;--card:#FFFBF1;--ink:#2A1B3D;--soft:rgba(42,27,61,.7);--line:rgba(42,27,61,.14);--bar:#2B7BC4;--accent:#FFD21F}
@media (prefers-color-scheme:dark){:root{--bg:#1E1430;--card:#2A1E40;--ink:#FFF1D6;--soft:rgba(255,241,214,.72);--line:rgba(255,241,214,.16);--bar:#7CC3FF}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.45 'Atkinson Hyperlegible Next',system-ui,sans-serif;padding:16px}
main{max-width:980px;margin:0 auto}h1{font:400 30px 'Bagel Fat One',system-ui;margin:4px 0 2px}h2{font-size:18px;margin:28px 0 10px}
.sub{color:var(--soft);margin:0 0 14px}nav{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px}
nav a{color:var(--ink);text-decoration:none;border:2px solid var(--line);border-radius:999px;padding:4px 12px;font-weight:700}nav a[aria-current]{background:var(--ink);color:var(--bg);border-color:var(--ink)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}
.tile{background:var(--card);border:2px solid var(--line);border-radius:16px;padding:12px 14px}.tile b{display:block;font:400 30px 'Bagel Fat One',system-ui}.tile span{color:var(--soft);font-size:14px}
.card{background:var(--card);border:2px solid var(--line);border-radius:16px;padding:14px;overflow-x:auto}
svg{width:100%;height:auto;display:block}.grid{stroke:var(--line);stroke-width:1}.axis{fill:var(--soft);font-size:11px}.bar{fill:var(--bar)}.hit{fill:transparent}.col:hover .bar,.col:focus .bar{opacity:.75}.col:focus{outline:none}
table{border-collapse:collapse;width:100%;font-size:14px;min-width:720px}th,td{padding:7px 8px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap}
th:first-child,td:first-child{text-align:left}thead th{color:var(--soft);font-weight:700;vertical-align:bottom;white-space:normal}.empty{text-align:center;color:var(--soft)}
code{background:var(--bg);border-radius:6px;padding:2px 6px;font-size:13px}ul{padding-left:20px}.links td{text-align:left}.foot{color:var(--soft);font-size:13px;margin-top:28px}
</style></head><body><main>
<h1>Blobocracy stats</h1>
<p class="sub">${esc(from)} to ${esc(to)} (US Eastern days) · ${n(extra.online)} playing right now</p>
<nav aria-label="Date range">${range}</nav>
<section class="tiles" aria-label="Headline numbers">
<div class="tile"><b>${n(tot.visitors)}</b><span>visitors</span></div>
<div class="tile"><b>${rate(tot.played, tot.visitors)}</b><span>pressed a button</span></div>
<div class="tile"><b>${rate(tot.stay2, tot.loads)}</b><span>stayed 2+ minutes</span></div>
<div class="tile"><b>${rate(tot.next, tot.mature)}</b><span>new visitors back next day</span></div>
<div class="tile"><b>${rate(tot.week, tot.weekMature)}</b><span>back within a week</span></div>
<div class="tile"><b>${n(tot.shares)}</b><span>shares</span></div>
</section>
<h2>Visitors per day</h2><div class="card">${chart(s.daily)}</div>
<h2>Where players came from</h2>
<div class="card"><table><thead><tr><th scope="col">Source</th><th scope="col">Visitors</th><th scope="col">New</th><th scope="col">Played</th>
<th scope="col">Stayed 2 min</th><th scope="col">5 min</th><th scope="col">15 min</th><th scope="col">Back next day</th><th scope="col">Back within 7 days</th><th scope="col">Shares</th></tr></thead>
<tbody>${sourceRows(s.sources)}</tbody></table></div>
<p class="sub">"Back" is credited to the source of a visitor's first visit, counted for first-visit days old enough to have had the chance (1 day, 7 days). "Played" and "stayed" are per visit.</p>
<h2>Shares by format</h2><div class="card"><ul>${shareKinds}</ul></div>
<h2>Tracking links</h2>
<div class="card"><table class="links"><tbody>${LINKS.map(([name, tag]) => `<tr><th scope="row">${esc(name)}</th><td><code>${esc(site)}/?via=${tag}</code></td></tr>`).join('')}
<tr><th scope="row">Anything else</th><td><code>${esc(site)}/?via=your-tag</code> (lowercase letters, numbers, dashes; up to 32)</td></tr></tbody></table>
<p class="sub">The tag is removed from the address bar on arrival, so people who copy the link don't pass your tag on. Visitors from HN, Reddit, X and others are recognized from the referrer even without a tag.</p></div>
<h2>Spend estimate</h2><div class="card"><p>$${esc(String(b.spentUsd))} of $${esc(String(b.monthlyUsd))} this month (${esc(String(b.month))}): machines $${esc(String(b.machineUsd))}, bandwidth $${esc(String(b.egressUsd))} (${esc(String(b.egressGb))} GB). Mode: ${esc(String(b.mode))}. Game is: <b>${esc(String(b.level))}</b>.</p></div>
<p class="foot">Privacy: no cookies, no IP addresses, no user agents and no per-person records are stored; only the daily counters above. Browsers with Do Not Track or Global Privacy Control send nothing.</p>
</main></body></html>`;
}
