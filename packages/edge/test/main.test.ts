import { describe, expect, test } from 'vitest';
import { boot } from '../../sim/test/boot';

describe('edge boot checks in production', () => {
  test('refuses to start without RELAY_SECRET (I8)', async () => {
    const env = { NODE_ENV: 'production', PORT: '0', HOST: '127.0.0.1', SESSION_SECRET: 's'.repeat(32), SIM_URL: 'ws://127.0.0.1:9/relay' };
    const r = await boot('packages/edge/src/main.ts', env, 'Blobocracy edge');
    expect(r.code).not.toBe(null);
    expect(r.out).toContain('RELAY_SECRET is required in production');
    const ok = await boot('packages/edge/src/main.ts', { ...env, RELAY_SECRET: 'r'.repeat(32) }, 'Blobocracy edge');
    expect(ok.code).toBe(null);
  }, 40_000);
});
