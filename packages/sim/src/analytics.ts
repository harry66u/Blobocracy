// Aggregate-only analytics. Beacons from the page are validated, added to per-day counters
// and thrown away. Nothing per person is stored: no IP, no user agent, no cookie, no id.
// Days are US Eastern calendar days (the maker's time zone).

export const STAY_S = [30, 120, 300, 900] as const;
const MAX_SOURCES_PER_DAY = 100;
const KEEP_DAYS = 400;

export interface SourceDay {
  /** Page loads. */
  loads: number;
  /** Distinct browsers that day (first load of the day). */
  visitors: number;
  /** First-ever visits. */
  fresh: number;
  /** Visits where the player pressed something. */
  played: number;
  /** Visits that stayed (visible) at least 30 s / 2 min / 5 min / 15 min. */
  stay: [number, number, number, number];
  shares: number;
}

export interface Cohort {
  /** Browsers first seen that day from this source. */
  size: number;
  /** Of them: back the next calendar day; back at least once within 7 days. */
  nextDay: number;
  week: number;
}

export interface AnalyticsData {
  v: 1;
  /** day → source → counters */
  days: Record<string, Record<string, SourceDay>>;
  /** cohort day → first source → retention counters */
  cohorts: Record<string, Record<string, Cohort>>;
  /** day → "kind:how" → count */
  shares: Record<string, Record<string, number>>;
}

const blankDay = (): SourceDay => ({ loads: 0, visitors: 0, fresh: 0, played: 0, stay: [0, 0, 0, 0], shares: 0 });
const blankCohort = (): Cohort => ({ size: 0, nextDay: 0, week: 0 });

const TAG = /^[a-z0-9._-]{1,32}$/;
/** A source tag that is also safe as an object key ("__proto__" would rewrite the prototype). */
const isTag = (s: unknown): s is string => typeof s === 'string' && TAG.test(s) && s !== '__proto__';
const own = (o: object, k: string) => Object.hasOwn(o, k);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const KINDS = new Set(['image', 'clip', 'text']);
const HOWS = new Set(['sheet', 'download', 'copy']);

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
/** US Eastern calendar day for a timestamp, YYYY-MM-DD. */
export const etDay = (ms: number) => ET.format(new Date(ms));

