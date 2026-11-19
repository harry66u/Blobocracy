import { expect, test } from 'vitest';
import { createDynamics, LEVEL1, stepBody, type Body, type Control } from '../src/index';

/*
 * Level 1 must play exactly as it always has, whatever later levels add to the physics
 * (low gravity, wind). This drops the blob all over level 1 at many run times, drives it
 * with a fixed pseudo-random crowd, and hashes every step's full body state and every
 * death. The expected hash was recorded with the physics as it was before level 2's
 * mechanics existed. It also covers level 1's layout: if a room of level 1 is edited on
 * purpose, re-record it by running this test against the old physics.ts first.
 */

/** FNV-1a over 32-bit words. */
function fnv(h: number, word: number): number {
  for (let k = 0; k < 4; k++) {
    h ^= (word >>> (k * 8)) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

function fingerprint(): { hash: string; steps: number; deaths: number } {
  let s = 987654321;
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0);
  const moves = [-1, -0.5, 0, 0.6, 1, 1, 1];
  const f = new Float64Array(8);
  const words = new Uint32Array(f.buffer);
  let h = 0x811c9dc5;
  let steps = 0, deaths = 0;
  for (let x = 2; x < LEVEL1.width - 2; x += 5) {
    const b: Body = {
      x: x + 0.5, y: 2, vx: 0, vy: 0, grounded: false, coyote: 0, buffer: 0,
      rising: false, prevJumpHeld: false, facing: 1, landed: 0,
    };
    const dyn = createDynamics();
    dyn.t = (rand() % 600) / 60;
    let c: Control = { move: 1, jumpHeld: false };
    for (let i = 0; i < 240; i++) {
      if (i % 6 === 0) {
        const r = rand();
        c = { move: moves[r % moves.length]!, jumpHeld: (r >>> 8) % 3 === 0 };
      }
      const cause = stepBody(b, c, LEVEL1, dyn);
      steps++;
      f.set([b.x, b.y, b.vx, b.vy, b.coyote, b.buffer, b.landed, dyn.t]);
      for (const w of words) h = fnv(h, w);
      h = fnv(h, (b.grounded ? 1 : 0) | (b.rising ? 2 : 0) | (b.prevJumpHeld ? 4 : 0) | (b.facing === 1 ? 8 : 0) | (dyn.crumbles.size << 4));
      if (cause) {
        deaths++;
        for (let k = 0; k < cause.length; k++) h = fnv(h, cause.charCodeAt(k));
        break;
      }
    }
  }
  return { hash: h.toString(16).padStart(8, '0'), steps, deaths };
}

test('level 1 physics stays bit-identical (golden hash over the whole level)', () => {
  const r = fingerprint();
  expect(r.deaths).toBeGreaterThan(50);
  expect(r).toEqual({ hash: '66607922', steps: 113666, deaths: 376 });
});
