import { describe, expect, test } from 'vitest';
import { boot } from './boot';

const SIM = 'packages/sim/src/main.ts';
const PROD = { NODE_ENV: 'production', LOCAL_RELAY: '0', SIM_LINK_PORT: '0', SIM_LINK_HOST: '127.0.0.1' };

describe('sim boot checks in production', () => {
  test('refuses to start without RELAY_SECRET (I8)', async () => {
    const r = await boot(SIM, { ...PROD, ALLOW_MEMORY_STORE: '1' }, 'Blobocracy server');
    expect(r.code).not.toBe(null);
    expect(r.out).toContain('RELAY_SECRET is required in production');
  }, 30_000);

  test('refuses to start without DATABASE_URL unless ALLOW_MEMORY_STORE=1 (M7)', async () => {
    const r = await boot(SIM, { ...PROD, RELAY_SECRET: 'x'.repeat(32) }, 'Blobocracy server');
    expect(r.code).not.toBe(null);
    expect(r.out).toContain('DATABASE_URL is required in production');
    const ok = await boot(SIM, { ...PROD, RELAY_SECRET: 'x'.repeat(32), ALLOW_MEMORY_STORE: '1' }, 'Blobocracy server');
    expect(ok.code).toBe(null);
  }, 40_000);
});
