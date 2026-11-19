import { describe, expect, test } from 'vitest';
import { createBody, stepBody, type Body, type Cause } from '../src/physics';
import { parseLevel, type Level } from '../src/level';
import type { Control } from '../src/blend';
import { PHYS } from '../src/constants';

/** A one-room level; `bottom` rows sit at the bottom of the 18-row room, empty rows above. */
function makeLevel(bottom: string[]): Level {
  const w = bottom[0]!.length;
  // Like real levels, keep the action above the pit line: 3 empty rows under the content.
  const top = Array.from({ length: 15 - bottom.length }, () => '.'.repeat(w));
  const under = Array.from({ length: 3 }, () => '.'.repeat(w));
  return parseLevel(1, 1, [{ name: 'Test', sky: 'blue', rooms: [[...top, ...bottom, ...under]] }]);
}

const IDLE: Control = { move: 0, jumpHeld: false };
const RIGHT: Control = { move: 1, jumpHeld: false };
const JUMP: Control = { move: 0, jumpHeld: true };

/** Ground top at y = 12, so a standing body has y = 11.4. */
const FLAT = makeLevel([
  '.@..........................G.',
  '##############################',
  '##############################',
  '##############################',
]);
const STAND_Y = 12 - PHYS.halfH;

function run(b: Body, level: Level, steps: number, c: Control | ((i: number, b: Body) => Control)) {
  const causes: (Cause | null)[] = [];
  for (let i = 0; i < steps; i++) causes.push(stepBody(b, typeof c === 'function' ? c(i, b) : c, level));
  return causes;
}

describe('createBody', () => {
  test('starts at the spawn, at rest and grounded', () => {
    const b = createBody(FLAT);
    expect(b.x).toBe(FLAT.spawn.x);
    expect(b.y).toBe(FLAT.spawn.y);
    expect(b.vx).toBe(0);
    expect(b.vy).toBe(0);
    expect(b.grounded).toBe(true);
    expect(b.landed).toBe(0);
  });
});

