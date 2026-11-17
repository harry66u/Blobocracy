import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Redis } from 'ioredis';
import type { Tier } from '@blobocracy/shared';

/**
 * Budget governor (spec §10): Fly has no spending limit, so the game enforces its own.
 * Month-to-date spend is estimated from machine-hours (sim + every connected relay), a fixed
 * monthly part (Redis, volumes, stopped-machine storage) prorated by the calendar, and egress
 * bytes reported by the relays. In `cap` mode the tiers below are enforced; in `alert` mode
 * only the alerts fire.
 *   70%: frame rate 20 → 12 Hz;  90%: new players beyond always-on capacity become watchers,
 *   no new relays;  100%: capacity held at the always-on relays, extra visitors see "packed".
 */

export interface Prices {
  /** $/hour of the sim machine. */
  simHourly: number;
  /** $/hour of each relay machine while it is connected (relays can report their own price). */
  edgeHourly: number;
  /** $/month that accrues regardless of load (Redis, volumes, stopped machines' disks). */
  fixedMonthly: number;
  /** $/GB of egress. */
  egressPerGb: number;
}

export interface BudgetConfig {
  mode: 'cap' | 'alert';
  monthlyUsd: number;
  /** An extra early alert at this many dollars (client: $25). */
  alertUsd: number;
  prices: Prices;
}

/** What is persisted (Redis when REDIS_URL is set, else a JSON file or memory). */
export interface BudgetState {
  /** UTC month, `YYYY-MM`. */
  month: string;
  machineUsd: number;
  egressBytes: number;
  /** Labels of alerts already sent this month. */
  fired: string[];
  /** Budget raised live through the admin endpoint (reset at the start of each month). */
  budgetUsd: number | null;
}

export interface CounterStore {
  load(): Promise<BudgetState | null>;
  save(s: BudgetState): Promise<void>;
}

export interface BudgetAlert {
  label: string;
  thresholdUsd: number;
  spendUsd: number;
  budgetUsd: number;
  tier: Tier;
  mode: 'cap' | 'alert';
  month: string;
}

export class MemoryStore implements CounterStore {
  private s: BudgetState | null = null;
  async load() { return this.s ? structuredClone(this.s) : null; }
  async save(s: BudgetState) { this.s = structuredClone(s); }
}

/** Writes atomically (temp file + rename), so a crash mid-write never loses the month. */
export class JsonFileStore implements CounterStore {
  constructor(private path: string) {}
  async load(): Promise<BudgetState | null> {
    let text: string;
    try {
      text = await readFile(this.path, 'utf8');
    } catch (e) {
      // no file yet is a fresh month; any other read error must not pass for one (it would be saved over)
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
    try { return JSON.parse(text) as BudgetState; } catch { return null; }
  }
  async save(s: BudgetState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, JSON.stringify(s));
    await rename(tmp, this.path);
  }
}

/** Month-to-date counters in Redis (`budget:state`) when REDIS_URL is set. */
export class RedisCounterStore implements CounterStore {
  constructor(private redis: Redis, private key = 'budget:state') {}
  async load(): Promise<BudgetState | null> {
    const t = await this.redis.get(this.key);
    if (!t) return null;
    try { return JSON.parse(t) as BudgetState; } catch { return null; }
  }
  async save(s: BudgetState): Promise<void> {
    // kept ~3 months so an abandoned key cleans itself up
    await this.redis.set(this.key, JSON.stringify(s), 'EX', 90 * 24 * 3600);
  }
}

const HOUR_MS = 3600_000;
const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);
const monthStart = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
const monthEnd = (ms: number) => { const d = new Date(ms); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1); };
const PERCENTS = [50, 70, 90, 100] as const;

export class BudgetGovernor {
  private state: BudgetState;
  private lastAccrual: number;
  /**
   * The stored month has been read (or there was none). Until then nothing is saved: a sim that
   * booted while Redis or the volume was unreachable starts counting from zero, and saving that
   * would wipe the month's real spend (and with it the cap).
   */
  loaded = false;

  constructor(
    private cfg: BudgetConfig,
    private deps: { store: CounterStore; alert: (a: BudgetAlert) => void; now: () => number },
  ) {
    const now = deps.now();
    this.state = BudgetGovernor.fresh(now);
    this.lastAccrual = now;
  }

  private static fresh(now: number): BudgetState {
    return { month: monthOf(now), machineUsd: 0, egressBytes: 0, fired: [], budgetUsd: null };
  }

  /**
   * Reads the month-to-date counters. Safe to call again after a failure: a late load is merged
   * by max with whatever accrued since boot (so neither the stored month nor the gap is lost).
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    const s = await this.deps.store.load();
    if (this.loaded) return;
    const now = this.deps.now();
    if (s && s.month === monthOf(now)) {
      const cur = this.state;
      const stored: BudgetState = { ...BudgetGovernor.fresh(now), ...s };
      this.state = cur.month === stored.month ? {
        month: stored.month,
        machineUsd: Math.max(stored.machineUsd, cur.machineUsd),
        egressBytes: Math.max(stored.egressBytes, cur.egressBytes),
        fired: [...new Set([...stored.fired, ...cur.fired])],
        budgetUsd: cur.budgetUsd ?? stored.budgetUsd,
      } : stored;
    }
    this.loaded = true;
  }

  /** Persists the counters; a no-op until a load has succeeded. */
  async save(): Promise<void> {
    if (!this.loaded) return;
    await this.deps.store.save(this.state);
  }

