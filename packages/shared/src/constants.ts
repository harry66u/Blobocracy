/** Fixed simulation timestep (seconds). Physics never reads wall-clock time. */
export const DT = 1 / 60;
export const TICK_HZ = 60;
/** A state frame is broadcast every FRAME_EVERY sim steps (60/3 = 20 Hz). */
export const FRAME_EVERY = 3;
/** A voter counts as active if they pressed or held something within this window. */
export const ACTIVE_WINDOW_S = 3;
export const DEATH_FREEZE_S = 0.5;
export const DEATH_HOLD_S = 3;
/** After a win: the whole world celebrates this long (inputs ignored), then the next level unlocks. */
export const CELEBRATE_S = 25;
/** Track ids at or above this are encores: the last level replayed with its own counters (track = ENCORE_TRACK + level id). */
export const ENCORE_TRACK = 1000;
export const SAMPLE_SLOTS = 128;
export const LEVEL_HEIGHT = 18;

const GRAVITY = 52;
export const PHYS = {
  gravity: GRAVITY,
  jumpVelocity: Math.sqrt(2 * GRAVITY * 3.2),
  jumpCutVelocity: 6,
  runSpeed: 7,
  accelGround: 45,
  /** Full grip in the air, so steering a landing is as sharp as on the ground. */
  accelAir: 45,
  halfW: 0.55,
  halfH: 0.6,
  maxFall: 22,
  coyoteS: 0.15,
  bufferS: 0.25,
  /** Launch speed off a spring: the bounce peaks about 5.5 tiles up, whatever jump is doing. */
  springVelocity: Math.sqrt(2 * GRAVITY * 5.5),
  /** Added to the target run speed while grounded on a conveyor (tiles/s). */
  conveyorSpeed: 3,
} as const;

export const BLEND = {
  jumpOn: 0.3,
  jumpOff: 0.15,
  strainSlow: 0.2,
  /** move = sign(pull)·|pull|^moveCurve, so a clear majority moves briskly. */
  moveCurve: 0.6,
  /** A jump press counts as part of a fresh burst for this long. */
  freshS: 0.25,
} as const;
