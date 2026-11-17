// Anonymous personal stats, kept only in this browser's localStorage and never sent anywhere.
// "Deaths you were part of" counts runs where you pressed something before the blob died.

export interface BestRun { run: number; progress: number; death: number }

export interface PersonalStats {
  v: 1;
  /** Local calendar day (YYYY-MM-DD) of the first visit, and of the most recent day played. */
  firstDay: string;
  lastPlayedDay: string;
  /** Distinct local days on which you pressed something. */
  days: number;
  /** Deaths of runs you took part in. */
  deaths: number;
  /** The furthest run you took part in. */
  best: BestRun | null;
}

const KEY = 'blobocracy.stats.v1';

/** Local calendar day as YYYY-MM-DD. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function freshStats(today: string): PersonalStats {
  return { v: 1, firstDay: today, lastPlayedDay: '', days: 0, deaths: 0, best: null };
}

const isDay = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s);
const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0 && n < 1e9;

/** Parses stored stats; anything malformed or from another version starts fresh. */
export function parseStats(raw: string | null, today: string): PersonalStats {
  if (!raw) return freshStats(today);
  try {
    const s = JSON.parse(raw) as Partial<PersonalStats>;
    if (s.v !== 1 || !isDay(s.firstDay) || !isCount(s.days) || !isCount(s.deaths)) return freshStats(today);
    const b = s.best;
    const best = b && isCount(b.run) && isCount(b.death) && typeof b.progress === 'number' && b.progress >= 0 && b.progress <= 1
      ? { run: b.run, progress: b.progress, death: b.death } : null;
    return { v: 1, firstDay: s.firstDay, lastPlayedDay: isDay(s.lastPlayedDay) ? s.lastPlayedDay : '', days: s.days, deaths: s.deaths, best };
  } catch {
    return freshStats(today);
  }
}

/** You pressed something today: counts the day once. */
export function notePlayed(s: PersonalStats, today: string): PersonalStats {
  if (s.lastPlayedDay === today) return s;
  return { ...s, lastPlayedDay: today, days: s.days + 1 };
}

/** A run you took part in died. */
export function noteDeath(s: PersonalStats, d: { run: number; progress: number; deaths: number }): PersonalStats {
  const better = !s.best || d.progress > s.best.progress;
  return {
    ...s,
    deaths: s.deaths + 1,
    best: better ? { run: d.run, progress: d.progress, death: d.deaths } : s.best,
  };
}

/** Thin localStorage wrapper; private mode or blocked storage just means stats last for the visit. */
export class StatsStore {
  stats: PersonalStats;
  constructor(private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | null, now = new Date()) {
    let raw: string | null = null;
    try { raw = storage?.getItem(KEY) ?? null; } catch { /* blocked */ }
    this.stats = parseStats(raw, dayKey(now));
    this.save();
  }
  update(f: (s: PersonalStats) => PersonalStats): void {
    const next = f(this.stats);
    if (next === this.stats) return;
    this.stats = next;
    this.save();
  }
  private save(): void {
    try { this.storage?.setItem(KEY, JSON.stringify(this.stats)); } catch { /* full or blocked */ }
  }
}
