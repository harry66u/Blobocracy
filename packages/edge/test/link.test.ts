import uWS from 'uWebSockets.js';
import { afterEach, describe, expect, test } from 'vitest';
import { startEdge } from '../src/server';

let stops: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const s of stops.reverse()) await s(); stops = []; });

/** A fake sim that sends `messages` to each relay that connects. */
function fakeSim(messages: string[]): Promise<number> {
  const app = uWS.App();
  app.ws('/relay', { open: (ws) => { for (const m of messages) ws.send(m, false); } });
  return new Promise((resolve) => app.listen('127.0.0.1', 0, (t) => {
    stops.push(() => { uWS.us_listen_socket_close(t); app.close(); });
    resolve(uWS.us_socket_local_port(t));
  }));
}
async function waitFor<T>(fn: () => T | undefined | false | null, ms = 3000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('timed out');
}

describe('edge relay link hardening (I8)', () => {
  test('malformed control messages from the sim are ignored, never thrown', async () => {
    const port = await fakeSim([
      '{"c":"bans"}',
      '{"c":"bans","cidrs":"10.0.0.0/8"}',
      '{"c":"policy"}',
      '{"c":"policy","tier":"x","frameHz":20,"alwaysOn":true,"sampleQuota":32,"capacity":10}',
      '{"c":"welcome"}',
      '{"c":"welcome","ev":null}',
      '{"c":"adminRes"}',
      JSON.stringify({ c: 'policy', tier: 90, frameHz: 12, alwaysOn: false, sampleQuota: 16, capacity: 7 }),
    ]);
    const e = await startEdge({ port: 0, host: '127.0.0.1', simUrl: `ws://127.0.0.1:${port}/relay`, sessionSecret: 's', powBits: 0 });
    stops.push(() => e.stop());
    const p = await waitFor(() => e.state().policy.tier === 90 && e.state().policy);
    expect(p).toMatchObject({ tier: 90, alwaysOn: false, capacity: 7, sampleQuota: 16 });
    expect((await fetch(`http://127.0.0.1:${e.port}/healthz`)).status).toBe(200);
  });
});
