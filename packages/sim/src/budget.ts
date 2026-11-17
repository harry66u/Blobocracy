// The cost cap (design spec §10). Fly.io has no spending limit of its own, so the game
// keeps its own month-to-date estimate (machine time + bytes sent) and steps down as it
// approaches the budget:
//   ≥ 70%  state frames drop from 20 to 12 per second for everyone
//   ≥ 90%  no new players beyond BASE_CAPACITY (extra visitors see the "packed" screen)
//   ≥ 100% capacity drops to PACKED_CAPACITY (a small game keeps running for the people
//          already in it); everyone else sees the packed screen
// Alerts fire once a month at the alert amount and at 50/70/90/100% of the budget.
// In 'alert' mode the alerts fire but nothing is enforced.

export type BudgetMode = 'cap' | 'alert';

export interface BudgetConfig {
  mode: BudgetMode;
  monthlyUsd: number;
  alertUsd: number;
  /** Always-on machine cost per month (all machines), accrued by the hour. */
  baseMonthlyUsd: number;
  /** Egress price per GB (Fly North America: $0.02). */
  egressUsdPerGb: number;
  /** Multiplier for WebSocket/TCP/TLS overhead on top of payload bytes. */
  overhead: number;
}

export interface BudgetState {
  /** UTC month this estimate is for, YYYY-MM (Fly bills by calendar month). */
  month: string;
  machineUsd: number;
  egressBytes: number;
  /** Thresholds already alerted this month, in USD. */
  alerted: number[];
  /** Last time machine cost was accrued. */
  accruedTo: number;
}

/** 0 normal, 1 reduced frame rate, 2 holding capacity, 3 packed. */
export type BudgetLevel = 0 | 1 | 2 | 3;
export const LEVEL_NAMES = ['normal', 'reduced frame rate', 'holding capacity', 'packed'] as const;

const MONTH_HOURS = 730;
const GB = 1e9;

export const monthOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

export function defaultBudgetConfig(env: Record<string, string | undefined>): BudgetConfig {
  const num = (k: string, d: number) => {
    const v = Number(env[k]);
    return env[k] !== undefined && Number.isFinite(v) && v >= 0 ? v : d;
  };
  return {
    mode: env.BUDGET_MODE === 'alert' ? 'alert' : 'cap',
    monthlyUsd: num('MONTHLY_BUDGET_USD', 50),
    alertUsd: num('BUDGET_ALERT_USD', 25),
    baseMonthlyUsd: num('BASE_MONTHLY_USD', 10),
    egressUsdPerGb: num('EGRESS_USD_PER_GB', 0.02),
    overhead: num('EGRESS_OVERHEAD', 1.15),
  };
}

export class Budget {
  state: BudgetState;
  private levelNow: BudgetLevel = 0;

  constructor(
    public cfg: BudgetConfig,
    nowMs: number,
    saved: unknown,
    private readonly alert: (text: string) => void,
  ) {
    const s = saved as BudgetState | null;
    const ok = s && typeof s.month === 'string' && Number.isFinite(s.machineUsd) && Number.isFinite(s.egressBytes) && Array.isArray(s.alerted);
    this.state = ok && s.month === monthOf(nowMs)
      ? { ...s, accruedTo: Math.min(nowMs, Number(s.accruedTo) || nowMs) }
      : { month: monthOf(nowMs), machineUsd: 0, egressBytes: 0, alerted: [], accruedTo: nowMs };
    this.levelNow = this.computeLevel();
  }

  /** Bytes about to be sent to players (payload; overhead is added here). */
  addBytes(n: number): void {
    this.state.egressBytes += n * this.cfg.overhead;
  }

  get egressUsd(): number { return (this.state.egressBytes / GB) * this.cfg.egressUsdPerGb; }
  get spentUsd(): number { return this.state.machineUsd + this.egressUsd; }
  get fraction(): number { return this.cfg.monthlyUsd > 0 ? this.spentUsd / this.cfg.monthlyUsd : 1; }
  get level(): BudgetLevel { return this.cfg.mode === 'cap' ? this.levelNow : 0; }