export function addDays(day: string, n: number): string {
  const d = new Date(day + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export class Analytics {
  data: AnalyticsData;
  dirty = false;

  constructor(data?: unknown) {
    this.data = isData(data) ? data : { v: 1, days: {}, cohorts: {}, shares: {} };
  }

  // Lookups use own properties only: a tag like "constructor" must never resolve to Object.prototype's.
  private src(day: string, src: string): SourceDay {
    const d = own(this.data.days, day) ? this.data.days[day]! : (this.data.days[day] = {});
    if (!own(d, src) && Object.keys(d).length >= MAX_SOURCES_PER_DAY) src = 'other';
    if (!own(d, src)) d[src] = blankDay();
    return d[src]!;
  }

  private cohort(day: string, src: string): Cohort {
    const c = own(this.data.cohorts, day) ? this.data.cohorts[day]! : (this.data.cohorts[day] = {});
    if (!own(c, src) && Object.keys(c).length >= MAX_SOURCES_PER_DAY) src = 'other';
    if (!own(c, src)) c[src] = blankCohort();
    return c[src]!;
  }

  /** Adds one beacon. Returns false (and changes nothing) for anything malformed. */
  ingest(raw: string, nowMs: number): boolean {
    if (raw.length > 600) return false;
    let b: Record<string, unknown>;
    try { b = JSON.parse(raw); } catch { return false; }
    if (!b || typeof b !== 'object' || !isTag(b.src)) return false;
    const day = etDay(nowMs);
    const src = b.src;
    switch (b.e) {
      case 'visit': {
        if (typeof b.isNew !== 'boolean' || typeof b.daily !== 'boolean' || typeof b.firstReturn !== 'boolean') return false;
        if (typeof b.cohort !== 'string' || !DAY.test(b.cohort) || !isTag(b.firstSrc)) return false;
        const since = b.daysSince;
        if (typeof since !== 'number' || !Number.isInteger(since) || since < 0 || since > 5000) return false;
        // a cohort day far from today is a broken clock or a forged beacon
        const cohortOk = Math.abs(Date.parse(b.cohort) - Date.parse(day)) <= (since + 2) * 86_400_000;
        const s = this.src(day, src);
        s.loads++;
        if (b.daily) s.visitors++;
        if (b.isNew) {
          s.fresh++;
          // the server's day, not the client's: a forged date can't create cohorts
          this.cohort(day, src).size++;
        } else if (b.daily && cohortOk) {
          if (since === 1) this.cohort(b.cohort, b.firstSrc).nextDay++;
          if (b.firstReturn && since <= 7) this.cohort(b.cohort, b.firstSrc).week++;
        }
        break;
      }
      case 'stay': {
        const i = STAY_S.indexOf(b.s as (typeof STAY_S)[number]);
        if (i < 0) return false;
        this.src(day, src).stay[i]!++;
        break;
      }
      case 'play':
        this.src(day, src).played++;
        break;
      case 'share': {
        if (typeof b.kind !== 'string' || !KINDS.has(b.kind) || typeof b.how !== 'string' || !HOWS.has(b.how)) return false;
        this.src(day, src).shares++;
        const sh = own(this.data.shares, day) ? this.data.shares[day]! : (this.data.shares[day] = {});
        const k = `${b.kind}:${b.how}`;
        sh[k] = (own(sh, k) ? sh[k]! : 0) + 1;
        break;
      }
      default:
        return false;
    }
    this.dirty = true;
    return true;
  }

  /** Drops days older than about a year, and any day in the future. */
  prune(nowMs: number): void {
    const cutoff = addDays(etDay(nowMs), -KEEP_DAYS), latest = addDays(etDay(nowMs), 1);
    for (const k of ['days', 'cohorts', 'shares'] as const) {
      for (const d of Object.keys(this.data[k])) if (d < cutoff || d > latest || !DAY.test(d)) { delete this.data[k][d]; this.dirty = true; }
    }
  }

  /** Totals by source over [from, to] days inclusive, plus retention for cohorts in that range. */
  summary(from: string, to: string): { sources: SourceSummary[]; daily: { day: string; visitors: number; played: number; shares: number }[]; shares: Record<string, number> } {
    const by = new Map<string, SourceSummary>();
    const get = (s: string) => {
      let r = by.get(s);
      if (!r) by.set(s, r = { source: s, ...blankDay(), cohort: 0, nextDay: 0, week: 0, cohortMature: 0, weekMature: 0 });
      return r;
    };
    const daily: { day: string; visitors: number; played: number; shares: number }[] = [];
    const shares: Record<string, number> = {};
    for (let d = from; d <= to; d = addDays(d, 1)) {
      let v = 0, p = 0, sh = 0;
      for (const [s, c] of Object.entries(this.data.days[d] ?? {})) {
        const r = get(s);
        r.loads += c.loads; r.visitors += c.visitors; r.fresh += c.fresh; r.played += c.played; r.shares += c.shares;
        for (let i = 0; i < 4; i++) r.stay[i]! += c.stay[i]!;
        v += c.visitors; p += c.played; sh += c.shares;
      }
      for (const [s, c] of Object.entries(this.data.cohorts[d] ?? {})) {
        const r = get(s);
        r.cohort += c.size; r.nextDay += c.nextDay; r.week += c.week;
        // only cohorts old enough to have had the chance count toward the rates
        if (d < to) r.cohortMature += c.size;
        if (addDays(d, 7) <= to) r.weekMature += c.size;
      }
      for (const [k, n] of Object.entries(this.data.shares[d] ?? {})) shares[k] = (shares[k] ?? 0) + n;
      daily.push({ day: d, visitors: v, played: p, shares: sh });
    }
    const sources = [...by.values()].sort((a, b) => b.visitors - a.visitors || b.cohort - a.cohort);
    return { sources, daily, shares };
  }
}

export interface SourceSummary extends SourceDay {
  source: string;
  cohort: number;
  nextDay: number;
  week: number;
  /** Cohort sizes old enough to judge next-day (≥1 day old) and 7-day (≥7 days old) return. */
  cohortMature: number;
  weekMature: number;
}

function isData(d: unknown): d is AnalyticsData {
  const x = d as AnalyticsData;
  return !!x && x.v === 1 && typeof x.days === 'object' && typeof x.cohorts === 'object' && typeof x.shares === 'object';
}

/** Per-IP beacon rate limit, in memory only and forgotten every minute. */
export class RateLimit {
  private counts = new Map<string, number>();
  private windowStart = 0;
  constructor(private readonly perMinute: number) {}
  allow(key: string, nowMs: number): boolean {
    if (nowMs - this.windowStart >= 60_000) { this.counts.clear(); this.windowStart = nowMs; }
    const n = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, n);
    return n <= this.perMinute;
  }
}
