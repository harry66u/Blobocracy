import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  BudgetGovernor, JsonFileStore, MemoryStore, type BudgetAlert, type BudgetConfig,
} from '../src/budget';

const HOUR = 3600_000;
const GB = 1e9;
const NOV = Date.UTC(2026, 10, 1);

function setup(over: Partial<BudgetConfig> = {}, store = new MemoryStore(), start = NOV + 5 * 24 * HOUR) {
  let t = start;
  const alerts: BudgetAlert[] = [];
  const cfg: BudgetConfig = {
    mode: 'cap', monthlyUsd: 50, alertUsd: 25,
    prices: { simHourly: 0.01, edgeHourly: 0.02, fixedMonthly: 0, egressPerGb: 0.02 },
    ...over,
  };
  const g = new BudgetGovernor(cfg, { store, alert: (a) => alerts.push(a), now: () => t });
  return { g, alerts, store, advance: (ms: number) => { t += ms; }, at: (ms: number) => { t = ms; } };
}

/** Dollars of egress at $0.02/GB. */
const usd = (d: number) => (d / 0.02) * GB;

describe('budget governor', () => {
  test('machine hours accrue per sim and per connected relay', async () => {
    const { g, advance } = setup();
    await g.load();
    g.update(2);
    advance(10 * HOUR);
    g.update(2);
    expect(g.spend()).toBeCloseTo(10 * (0.01 + 2 * 0.02), 6);
  });

  test('fixed monthly costs accrue with the calendar', async () => {
    const { g } = setup({ prices: { simHourly: 0, edgeHourly: 0, fixedMonthly: 30, egressPerGb: 0 } }, new MemoryStore(), NOV + 15 * 24 * HOUR);
    await g.load();
    g.update(0);
    expect(g.spend()).toBeCloseTo(15, 6); // November has 30 days
  });

  test('tiers: 70% drops frames to 12 Hz, 90% watchers, 100% packed', async () => {
    const { g } = setup();
    await g.load();
    expect([g.tier(), g.frameHz()]).toEqual([0, 20]);
    g.addEgress(usd(34.9)); g.update(0);
    expect(g.tier()).toBe(0);
    g.addEgress(usd(0.2)); g.update(0);
    expect([g.tier(), g.frameHz()]).toEqual([70, 12]);
    g.addEgress(usd(10)); g.update(0);
    expect(g.tier()).toBe(90);
    g.addEgress(usd(5)); g.update(0);
    expect(g.tier()).toBe(100);
    expect(g.frameHz()).toBe(12);
  });

  test('alerts fire once each at $25, 70%, 90% and 100% (50% = $25 is not doubled)', async () => {
    const { g, alerts } = setup();
    await g.load();
    for (let i = 0; i < 60; i++) { g.addEgress(usd(1)); g.update(0); }
    expect(alerts.map((a) => a.thresholdUsd)).toEqual([25, 35, 45, 50]);
    expect(alerts.map((a) => a.label)).toEqual(['$25 alert', '50% of budget', '70% of budget', '90% of budget', '100% of budget'].filter((l) => l !== '50% of budget'));
    expect(alerts[3]).toMatchObject({ tier: 100, budgetUsd: 50 });
  });

  test('alert mode: alerts fire but nothing is enforced', async () => {
    const { g, alerts } = setup({ mode: 'alert' });
    await g.load();
    g.addEgress(usd(60)); g.update(0);
    expect(g.tier()).toBe(0);
    expect(g.frameHz()).toBe(20);
    expect(g.rawTier()).toBe(100);
    expect(alerts.length).toBe(4);
  });

  test('raising the budget live lowers the tier and re-arms the alerts above the new spend', async () => {
    const { g, alerts } = setup();
    await g.load();
    g.addEgress(usd(50)); g.update(0);
    expect(g.tier()).toBe(100);
    g.setBudget(200);
    expect(g.tier()).toBe(0);
    expect(g.frameHz()).toBe(20);
    alerts.length = 0;
    g.addEgress(usd(91)); g.update(0); // $141 = 70.5% of $200
    expect(alerts.map((a) => a.label)).toEqual(['50% of budget', '70% of budget']);
    expect(g.tier()).toBe(70);
  });

  test('a new month starts from zero, with alerts re-armed and the budget back to the configured one', async () => {
    const { g, alerts, at } = setup();
    await g.load();
    g.addEgress(usd(50)); g.update(0);
    g.setBudget(80);
    at(Date.UTC(2026, 11, 1, 0, 0, 1));
    g.update(0);
    expect(g.spend()).toBeLessThan(0.01);
    expect(g.tier()).toBe(0);
    expect(g.snapshot().budgetUsd).toBe(50);
    alerts.length = 0;
    g.addEgress(usd(26)); g.update(0);
    expect(alerts.map((a) => a.thresholdUsd)).toEqual([25]);
  });

  test('month-to-date counters persist and reload; a stale month is ignored', async () => {
    const store = new MemoryStore();
    const a = setup({}, store);
    await a.g.load();
    a.g.addEgress(usd(40)); a.g.update(0);
    await a.g.save();
    const b = setup({}, store);
    await b.g.load();
    expect(b.g.spend()).toBeCloseTo(40, 4);
    expect(b.g.tier()).toBe(70);
    b.g.addEgress(usd(1)); b.g.update(0);
    expect(b.alerts).toEqual([]); // $25 and 70% already fired this month
    const c = setup({}, store, Date.UTC(2027, 0, 3));
    await c.g.load();
    expect(c.g.spend()).toBe(0);
  });

  test('JsonFileStore round-trips to disk', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'budget-'));
    const file = join(dir, 'nested', 'budget.json');
    const s = new JsonFileStore(file);
    expect(await s.load()).toBeNull();
    await s.save({ month: '2026-11', machineUsd: 1.5, egressBytes: 2e9, fired: ['$25'], budgetUsd: null });
    expect(JSON.parse(readFileSync(file, 'utf8')).machineUsd).toBe(1.5);
    expect(await new JsonFileStore(file).load()).toMatchObject({ month: '2026-11', egressBytes: 2e9 });
  });
});

