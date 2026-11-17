import { PHYS, T_EMPTY, T_SOLID, T_SPIKE_UP, tileAt, type Level } from '@blobocracy/shared';
import type { Voters } from './crowd';
import type { World } from './world';

const L = 1, R = 2, J = 4;
const FIRST_ID = 1_000_000;

type Persona = 'helper' | 'chaos' | 'idle';
interface Fake { id: number; persona: Persona; dir: number; nextRoll: number; jumpAt: number; jumpUntil: number; reacts: boolean }

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

/** True when a gap, floor spike or step up is within `range` tiles ahead of the blob's feet. */
export function hazardAhead(level: Level, x: number, y: number, dir: number, range = 3): boolean {
  if (dir === 0) return false;
  const footRow = Math.floor(y + PHYS.halfH + 0.05);
  for (let d = 1; d <= range; d++) {
    const col = Math.floor(x + dir * d);
    const above = tileAt(level, col, footRow - 1);
    if (above === T_SPIKE_UP || above === T_SOLID) return true;
    if (tileAt(level, col, footRow) === T_EMPTY && tileAt(level, col, footRow + 1) === T_EMPTY) return true;
  }
  return false;
}

/**
 * Fake voters for feeling out the blending. A mixed crowd like a real one:
 * - helpers (70%) mostly push right and jump at hazards after a human delay (150-400 ms);
 * - chaos (20%) mash random directions and random jumps;
 * - idle (10%) pressed once and wandered off.
 */
export class VirtualCrowd {
  private fakes: Fake[] = [];
  private rand: () => number;
  private prevDanger = false;
  private prevGrounded = true;

  constructor(private voters: Voters, count: number, seed: number) {
    this.rand = rng(seed);
    for (let i = 0; i < count; i++) {
      const r = this.rand();
      const persona: Persona = r < 0.7 ? 'helper' : r < 0.9 ? 'chaos' : 'idle';
      const f: Fake = { id: FIRST_ID + i, persona, dir: 0, nextRoll: 0, jumpAt: Infinity, jumpUntil: 0, reacts: this.rand() < 0.9 };
      voters.join(f.id);
      this.fakes.push(f);
    }
  }

  update(nowS: number, world: World): void {
    const b = world.body;
    const dir = Math.sign(b.vx) || b.facing;
    // Look further ahead when moving fast: people react to what is coming, not what is here.
    const range = 1.2 + Math.abs(b.vx) * 0.35;
    const danger = world.phase === 'running' && hazardAhead(world.level, b.x, b.y, dir, range);
    // People react once per obstacle: when it comes into view, or when the blob lands with it still ahead.
    const cue = danger && (!this.prevDanger || (b.grounded && !this.prevGrounded));
    this.prevDanger = danger;
    this.prevGrounded = b.grounded;
    for (const f of this.fakes) {
      if (nowS >= f.nextRoll) this.roll(f, nowS);
      if (f.persona === 'helper' && cue && f.reacts && f.jumpAt === Infinity) {
        f.jumpAt = nowS + 0.15 + this.rand() * 0.25;
      }
      if (f.persona === 'chaos' && f.jumpAt === Infinity && this.rand() < 0.15 * (1 / 60)) f.jumpAt = nowS;
      if (nowS >= f.jumpAt) {
        f.jumpUntil = f.jumpAt + (f.persona === 'helper' ? 0.25 + this.rand() * 0.35 : 0.1 + this.rand() * 0.3);
        f.jumpAt = Infinity;
      }
      const jumping = nowS < f.jumpUntil;
      const bits = (f.dir > 0 ? R : f.dir < 0 ? L : 0) | (jumping ? J : 0);
      this.voters.setInput(f.id, bits, nowS);
    }
  }

  private roll(f: Fake, nowS: number): void {
    const r = this.rand();
    if (f.persona === 'helper') f.dir = r < 0.8 ? 1 : r < 0.92 ? 0 : -1;
    else if (f.persona === 'chaos') f.dir = r < 0.4 ? 1 : r < 0.8 ? -1 : 0;
    else f.dir = f.nextRoll === 0 ? 1 : 0;
    f.nextRoll = f.persona === 'idle' && f.nextRoll !== 0 ? Infinity : nowS + 0.4 + this.rand() * 2.1;
  }
}
