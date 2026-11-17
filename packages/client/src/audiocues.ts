import { PHYS, entityState, type Entity, type Level } from '@blobocracy/shared';

const SAW_HEAR_TILES = 6;

/**
 * Turns what's happening in the world into one-shot sound cues by comparing frames:
 * presses hitting bottom, new crumbles, spring launches, and how close the nearest saw is.
 */
export class AudioCues {
  private readonly crushers: Extract<Entity, { kind: 'crusher' }>[];
  private readonly saws: Extract<Entity, { kind: 'saw' }>[];
  private wasHolding = new Map<number, boolean>();
  private crumbled = new Set<number>();

  constructor(level: Level) {
    this.crushers = level.entities.filter((e): e is Extract<Entity, { kind: 'crusher' }> => e.kind === 'crusher');
    this.saws = level.entities.filter((e): e is Extract<Entity, { kind: 'saw' }> => e.kind === 'saw');
  }

  /** 0 (silent) to 1 (touching) for the nearest saw. */
  sawProximity(runTime: number, x: number, y: number): number {
    let best = 0;
    for (const s of this.saws) {
      if (Math.abs(s.x - x) > SAW_HEAR_TILES + 10) continue;
      const st = entityState(s, runTime);
      if (st.kind !== 'saw') continue;
      const d = Math.max(0, Math.hypot(st.x - x, st.y - y) - st.r - PHYS.halfW);
      best = Math.max(best, 1 - Math.min(1, d / SAW_HEAR_TILES));
    }
    return best;
  }

  /** Distances (tiles) to presses that hit bottom since the last call. */
  slams(runTime: number, x: number): number[] {
    const out: number[] = [];
    for (const c of this.crushers) {
      const st = entityState(c, runTime);
      if (st.kind !== 'crusher') continue;
      const holding = st.moving === 'hold';
      if (holding && !this.wasHolding.get(c.id)) out.push(Math.abs(c.x + c.w / 2 - x));
      this.wasHolding.set(c.id, holding);
    }
    return out;
  }

  /** How many crumble tiles started giving way since the last call (resets with a new run). */
  newCrumbles(list: readonly { tile: number; at?: number }[]): number {
    if (list.length === 0) { this.crumbled.clear(); return 0; }
    let n = 0;
    for (const c of list) if (!this.crumbled.has(c.tile)) { this.crumbled.add(c.tile); n++; }
    return n;
  }

  /** A take-off this fast can only come from a spring. */
  static isSpring(vy: number): boolean {
    return vy < -(PHYS.jumpVelocity + PHYS.springVelocity) / 2;
  }
}
