import { createBody, stepBody, type Body, type Control, type Level } from '../../src/index';

/** Every decision is held this many 60 Hz steps (100 ms): no frame-perfect inputs. */
export const HOLD_STEPS = 6;

const ACTIONS: Control[] = [];
for (const move of [1, 0, -1]) for (const jumpHeld of [false, true]) ACTIONS.push({ move, jumpHeld });

interface Node { b: Body; steps: number }

/**
 * Beam search over human-ish inputs (each held >= 100 ms) through the deterministic physics.
 * Returns whether the body reached `targetX` without dying, and how long it took.
 */
export function solve(level: Level, targetX: number, beam = 250, maxSeconds = 600): { ok: boolean; seconds: number; maxX: number } {
  let frontier: Node[] = [{ b: createBody(level), steps: 0 }];
  let maxX = frontier[0]!.b.x;
  const maxDecisions = Math.ceil((maxSeconds * 60) / HOLD_STEPS);
  for (let d = 0; d < maxDecisions && frontier.length; d++) {
    const next = new Map<string, Node>();
    for (const n of frontier) {
      for (const a of ACTIONS) {
        const b = { ...n.b };
        let dead = false;
        for (let i = 0; i < HOLD_STEPS; i++) if (stepBody(b, a, level)) { dead = true; break; }
        if (dead) continue;
        const steps = n.steps + HOLD_STEPS;
        if (b.x >= targetX) return { ok: true, seconds: steps / 60, maxX: b.x };
        maxX = Math.max(maxX, b.x);
        const key = `${Math.round(b.x * 4)},${Math.round(b.y * 4)},${Math.round(b.vx)},${Math.round(b.vy * 2)},${b.grounded ? 1 : 0},${b.prevJumpHeld ? 1 : 0}`;
        if (!next.has(key)) next.set(key, { b, steps });
      }
    }
    frontier = [...next.values()].sort((p, q) => q.b.x - p.b.x).slice(0, beam);
  }
  return { ok: false, seconds: Infinity, maxX };
}