  budget(): number {
    return this.state.budgetUsd ?? this.cfg.monthlyUsd;
  }

  /** Month-to-date estimated spend in dollars. */
  spend(): number {
    const now = this.deps.now();
    const start = monthStart(now);
    const fixed = this.cfg.prices.fixedMonthly * Math.min(1, (now - start) / (monthEnd(now) - start));
    return this.state.machineUsd + (this.state.egressBytes / 1e9) * this.cfg.prices.egressPerGb + fixed;
  }

  /** The tier the spend has reached, enforced or not. */
  rawTier(): Tier {
    const share = this.spend() / Math.max(this.budget(), 1e-9);
    return share >= 1 ? 100 : share >= 0.9 ? 90 : share >= 0.7 ? 70 : 0;
  }

  /** The tier being enforced: always 0 in alert mode. */
  tier(): Tier {
    return this.cfg.mode === 'cap' ? this.rawTier() : 0;
  }

  frameHz(): number {
    return this.tier() >= 70 ? 12 : 20;
  }

  addEgress(bytes: number): void {
    if (bytes > 0 && Number.isFinite(bytes)) this.state.egressBytes += bytes;
  }

  /**
   * Accrues machine time since the last call (the sim plus `relays`, each at `edgeHourly`
   * unless an hourly price per relay is given), rolls the month over, and sends due alerts.
   */
  update(relays: number | number[]): void {
    const now = this.deps.now();
    if (monthOf(now) !== this.state.month) {
      this.state = BudgetGovernor.fresh(now);
      this.lastAccrual = Math.max(this.lastAccrual, monthStart(now));
    }
    const hours = Math.max(0, now - this.lastAccrual) / HOUR_MS;
    this.lastAccrual = now;
    const p = this.cfg.prices;
    const edges = typeof relays === 'number' ? relays * p.edgeHourly : relays.reduce((a, h) => a + h, 0);
    this.state.machineUsd += hours * (p.simHourly + edges);
    this.checkAlerts();
  }

  /** Raises (or lowers) the budget live; alerts above the current spend re-arm. */
  setBudget(usd: number): void {
    if (!(usd > 0) || !Number.isFinite(usd)) throw new Error('budget must be a positive number');
    this.state.budgetUsd = usd;
    const spend = this.spend();
    const due = new Set(this.thresholds().filter((t) => t.usd <= spend).map((t) => t.label));
    this.state.fired = this.state.fired.filter((l) => due.has(l));
  }

  snapshot() {
    return {
      month: this.state.month, mode: this.cfg.mode, spendUsd: round(this.spend()), budgetUsd: this.budget(),
      machineUsd: round(this.state.machineUsd), egressGb: round(this.state.egressBytes / 1e9),
      tier: this.tier(), rawTier: this.rawTier(), frameHz: this.frameHz(), alertsSent: [...this.state.fired],
      prices: this.cfg.prices,
    };
  }

  private thresholds(): { label: string; usd: number }[] {
    const b = this.budget();
    const out = [{ label: `$${this.cfg.alertUsd} alert`, usd: this.cfg.alertUsd }];
    for (const p of PERCENTS) {
      const usd = (b * p) / 100;
      if (Math.abs(usd - this.cfg.alertUsd) < 0.005) continue; // same dollar amount: one alert
      out.push({ label: `${p}% of budget`, usd });
    }
    return out.sort((a, b2) => a.usd - b2.usd);
  }

  private checkAlerts(): void {
    const spend = this.spend();
    for (const t of this.thresholds()) {
      if (spend < t.usd || this.state.fired.includes(t.label)) continue;
      this.state.fired.push(t.label);
      this.deps.alert({
        label: t.label, thresholdUsd: t.usd, spendUsd: round(spend), budgetUsd: this.budget(),
        tier: this.tier(), mode: this.cfg.mode, month: this.state.month,
      });
    }
  }
}

const round = (v: number) => Math.round(v * 100) / 100;

/** Sends alerts to `ALERT_WEBHOOK_URL` as JSON (Discord/Slack-compatible `content`/`text`); logs when unset. */
export function alertSender(url: string | undefined, log: (msg: string) => void = console.log) {
  return (a: BudgetAlert) => {
    const text = `Blobocracy budget: ${a.label} reached — $${a.spendUsd.toFixed(2)} of $${a.budgetUsd} this month (${a.month}), tier ${a.tier}, mode ${a.mode}.`;
    log(`[budget alert] ${text}`);
    if (!url) return;
    fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...a, content: text, text }),
      signal: AbortSignal.timeout(10_000),
    }).catch((e: unknown) => log(`[budget alert] webhook failed: ${String(e)}`));
  };
}