describe('budget counters that fail to load at boot (I2)', () => {
  /** A counter store whose first `failures` loads throw (Redis or the volume not ready yet). */
  class Flaky extends MemoryStore {
    loads = 0;
    saves = 0;
    constructor(private failures: number) { super(); }
    override async load() { if (this.loads++ < this.failures) throw new Error('ECONNREFUSED'); return super.load(); }
    override async save(s: Parameters<MemoryStore['save']>[0]) { this.saves++; return super.save(s); }
  }

  test('nothing is saved until a load succeeded, so the real month is never overwritten with zeros', async () => {
    const store = new Flaky(1);
    await store.save({ month: '2026-11', machineUsd: 30, egressBytes: usd(5), fired: ['$25 alert'], budgetUsd: null });
    store.saves = 0;
    const { g, advance } = setup({}, store);
    await expect(g.load()).rejects.toThrow();
    g.update(1);
    advance(HOUR);
    g.update(1);
    await g.save();
    expect(store.saves).toBe(0);
    expect((await store.load())!.machineUsd).toBe(30);
    expect(g.loaded).toBe(false);
  });

  test('a late load merges by max with what accrued since boot, then saves resume', async () => {
    const store = new Flaky(1);
    await store.save({ month: '2026-11', machineUsd: 30, egressBytes: usd(5), fired: ['$25 alert'], budgetUsd: 80 });
    const { g, advance, alerts } = setup({}, store);
    await g.load().catch(() => {});
    g.addEgress(usd(1));
    advance(HOUR);
    g.update(0);
    await g.load();
    expect(g.loaded).toBe(true);
    expect(g.spend()).toBeCloseTo(30 + 5, 4);
    expect(g.budget()).toBe(80);
    g.update(0);
    expect(alerts.map((a) => a.label)).not.toContain('$25 alert'); // already sent this month
    await g.save();
    expect((await store.load())!.machineUsd).toBeCloseTo(30, 4);
  });
});