describe('ground movement', () => {
  test('standing still stays grounded for 120 steps', () => {
    const b = createBody(FLAT);
    for (let i = 0; i < 120; i++) {
      expect(stepBody(b, IDLE, FLAT)).toBeNull();
      expect(b.grounded).toBe(true);
      expect(b.landed).toBe(0);
    }
    expect(b.y).toBeCloseTo(STAND_Y, 9);
    expect(b.x).toBe(FLAT.spawn.x);
  });

  test('running right for 1 s reaches run speed', () => {
    const b = createBody(FLAT);
    run(b, FLAT, 60, RIGHT);
    expect(Math.abs(b.vx - PHYS.runSpeed)).toBeLessThan(0.1);
    expect(b.facing).toBe(1);
  });

  test('moving left faces left', () => {
    const b = createBody(FLAT);
    stepBody(b, { move: -1, jumpHeld: false }, FLAT);
    expect(b.facing).toBe(-1);
  });

  test('running into a wall at full speed stops at the wall without tunneling', () => {
    const level = makeLevel([
      '..........#.......G.',
      '..........#.........',
      '..........#.........',
      '..........#.........',
      '.@........#.........',
      '####################',
    ]);
    const b = createBody(level);
    let maxVx = 0;
    for (let i = 0; i < 120; i++) {
      stepBody(b, RIGHT, level);
      maxVx = Math.max(maxVx, b.vx);
      expect(b.x + PHYS.halfW).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(maxVx).toBeCloseTo(PHYS.runSpeed, 5);
    expect(b.vx).toBe(0);
    expect(b.x).toBeCloseTo(10 - PHYS.halfW, 9);
  });

  test('the left edge of the level is a wall', () => {
    const b = createBody(FLAT);
    run(b, FLAT, 60, { move: -1, jumpHeld: false });
    expect(b.x).toBeCloseTo(PHYS.halfW, 9);
    expect(b.vx).toBe(0);
  });
});

describe('jumping', () => {
  function apexOf(steps: (i: number) => Control): number {
    const b = createBody(FLAT);
    let minY = b.y;
    for (let i = 0; i < 120; i++) {
      stepBody(b, steps(i), FLAT);
      minY = Math.min(minY, b.y);
    }
    expect(b.grounded).toBe(true);
    return STAND_Y - minY;
  }

  test('holding jump from rest reaches 3.2 tiles', () => {
    const apex = apexOf(() => JUMP);
    expect(Math.abs(apex - 3.2)).toBeLessThanOrEqual(0.1);
  });

  test('tapping jump for one step gives a short hop', () => {
    const apex = apexOf((i) => (i === 0 ? JUMP : IDLE));
    expect(apex).toBeGreaterThanOrEqual(0.6);
    expect(apex).toBeLessThanOrEqual(1.4);
  });

  // Crowds release jump over a spread of ~100-200 ms, so height must grow evenly
  // with hold time instead of shooting up in the first frames.
  test('jump height grows evenly with how long jump is held', () => {
    const hold = (ms: number) => apexOf((i) => (i < Math.round(ms / 1000 * 60) ? JUMP : IDLE));
    const h100 = hold(100), h150 = hold(150), h200 = hold(200);
    expect(h100).toBeGreaterThan(1.6); expect(h100).toBeLessThan(2.1);
    expect(h150).toBeGreaterThan(2.1); expect(h150).toBeLessThan(2.6);
    expect(h200 - h150).toBeGreaterThan(0.3);
    expect(h200 - h150).toBeLessThan(0.6);
  });

  test('a tiny hop stays under 1.2 tiles so low ceilings are survivable', () => {
    expect(apexOf((i) => (i < 2 ? JUMP : IDLE))).toBeLessThan(1.2);
  });

  test('a fresh crowd press jumps again even while jump is still held', () => {
    const b = createBody(FLAT);
    run(b, FLAT, 120, JUMP);
    expect(b.grounded).toBe(true);
    stepBody(b, { move: 0, jumpHeld: true, jumpPressed: true }, FLAT);
    run(b, FLAT, 10, JUMP);
    expect(b.y).toBeLessThan(STAND_Y - 0.5);
  });

  test('holding jump through a landing does not jump again', () => {
    const b = createBody(FLAT);
    run(b, FLAT, 120, JUMP);
    expect(b.grounded).toBe(true);
    expect(b.vy).toBe(0);
  });

  /** Drops a body from 4 tiles up; returns the index of the step on which it lands. */
  function dropBody(): Body {
    const b = createBody(FLAT);
    b.y -= 4;
    b.grounded = false;
    b.coyote = 0;
    return b;
  }
  const landingStep = (() => {
    const b = dropBody();
    for (let i = 0; i < 200; i++) {
      stepBody(b, IDLE, FLAT);
      if (b.grounded) return i;
    }
    throw new Error('never landed');
  })();

  test('landing reports the impact speed for one step', () => {
    const b = dropBody();
    run(b, FLAT, landingStep, IDLE);
    expect(b.landed).toBe(0);
    stepBody(b, IDLE, FLAT);
    expect(b.grounded).toBe(true);
    expect(b.landed).toBeGreaterThan(5);
    stepBody(b, IDLE, FLAT);
    expect(b.landed).toBe(0);
  });

  test('jump pressed 5 steps (83 ms) before landing fires on landing (buffer)', () => {
    const b = dropBody();
    run(b, FLAT, landingStep + 2, (i) => (i >= landingStep - 5 ? JUMP : IDLE));
    expect(b.vy).toBeLessThan(0);
    expect(b.grounded).toBe(false);
  });

  // Crowds press early: a press up to a quarter second before landing still counts.
  test('jump pressed 12 steps (200 ms) before landing still fires on landing', () => {
    const b = dropBody();
    run(b, FLAT, landingStep + 2, (i) => (i >= landingStep - 12 ? JUMP : IDLE));
    expect(b.vy).toBeLessThan(0);
  });

  test('jump pressed 18 steps (300 ms) before landing is forgotten', () => {
    const b = dropBody();
    run(b, FLAT, landingStep + 2, (i) => (i >= landingStep - 18 ? JUMP : IDLE));
    expect(b.vy).toBe(0);
    expect(b.grounded).toBe(true);
  });

  describe('coyote time', () => {
    const LEDGE = makeLevel([
      '.@.......................G',
      '######....................',
      '..........................',
      '..........................',
      '..........................',
      '##########################',
    ]);
    const leftGroundStep = (() => {
      const b = createBody(LEDGE);
      for (let i = 0; i < 120; i++) {
        stepBody(b, RIGHT, LEDGE);
        if (!b.grounded) return i;
      }
      throw new Error('never left the ledge');
    })();

    function pressAfter(steps: number): Body {
      const b = createBody(LEDGE);
      const press = leftGroundStep + steps;
      run(b, LEDGE, press + 1, (i) => ({ move: 1, jumpHeld: i >= press }));
      return b;
    }

    test('jump 4 steps after walking off a ledge fires', () => {
      expect(pressAfter(4).vy).toBeLessThan(0);
    });

    test('jump 8 steps after walking off a ledge still fires (generous coyote time)', () => {
      expect(pressAfter(8).vy).toBeLessThan(0);
    });

    test('jump 12 steps after walking off a ledge does not fire', () => {
      expect(pressAfter(12).vy).toBeGreaterThan(0);
    });
  });

  test('in the air the blob steers as sharply as on the ground', () => {
    const b = createBody(FLAT);
    b.grounded = false;
    b.y = 6;
    b.vx = 0;
    stepBody(b, RIGHT, FLAT);
    expect(b.vx).toBeCloseTo(PHYS.accelGround / 60, 9);
  });

  test('hang time at the top of a jump: a full-speed jump clears a 6-tile gap and lands', () => {
    const level = makeLevel([
      '..@...........................G.........',
      '###############......###################',
      '###############......###################',
      '###############......###################',
    ]);
    const b = createBody(level);
    let jumped = false;
    for (let i = 0; i < 300; i++) {
      if (b.x >= 15) jumped = true;
      expect(stepBody(b, { move: 1, jumpHeld: jumped }, level)).toBeNull();
      if (jumped && b.grounded) break;
    }
    expect(b.grounded).toBe(true);
    expect(b.x).toBeGreaterThan(21);
  });

  test('a full-speed jump clears a 5-tile gap and lands', () => {
    const level = makeLevel([
      '..@...........................G.........',
      '###############.....####################',
      '###############.....####################',
      '###############.....####################',
    ]);
    const b = createBody(level);
    let jumped = false;
    for (let i = 0; i < 300; i++) {
      if (b.x >= 15) jumped = true;
      expect(stepBody(b, { move: 1, jumpHeld: jumped }, level)).toBeNull();
      if (jumped && b.grounded) break;
    }
    expect(b.grounded).toBe(true);
    expect(b.x).toBeGreaterThan(20);
    expect(b.y).toBeCloseTo(STAND_Y, 9);
  });
});

describe('one-way platforms', () => {
  const level = makeLevel([
    '..===.....G',
    '...........',
    '.@.........',
    '###########',
  ]);
  const PLATFORM_Y = 11 - PHYS.halfH;

  test('jumping up through one from below passes, then landing on it holds', () => {
    const b = createBody(level);
    b.x = 3.5;
    let minY = b.y;
    for (let i = 0; i < 120; i++) {
      stepBody(b, JUMP, level);
      minY = Math.min(minY, b.y);
    }
    expect(minY + PHYS.halfH).toBeLessThan(14);
    expect(b.grounded).toBe(true);
    expect(b.y).toBeCloseTo(PLATFORM_Y, 9);
  });

  test('dropping onto one from above holds', () => {
    const b = createBody(level);
    b.x = 3.5;
    b.y = 8;
    b.grounded = false;
    run(b, level, 120, IDLE);
    expect(b.grounded).toBe(true);
    expect(b.y).toBeCloseTo(PLATFORM_Y, 9);
  });

  test('does not block sideways movement', () => {
    const b = createBody(level);
    b.x = 1;
    b.y = 11.6; // overlaps the platform row
    b.vx = PHYS.runSpeed;
    b.grounded = false;
    run(b, level, 5, RIGHT);
    expect(b.x).toBeGreaterThan(1.5);
  });
});

describe('deaths', () => {
  test('touching floor spikes returns spikes', () => {
    const level = makeLevel([
      '.@....^...G',
      '###########',
    ]);
    const b = createBody(level);
    const causes = run(b, level, 120, RIGHT);
    const first = causes.findIndex((c) => c !== null);
    expect(first).toBeGreaterThan(0);
    expect(causes[first]).toBe('spikes');
  });

  test('spike hitboxes are inset, and the blob is a smaller target than it looks', () => {
    const level = makeLevel([
      '.@....^...G',
      '###########',
    ]);
    const b = createBody(level);
    // Grazing the spike's edge with the blob's side is safe: 0.3 of its width over the tile.
    b.x = 6 + 0.3 - PHYS.halfW;
    expect(stepBody(b, IDLE, level)).toBeNull();
    // Well over the middle of the spike still kills.
    b.x = 6 + 0.5 - PHYS.halfW + 0.2;
    expect(stepBody(b, IDLE, level)).toBe('spikes');
  });

  test('a blob that only just clips a spike with its underside survives', () => {
    const level = makeLevel([
      '.@....^...G',
      '###########',
    ]);
    const b = createBody(level);
    b.x = 6.5;
    b.grounded = false;
    b.vy = 0;
    // The spike sits in row 13 and fills the lower 60% of its tile, so its tip is at y = 13.4.
    b.y = 13.4 - PHYS.halfH + 0.1; // underside 0.1 into the tip
    expect(stepBody(b, IDLE, level)).toBeNull();
    b.x = 6.5;
    b.vy = 0;
    b.y = 13.4 - PHYS.halfH + 0.4; // underside 0.4 into the spike
    expect(stepBody(b, IDLE, level)).toBe('spikes');
  });

  test('touching ceiling spikes returns ceiling spikes', () => {
    const level = makeLevel([
      '.v........',
      '..........',
      '..........',
      '.@.......G',
      '##########',
    ]);
    const b = createBody(level);
    const causes = run(b, level, 60, JUMP);
    expect(causes.find((c) => c !== null)).toBe('ceiling spikes');
  });

  test('falling out of the level returns pit', () => {
    const level = makeLevel([
      '.@.......G',
      '....######',
    ]);
    const b = createBody(level);
    b.x = 1.5;
    b.grounded = false;
    const causes = run(b, level, 200, IDLE);
    const first = causes.findIndex((c) => c !== null);
    expect(causes[first]).toBe('pit');
    expect(first).toBeGreaterThan(0);
  });

  // The death freeze must show the blob in the pit, so a pit kills while it is still on screen.
  test('a pit kills while the blob is still visible, 2.5 rows above the bottom', () => {
    const level = makeLevel([
      '.@.......G',
      '....######',
    ]);
    const b = createBody(level);
    b.x = 1.5;
    b.grounded = false;
    for (let i = 0; i < 400; i++) {
      if (stepBody(b, IDLE, level) === 'pit') break;
    }
    expect(b.y).toBeLessThanOrEqual(level.height - 2.5 + 0.5);
    expect(b.y).toBeGreaterThan(level.height - 2.5);
  });
});

describe('determinism', () => {
  const level = makeLevel([
    '..........=====.........v.......G..',
    '...................................',
    '.....###...........^..........##...',
    '.@..............####.....=====.....',
    '#########.....#####################',
    '#########.....#####################',
  ]);

  /** Fixed pseudo-random control sequence (LCG), identical every call. */
  function controls(n: number): Control[] {
    let s = 12345;
    const out: Control[] = [];
    const moves = [-1, -0.6, 0, 0.6, 1];
    for (let i = 0; i < n; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      out.push({ move: moves[s % 5]!, jumpHeld: (s >>> 8) % 3 === 0 });
    }
    return out;
  }

  function simulate(): { body: Body; deaths: Cause[] } {
    let body = createBody(level);
    const deaths: Cause[] = [];
    for (const c of controls(3000)) {
      const cause = stepBody(body, c, level);
      if (cause) {
        deaths.push(cause);
        body = createBody(level);
      }
    }
    return { body, deaths };
  }

  const bits = (b: Body) => {
    const f = new Float64Array([b.x, b.y, b.vx, b.vy, b.coyote, b.buffer, b.landed, b.facing]);
    return [...new BigUint64Array(f.buffer)].concat([BigInt(b.grounded), BigInt(b.rising), BigInt(b.prevJumpHeld)]);
  };

  test('identical control sequences end in bit-identical bodies', () => {
    const a = simulate();
    const b = simulate();
    expect(bits(a.body)).toEqual(bits(b.body));
    expect(a.deaths).toEqual(b.deaths);
  });
});
