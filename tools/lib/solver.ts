import { cloneDynamics, createBody, createDynamics, stepBody, type Body, type Control, type Dynamics, type Level } from '../../packages/shared/src/index';

/** Every decision is held this many 60 Hz steps (100 ms): no frame-perfect inputs. */
export const HOLD_STEPS = 6;

const actionsFor = (speed: number): Control[] => {
  const out: Control[] = [];
  for (const move of [speed, 0, -speed]) for (const jumpHeld of [false, true]) out.push({ move, jumpHeld });
  return out;
};

/** A search state: the body plus its own copy of the run's dynamics, and how it got here. */
interface Node { b: Body; dyn: Dynamics; steps: number; action: number; parent: Node | null; fragile: boolean }

/** At most this many kept states per tile of distance, so patient "wait here" states survive. */
const PER_TILE = 12;
/** Robust plans must survive their switches being made this many steps (150 ms) late. */
const ROBUST_LATE = 9;
/** How long a robustness check follows through (a fall takes ~0.4 s to count as a death). */
const CHECK_STEPS = 36;

/**
 * Half the beam goes to the furthest states (precise sequences), the other half is spread
 * at most PER_TILE per tile behind them, so patient "wait for the ferry" states survive.
 */
function diverse(nodes: Node[], beam: number): Node[] {
  // Robust states first (they survive a late crowd), then furthest first.
  nodes.sort((p, q) => Number(p.fragile) - Number(q.fragile) || q.b.x - p.b.x);
  const kept = nodes.slice(0, beam >> 1);
  const perTile = new Map<number, number>();
  for (const n of kept) perTile.set(Math.floor(n.b.x), (perTile.get(Math.floor(n.b.x)) ?? 0) + 1);
  for (let i = beam >> 1; i < nodes.length && kept.length < beam; i++) {
    const n = nodes[i]!;
    const k = Math.floor(n.b.x);
    const c = perTile.get(k) ?? 0;
    if (c >= PER_TILE) continue;
    perTile.set(k, c + 1);
    kept.push(n);
  }
  return kept;
}

export interface SolveResult { ok: boolean; seconds: number; maxX: number; plan: Control[] }

/**
 * Beam search over human-ish inputs (each held >= 100 ms) through the deterministic physics,
 * from `start` (default: spawn at run time 0). Returns whether the body reached `targetX`
 * alive, how long it took, and the plan: one Control per 100 ms decision. `speed` scales
 * the move input (a crowd that only partly agrees moves slower; plan at the speed it will run).
 * `robust` prefers plans whose every switch survives being made 150 ms late or 100 ms early.
 */
export function solve(level: Level, targetX: number, beam = 250, maxSeconds = 600,
  start?: { b: Body; dyn: Dynamics }, speed = 1, robust = false): SolveResult {
  const ACTIONS = actionsFor(speed);
  /** Would this switch still survive if the crowd made it one decision early (from the grandparent)? */
  const survivesEarly = (n: Node, ai: number): boolean => {
    const p = n.parent;
    if (!p) return true;
    const b = { ...p.b }, dyn = cloneDynamics(p.dyn);
    for (let i = 0; i < CHECK_STEPS; i++) if (stepBody(b, ACTIONS[ai]!, level, dyn)) return false;
    return true;
  };
  /** Would this switch still survive if the crowd made it `late` steps late? */
  const survivesLate = (n: Node, ai: number, late: number): boolean => {
    const b = { ...n.b }, dyn = cloneDynamics(n.dyn);
    const prev = ACTIONS[Math.max(0, n.action)]!, a = ACTIONS[ai]!;
    for (let i = 0; i < late; i++) if (stepBody(b, prev, level, dyn)) return false;
    for (let i = 0; i < CHECK_STEPS; i++) if (stepBody(b, a, level, dyn)) return false;
    return true;
  };
  const root: Node = { b: start ? { ...start.b } : createBody(level), dyn: start ? cloneDynamics(start.dyn) : createDynamics(), steps: 0, action: -1, parent: null, fragile: false };
  let frontier: Node[] = [root];
  let maxX = root.b.x;
  const maxDecisions = Math.ceil((maxSeconds * 60) / HOLD_STEPS);
  for (let d = 0; d < maxDecisions && frontier.length; d++) {
    const next = new Map<string, Node>();
    let arrived: Node | null = null; // best node reaching the target this decision (robust preferred)
    for (const n of frontier) {
      for (let ai = 0; ai < ACTIONS.length; ai++) {
        const a = ACTIONS[ai]!;
        const b = { ...n.b };
        const dyn = cloneDynamics(n.dyn);
        let dead = false;
        for (let i = 0; i < HOLD_STEPS; i++) if (stepBody(b, a, level, dyn)) { dead = true; break; }
        if (dead) continue;
        const fragile = n.fragile || (robust && ai !== n.action && n.action >= 0
          && (!survivesLate(n, ai, ROBUST_LATE) || !survivesEarly(n, ai)));
        const node: Node = { b, dyn, steps: n.steps + HOLD_STEPS, action: ai, parent: n, fragile };
        if (b.x >= targetX) {
          if (!arrived || (arrived.fragile && !fragile)) arrived = node;
          continue;
        }
        maxX = Math.max(maxX, b.x);
        // Every node in a frontier shares the same run time, so the clock needs no place in the key.
        const key = `${Math.round(b.x * 4)},${Math.round(b.y * 4)},${Math.round(b.vx)},${Math.round(b.vy * 2)},${b.grounded ? 1 : 0},${b.prevJumpHeld ? 1 : 0},${dyn.crumbles.size}`;
        if (!next.has(key)) next.set(key, node);
      }
    }
    if (arrived) return { ok: true, seconds: arrived.steps / 60, maxX: arrived.b.x, plan: planOf(arrived, ACTIONS) };
    frontier = diverse([...next.values()], beam);
  }
  return { ok: false, seconds: Infinity, maxX, plan: [] };
}

function planOf(n: Node | null, ACTIONS: Control[]): Control[] {
  const out: Control[] = [];
  for (; n && n.action >= 0; n = n.parent) out.push(ACTIONS[n.action]!);
  return out.reverse();
}
