// /hall: one big celebratory card per beaten level (date, deaths it took, peak players, the
// winning clip), or a friendly empty state while the current level still stands.
import './fonts.css';
import './pages/pages.css';
import { getJson, mountFlip, watchCounter } from './pages/common.ts';
import { fmt, longDate, pct } from './pages/format.ts';
import { blobSvg } from './pages/icons.ts';

interface Entry { levelId: number; levelName: string; beatenAt: number; deathCount: number; peakPlayers: number; run: number; clipId: string | null }
interface Hall { entries: Entry[]; current: { levelId: number; name: string; deaths: number; record: { progress: number; run: number } | null } }

const $ = (id: string) => document.getElementById(id)!;
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
const PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5v15l12-7.5z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>';
const MEDAL = `<svg class="medal" viewBox="0 0 120 140" aria-hidden="true" fill="none" stroke="#2A1B3D" stroke-width="5" stroke-linejoin="round">
  <path d="M34 4h22l14 44H48zM86 4H64L50 48h22z" fill="#FF3B7A"/><path d="M45 4l13 44M75 4L62 48" stroke="#D61F5C" stroke-width="3"/>
  <circle cx="60" cy="88" r="40" fill="#FFD21F"/><circle cx="60" cy="88" r="29" fill="#FFE97A" stroke-width="3.5"/>
  <path d="M60 68l6 12.5 13.5 2-9.8 9.5 2.3 13.5L60 99.2l-12 6.3 2.3-13.5-9.8-9.5 13.5-2z" fill="#FFFBF1" stroke-width="3.5"/></svg>`;
const LOCK = `<svg class="lock" viewBox="0 0 46 46" aria-hidden="true" fill="none" stroke="#2A1B3D" stroke-width="3.5" stroke-linejoin="round"><path d="M14 20v-6a9 9 0 0 1 18 0v6" /><rect x="8" y="20" width="30" height="22" rx="6" fill="#FFD21F"/><circle cx="23" cy="30" r="3" fill="#2A1B3D"/><path d="M23 32v4" stroke-linecap="round"/></svg>`;

/** Confetti pieces for a winner's banner, the same every time for a level. */
function confetti(seed: number): string {
  let s = seed * 9301 + 49297;
  const r = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const colors = ['#FF3B7A', '#FFFFFF', '#5FBFFF', '#3DDC84', '#8A4DB3'];
  let out = '';
  for (let i = 0, n = 0; n < 34 && i < 400; i++) {
    const w = 6 + r() * 8, h = r() < 0.4 ? w : 4 + r() * 4;
    const x = r() * 100, y = r() * 100;
    if (x < 66 && y > 14 && y < 88) continue; // keep the words clear
    n++;
    out += `<i style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;width:${w.toFixed(0)}px;height:${h.toFixed(0)}px;background:${colors[i % colors.length]};transform:rotate(${(r() * 180).toFixed(0)}deg);border-radius:${h === w ? '50%' : '2px'}"></i>`;
  }
  return `<div class="confetti" aria-hidden="true">${out}</div>`;
}

function winnerCard(e: Entry): string {
  const watch = e.clipId
    ? `<a class="btn big pink" href="/c/${encodeURIComponent(e.clipId)}">${PLAY}Watch the winning run</a>`
    : '<span class="sub">The winning clip is still being polished.</span>';
  return `<article class="panel winner" aria-labelledby="lv-${e.levelId}">
    <div class="banner">
      ${confetti(e.levelId)}
      ${MEDAL}
      <div class="level">Level ${e.levelId} · beaten</div>
      <h2 id="lv-${e.levelId}">${esc(e.levelName)} has fallen!</h2>
      <div class="date">${longDate(e.beatenAt)}</div>
    </div>
    <div class="stats">
      <div class="stat"><b>${fmt(e.deathCount)}</b><span>deaths it took</span></div>
      <div class="stat"><b>${fmt(e.peakPlayers)}</b><span>people steering at the finish</span></div>
      <div class="stat"><b>Run ${fmt(e.run)}</b><span>the one that made it</span></div>
    </div>
    <div class="foot"><p>Every single one of those deaths sent the whole internet back to the start. Then, one day, it didn't.</p>${watch}</div>
  </article>`;
}

function emptyCard(h: Hall): string {
  const c = h.current;
  const rec = c.record;
  return `<article class="panel waiting" aria-labelledby="wait-title">
    <span class="sticker">Still standing</span>
    <div class="pedestal" aria-hidden="true">
      <svg class="ghost" viewBox="0 0 96 96" fill="none" stroke="#2A1B3D" stroke-width="4" stroke-linejoin="round" stroke-linecap="round" stroke-dasharray="7 7" opacity=".55">
        <path d="M28 14h40v18a20 20 0 0 1-40 0z"/><path d="M28 19H15q0 17 15 18M68 19h13q0 17-15 18"/><path d="M48 52v14"/><path d="M33 84h30l-4-14H37z"/>
      </svg>
      <div class="column"></div>
      ${blobSvg('bob', 'worried')}
    </div>
    <div>
      <h2 id="wait-title">Nobody has beaten ${esc(c.name)} yet.</h2>
      <p class="tries"><span id="tries" class="flip"></span><span class="tries-words">tries and counting.</span></p>
      ${rec ? `<div class="best">
        <div class="lbl2"><span>Best so far: <b>run ${fmt(rec.run)}</b></span><b>${pct(rec.progress)}</b></div>
        <span class="bar"><span class="track" role="img" aria-label="The record: ${pct(rec.progress)} of the way"><i class="fill" style="width:${rec.progress * 100}%"></i></span></span>
      </div>` : ''}
      <div class="cta"><a class="btn big pink" href="/">Go help it</a><a class="btn big" href="/runs">See every run</a></div>
    </div>
  </article>
  <section class="panel next" aria-label="What comes next">${LOCK}<p><b>Level 2 is waiting behind it.</b>It unlocks for everyone the moment ${esc(c.name)} falls.</p></section>`;
}

async function boot(): Promise<void> {
  try {
    const h = await getJson<Hall>('/api/hall');
    $('entries').innerHTML = (h.entries.map(winnerCard).join('')) + (h.entries.some((e) => e.levelId === h.current.levelId) ? '' : emptyCard(h));
    const triesEl = document.getElementById('tries');
    if (triesEl) {
      const flip = mountFlip(triesEl, (n) => `${fmt(n)}`);
      flip.set(h.current.deaths, false);
      let last = h.current.deaths;
      watchCounter((c) => { flip.set(c.deaths, c.deaths > last); last = c.deaths; });
    }
  } catch {
    const n = $('notice');
    n.textContent = 'The hall of fame is catching its breath. Try again in a moment.';
    n.classList.add('show');
  }
}
void boot();