  /** Accrues machine time, rolls the month over, fires alerts. Call about once a second. */
  tick(nowMs: number): void {
    const month = monthOf(nowMs);
    if (month !== this.state.month) {
      this.state = { month, machineUsd: 0, egressBytes: 0, alerted: [], accruedTo: nowMs };
    }
    const hours = Math.max(0, nowMs - this.state.accruedTo) / 3_600_000;
    this.state.machineUsd += (hours * this.cfg.baseMonthlyUsd) / MONTH_HOURS;
    this.state.accruedTo = nowMs;

    const spent = this.spentUsd;
    // The alert amount can coincide with a percentage (the default $25 is 50% of $50): one alert then.
    const byUsd = new Map<number, string[]>();
    const add = (usd: number, what: string) => {
      if (usd <= 0) return;
      const key = Math.round(usd * 100) / 100;
      byUsd.set(key, [...(byUsd.get(key) ?? []), what]);
    };
    add(this.cfg.alertUsd, `passed the alert amount ($${this.cfg.alertUsd})`);
    for (const f of [0.5, 0.7, 0.9, 1]) add(this.cfg.monthlyUsd * f, `reached ${f * 100}% of the $${this.cfg.monthlyUsd} budget`);
    for (const [usd, whats] of [...byUsd].sort((a, b) => a[0] - b[0])) {
      if (spent >= usd && !this.state.alerted.includes(usd)) {
        this.state.alerted.push(usd);
        const lvl = this.computeLevel();
        const effect = this.cfg.mode === 'alert' ? 'Alert-only mode: nothing is being limited.' : `Game is now: ${LEVEL_NAMES[lvl]}.`;
        this.alert(`Blobocracy spend estimate ${whats.join(' and ')}: $${spent.toFixed(2)} so far in ${month}. ${effect}`);
      }
    }
    const before = this.levelNow;
    this.levelNow = this.computeLevel();
    if (this.cfg.mode === 'cap' && this.levelNow < before) {
      this.alert(`Blobocracy budget raised or reset: game is back to ${LEVEL_NAMES[this.levelNow]}.`);
    }
  }

  /** Raise (or lower) the monthly budget live, e.g. from the admin endpoint. */
  setMonthly(usd: number, nowMs: number): void {
    this.cfg = { ...this.cfg, monthlyUsd: usd };
    // thresholds above the new spend may fire again at their new amounts
    this.state.alerted = this.state.alerted.filter((a) => a <= this.spentUsd && a === this.cfg.alertUsd);
    this.tick(nowMs);
  }

  private computeLevel(): BudgetLevel {
    const f = this.fraction;
    return f >= 1 ? 3 : f >= 0.9 ? 2 : f >= 0.7 ? 1 : 0;
  }

  snapshot() {
    return {
      mode: this.cfg.mode, month: this.state.month, monthlyUsd: this.cfg.monthlyUsd, alertUsd: this.cfg.alertUsd,
      spentUsd: round2(this.spentUsd), machineUsd: round2(this.state.machineUsd), egressUsd: round2(this.egressUsd),
      egressGb: Math.round((this.state.egressBytes / GB) * 1000) / 1000, fraction: Math.round(this.fraction * 1000) / 1000,
      level: LEVEL_NAMES[this.level], alerted: this.state.alerted,
    };
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How many players may be connected at this budget level. */
export function capacityFor(level: BudgetLevel, caps: { max: number; base: number; packed: number }): number {
  if (level >= 3) return Math.min(caps.packed, caps.max);
  if (level >= 2) return Math.min(caps.base, caps.max);
  return caps.max;
}

/** Sim steps between state frames: 3 (20 Hz) normally, 5 (12 Hz) from the reduced level up. */
export const frameEveryFor = (level: BudgetLevel) => (level >= 1 ? 5 : 3);
