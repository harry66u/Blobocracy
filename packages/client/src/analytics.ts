// Privacy-friendly analytics: no cookies, no identifiers, nothing per person ever leaves the
// browser. The page sends a handful of anonymous counter bumps ("a visit from hn", "someone
// played 2 minutes", "someone came back the next day") and the server only adds them up.
//
// Where from: the ?via= tag of a tracking link, else the referring site's name.
// How long: once-per-visit milestones of visible time (30 s, 2 min, 5 min, 15 min).
// Came back: this browser remembers its first day and first source locally; once a day it
// reports "a visitor from <first source>, first seen <day>, is here today".
import { dayKey } from './stats.ts';

export const STAY_MILESTONES_S = [30, 120, 300, 900] as const;

/** Tags allowed on the wire: lowercase, short, no personal data possible. */
export function cleanTag(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
}

const KNOWN: [RegExp, string][] = [
  [/(^|\.)news\.ycombinator\.com$/, 'hn'],
  [/(^|\.)reddit\.com$/, 'reddit'],
  [/^(t\.co|x\.com|twitter\.com|mobile\.twitter\.com)$/, 'x'],
  [/(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/, 'discord'],
  [/(^|\.)(facebook\.com|fb\.com|l\.facebook\.com|m\.facebook\.com)$/, 'facebook'],
  [/(^|\.)instagram\.com$/, 'instagram'],
  [/(^|\.)(threads\.net|threads\.com)$/, 'threads'],
  [/(^|\.)bsky\.app$/, 'bluesky'],
  [/(^|\.)linkedin\.com$|^lnkd\.in$/, 'linkedin'],
  [/(^|\.)lobste\.rs$/, 'lobsters'],
  [/(^|\.)itch\.io$/, 'itch'],
  [/(^|\.)(youtube\.com|youtu\.be)$/, 'youtube'],
  [/(^|\.)tiktok\.com$/, 'tiktok'],
  [/(^|\.)google\.[a-z.]+$/, 'google'],
  [/(^|\.)bing\.com$/, 'bing'],
  [/(^|\.)duckduckgo\.com$/, 'duckduckgo'],
];

/** Where this visit came from: the ?via= tag, else the referring site, else "direct". */
export function sourceOf(href: string, referrer: string): string {
  const url = new URL(href);
  const via = url.searchParams.get('via') ?? url.searchParams.get('ref') ?? url.searchParams.get('utm_source');
  if (via && cleanTag(via)) return cleanTag(via);
  if (!referrer) return 'direct';
  let host: string;
  try { host = new URL(referrer).hostname.toLowerCase(); } catch { return 'direct'; }
  if (host === url.hostname) return 'direct';
  for (const [re, name] of KNOWN) if (re.test(host)) return name;
  return cleanTag(host.replace(/^www\./, '')) || 'direct';
}

/** The address without tracking tags, so a copied link doesn't carry someone else's tag. */
export function stripTags(href: string): string | null {
  const url = new URL(href);
  let changed = false;
  for (const k of ['via', 'ref', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    if (url.searchParams.has(k)) { url.searchParams.delete(k); changed = true; }
  }
  return changed ? url.pathname + (url.search === '?' ? '' : url.search) + url.hash : null;
}

interface VisitMemory { first: string; firstSrc: string; lastDay: string; returned: boolean }
const KEY = 'blobocracy.visit.v1';

export type Beacon =
  | { e: 'visit'; src: string; isNew: boolean; daily: boolean; cohort: string; firstSrc: string; daysSince: number; firstReturn: boolean }
  | { e: 'stay'; src: string; s: number }
  | { e: 'play'; src: string }
  | { e: 'share'; src: string; kind: string; how: string };

const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86_400_000);

/** Pure: what to report for this page load, and what to remember. */
export function visitBeacon(mem: VisitMemory | null, today: string, src: string): { beacon: Beacon; mem: VisitMemory } {
  const isNew = mem === null;
  const m: VisitMemory = mem ?? { first: today, firstSrc: src, lastDay: '', returned: false };
  const daily = m.lastDay !== today;
  const daysSince = Math.max(0, daysBetween(m.first, today));
  const firstReturn = daily && !isNew && daysSince > 0 && !m.returned;
  return {
    beacon: { e: 'visit', src, isNew, daily, cohort: m.first, firstSrc: m.firstSrc, daysSince, firstReturn },
    mem: { ...m, lastDay: today, returned: m.returned || firstReturn },
  };
}

function parseMem(raw: string | null): VisitMemory | null {
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as VisitMemory;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(m.first) || typeof m.firstSrc !== 'string') return null;
    return { first: m.first, firstSrc: cleanTag(m.firstSrc) || 'direct', lastDay: String(m.lastDay ?? ''), returned: !!m.returned };
  } catch { return null; }
}

export interface Analytics {
  played(): void;
  share(kind: string, how: string): void;
  readonly source: string;
}

/** Starts analytics for this page. Respects Do Not Track / Global Privacy Control by sending nothing. */
export function startAnalytics(endpoint = '/a'): Analytics {
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean };
  const optOut = nav.doNotTrack === '1' || nav.globalPrivacyControl === true;
  const src = sourceOf(location.href, document.referrer);
  const stripped = stripTags(location.href);
  if (stripped !== null) history.replaceState(history.state, '', stripped);

  const send = (b: Beacon) => {
    if (optOut) return;
    const body = JSON.stringify(b);
    try {
      if (navigator.sendBeacon?.(endpoint, new Blob([body], { type: 'text/plain' }))) return;
    } catch { /* fall through */ }
    fetch(endpoint, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  };

  let mem: VisitMemory | null = null;
  try { mem = parseMem(localStorage.getItem(KEY)); } catch { /* blocked storage: counted as new */ }
  const v = visitBeacon(mem, dayKey(new Date()), src);
  try { localStorage.setItem(KEY, JSON.stringify(v.mem)); } catch { /* ignore */ }
  send(v.beacon);

  // Visible time only: a tab left in the background is not "staying".
  let visibleS = 0, last = performance.now(), next = 0;
  setInterval(() => {
    const now = performance.now();
    if (!document.hidden) visibleS += Math.min(10, (now - last) / 1000);
    last = now;
    while (next < STAY_MILESTONES_S.length && visibleS >= STAY_MILESTONES_S[next]!) send({ e: 'stay', src, s: STAY_MILESTONES_S[next++]! });
  }, 5000);

  let didPlay = false;
  return {
    source: src,
    played() { if (!didPlay) { didPlay = true; send({ e: 'play', src }); } },
    share(kind, how) { send({ e: 'share', src, kind, how }); },
  };
}
