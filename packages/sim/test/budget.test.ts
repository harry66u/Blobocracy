import { describe, expect, test } from 'vitest';
import { Budget, capacityFor, defaultBudgetConfig, frameEveryFor, type BudgetConfig } from '../src/budget';
import { makeAlerter, throttled } from '../src/alerts';

const T0 = Date.parse('2026-11-17T12:00:00Z');
const cfg = (o: Partial<BudgetConfig> = {}): BudgetConfig => ({
  mode: 'cap', monthlyUsd: 50, alertUsd: 25, baseMonthlyUsd: 0, egressUsdPerGb: 0.02, overhead: 1, ...o,
});
const GB = 1e9;

describe('budget governor', () => {
  test('defaults match the client decision: cap mode, $50 budget, first alert at $25', () => {
    const c = defaultBudgetConfig({});
    expect(c).toMatchObject({ mode: 'cap', monthlyUsd: 50, alertUsd: 25, egressUsdPerGb: 0.02 });
    expect(defaultBudgetConfig({ MONTHLY_BUDGET_USD: '120', BUDGET_MODE: 'alert' })).toMatchObject({ monthlyUsd: 120, mode: 'alert' });
    expect(defaultBudgetConfig({ MONTHLY_BUDGET_USD: 'lots' }).monthlyUsd).toBe(50);
  });

  test('a separate alert amount gets its own alert', () => {
    const alerts: string[] = [];
    const b = new Budget(cfg({ alertUsd: 10 }), T0, null, (t) => alerts.push(t));
    b.addBytes(600 * GB); // $12
    b.tick(T0 + 1);
    expect(alerts).toEqual([expect.stringContaining('passed the alert amount ($10): $12.00')]);
  });

  test('every alert fires once, in order, and each step of the cap engages', () => {
    const alerts: string[] = [];
    const b = new Budget(cfg(), T0, null, (t) => alerts.push(t));
    const levels: string[] = [];
    // $0.02/GB: $50 = 2,500 GB. Step through spend in 100 GB slices.
    for (let gb = 0; gb < 2600; gb += 100) {
      b.addBytes(100 * GB);
      b.tick(T0 + gb);
      levels.push(`${Math.round(b.spentUsd)}:${b.level}`);
    }
    // $25 is both the alert amount and 50% of $50, so it is one alert that says both
    expect(alerts.map((a) => a.match(/(alert amount.*50% of|\d+% of)/)![0])).toEqual(['alert amount ($25) and reached 50% of', '70% of', '90% of', '100% of']);
    expect(alerts[1]).toContain('reduced frame rate');
    expect(alerts[2]).toContain('holding capacity');
    expect(alerts[3]).toContain('packed');
    expect(levels).toContain('34:0');
    expect(levels).toContain('36:1');
    expect(levels).toContain('46:2');
    expect(levels).toContain('50:3');
  });

  test('machine time accrues by the hour', () => {
    const b = new Budget(cfg({ baseMonthlyUsd: 73 }), T0, null, () => {});
    b.tick(T0 + 10 * 3_600_000);
    expect(b.spentUsd).toBeCloseTo(1, 5); // 73 $/month ÷ 730 h × 10 h
  });

  test('alert mode warns but never limits', () => {
    const alerts: string[] = [];
    const b = new Budget(cfg({ mode: 'alert' }), T0, null, (t) => alerts.push(t));
    b.addBytes(3000 * GB);
    b.tick(T0 + 1);
    expect(b.level).toBe(0);
    expect(alerts).toHaveLength(4);
    expect(alerts[3]).toContain('Alert-only mode');
  });

  test('raising the budget live brings the game back and re-arms the higher alerts', () => {
    const alerts: string[] = [];
    const b = new Budget(cfg(), T0, null, (t) => alerts.push(t));
    b.addBytes(2600 * GB);
    b.tick(T0 + 1);
    expect(b.level).toBe(3);
    b.setMonthly(100, T0 + 2);
    expect(b.level).toBe(0);
    expect(alerts.at(-1)).toContain('back to normal');
    b.addBytes(1000 * GB); // $72 of $100
    b.tick(T0 + 3);
    expect(b.level).toBe(1);
    expect(alerts.at(-1)).toContain('70% of the $100 budget');
  });

  test('state survives a restart within the month and resets in a new month', () => {
    const b = new Budget(cfg(), T0, null, () => {});
    b.addBytes(1000 * GB);
    b.tick(T0 + 1);
    const saved = JSON.parse(JSON.stringify(b.state));
    const again = new Budget(cfg(), T0 + 60_000, saved, () => {});
    expect(again.spentUsd).toBeCloseTo(20, 5);
    expect(again.state.alerted).toEqual([]); // $20 is below every threshold
    const nextMonth = new Budget(cfg(), Date.parse('2026-12-01T00:00:01Z'), saved, () => {});
    expect(nextMonth.spentUsd).toBe(0);
    // and a running server rolls over at the month boundary
    b.tick(Date.parse('2026-12-01T00:00:01Z'));
    expect(b.spentUsd).toBe(0);
  });

  test('capacity and frame rate per level', () => {
    const caps = { max: 20000, base: 2000, packed: 100 };
    expect([0, 1, 2, 3].map((l) => capacityFor(l as 0, caps))).toEqual([20000, 20000, 2000, 100]);
    expect([0, 1, 2, 3].map((l) => frameEveryFor(l as 0))).toEqual([3, 5, 5, 5]);
  });
});

describe('alerts', () => {
  test('posts Discord- and Slack-compatible JSON and retries server errors', async () => {
    const calls: { url: string; body: string }[] = [];
    let n = 0;
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: String(init.body) });
      return new Response(null, { status: ++n === 1 ? 500 : 204 });
    }) as unknown as typeof fetch;
    const a = makeAlerter('https://hooks.example/x', () => {}, fake);
    a('hello');
    await a.flush();
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0]!.body)).toEqual({ content: 'hello', text: 'hello' });
  }, 10_000);

  test('throttled alerts fire at most once per window per kind', () => {
    const got: string[] = [];
    const t = throttled((s) => got.push(s), 1000);
    t('full', 'a', 0); t('full', 'b', 500); t('lag', 'c', 600); t('full', 'd', 1500);
    expect(got).toEqual(['a', 'c', 'd']);
  });
});
