import { describe, expect, test } from 'vitest';
import { createAdmin } from '../src/admin';
import { BudgetGovernor, MemoryStore } from '../src/budget';

function setup(token: string | undefined = 'sekret') {
  const sent: unknown[] = [];
  const governor = new BudgetGovernor(
    { mode: 'cap', monthlyUsd: 50, alertUsd: 25, prices: { simHourly: 0, edgeHourly: 0, fixedMonthly: 0, egressPerGb: 0.02 } },
    { store: new MemoryStore(), alert: () => {}, now: () => Date.UTC(2026, 10, 5) },
  );
  const admin = createAdmin({ token, governor, stats: () => ({ online: 3 }), control: (c) => sent.push(c), onBudget: () => sent.push('budget') });
  const call = (method: string, path: string, body: unknown = undefined, auth = `Bearer ${token}`) =>
    admin({ method, path, auth, body: body === undefined ? '' : JSON.stringify(body) });
  return { admin, call, sent, governor };
}

describe('admin endpoint', () => {
  test('needs the bearer token; disabled entirely without ADMIN_TOKEN', () => {
    const { call } = setup();
    expect(call('GET', '/admin/stats', undefined, 'Bearer wrong').status).toBe(401);
    expect(call('GET', '/admin/stats', undefined, '').status).toBe(401);
    expect(call('GET', '/admin/stats').status).toBe(200);
    expect(setup('').call('GET', '/admin/stats', undefined, 'Bearer ').status).toBe(404);
  });

  test('stats include the budget', () => {
    const r = setup().call('GET', '/admin/stats');
    expect(r.body).toMatchObject({ online: 3, budget: { budgetUsd: 50, tier: 0 } });
  });

  test('ban and unban an IP or CIDR; the list goes to every relay', () => {
    const { call, sent } = setup();
    expect(call('POST', '/admin/ban', { cidr: '203.0.113.0/24' }).status).toBe(200);
    expect(call('POST', '/admin/ban', { cidr: '2001:db8::1' }).status).toBe(200);
    expect(sent.at(-1)).toEqual({ c: 'bans', cidrs: ['203.0.113.0/24', '2001:db8::1'] });
    expect(call('POST', '/admin/ban', { cidr: 'not-an-ip' }).status).toBe(400);
    expect(call('POST', '/admin/unban', { cidr: '203.0.113.0/24' }).status).toBe(200);
    expect(sent.at(-1)).toEqual({ c: 'bans', cidrs: ['2001:db8::1'] });
  });

  test('raise the budget live', () => {
    const { call, governor, sent } = setup();
    expect(call('POST', '/admin/budget', { monthlyUsd: 120 }).status).toBe(200);
    expect(governor.budget()).toBe(120);
    expect(sent).toContain('budget');
    expect(call('POST', '/admin/budget', { monthlyUsd: -1 }).status).toBe(400);
  });

  test('reset flags tells the relays', () => {
    const { call, sent } = setup();
    expect(call('POST', '/admin/reset-flags').status).toBe(200);
    expect(sent.at(-1)).toEqual({ c: 'resetFlags' });
  });

  test('unknown routes 404, bad JSON 400', () => {
    const { admin, call } = setup();
    expect(call('GET', '/admin/nope').status).toBe(404);
    expect(admin({ method: 'POST', path: '/admin/ban', auth: 'Bearer sekret', body: '{' }).status).toBe(400);
  });
});
