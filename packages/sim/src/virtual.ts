import { PHYS, T_EMPTY, T_SPIKE_UP, tileAt, type Level } from '@blobocracy/shared';
import type { Voters } from './crowd';
import type { World } from './world';

const L = 1, R = 2, J = 4;
const FIRST_ID = 1_000_000;

interface Fake { id: number; dir: number; nextRoll: number; jumpAt: number; jumpUntil: number; reacts: boolean }

/** Deterministic PRNG (mulberry32) so virtual crowds are repeatable. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** True when a gap or floor spike is within `range` tiles ahead of the blob's feet. */
export function hazardAhead(level: Level, x: number, y: number, dir: number, range = 3): boolean {
  if (dir === 0) return false;
  const footRow = Math.floor(y + PHYS.halfH + 0.05);
  for (let d = 1; d <= range; d++) {
    const col = Math.floor(x + dir * d);
    if (tileAt(level, col, footRow - 1) === T_SPIKE_UP) return true;
    if (tileAt(level, col, footRow) === T_EMPTY && tileAt(level, col, footRow + 1) === T_EMPTY) return true;
  }
  return false;
}

/**
 * Fake voters for testing feel and looks: most lean right, some left, some idle;
 * when a hazard is ahead, the ones who react press jump after a human-like delay.
 */
export class VirtualCrowd {
  private fakes: Fake[] = [];
  private rand: () => number;

  constructor(private voters: Voters, count: number, seed: number) {
    this.rand = rng(seed);
    for (let i = 0; i < count; i++) {
      const f: Fake = { id: FIRST_ID + i, dir: 0, nextRoll: 0, jumpAt: Infinity, jumpUntil: 0, reacts: this.rand() < 0.75 };
      voters.join(f.id);
      this.fakes.push(f);
    }
  }

  update(nowS: number, world: World): void {
    const b = world.body;
    const danger = world.phase === 'running' && hazardAhead(world.level, b.x, b.y, Math.sign(b.vx) || b.facing);
    for (const f of this.fakes) {
      if (nowS >= f.nextRoll) {
        const r = this.rand();
        f.dir = r < 0.6 ? 1 : r < 0.85 ? -1 : 0;
        f.nextRoll = nowS + 0.4 + this.rand() * 2.1;
      }
      if (danger && f.reacts && f.jumpAt === Infinity && nowS > f.jumpUntil) {
        f.jumpAt = nowS + 0.15 + this.rand() * 0.25;
      }
      if (nowS >= f.jumpAt) {
        f.jumpUntil = f.jumpAt + 0.15 + this.rand() * 0.35;
        f.jumpAt = Infinity;
      }
      const jumping = nowS < f.jumpUntil;
      const bits = (f.dir > 0 ? R : f.dir < 0 ? L : 0) | (jumping ? J : 0);
      this.voters.setInput(f.id, bits, nowS);
    }
  }
}
