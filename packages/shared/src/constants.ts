/** Fixed simulation timestep (seconds). Physics never reads wall-clock time. */
export const DT = 1 / 60;
export const TICK_HZ = 60;
/** A state frame is broadcast every FRAME_EVERY sim steps (60/3 = 20 Hz). */
export const FRAME_EVERY = 3;
/** A voter counts as active if they pressed or held something within this window. */
export const ACTIVE_WINDOW_S = 3;
export const DEATH_FREEZE_S = 0.5;
export const DEATH_HOLD_S = 3;
export const SAMPLE_SLOTS = 128;
export const LEVEL_HEIGHT = 18;

const GRAVITY = 52;
export const PHYS = {
  gravity: GRAVITY,
  jumpVelocity: Math.sqrt(2 * GRAVITY * 3.2),
  jumpCutVelocity: 6,
  runSpeed: 7,
  accelGround: 45,
  accelAir: 0.7 * 45,
  halfW: 0.55,
  halfH: 0.6,
  maxFall: 22,
  coyoteS: 0.1,
  bufferS: 0.15,
} as const;

export const BLEND = {
  jumpOn: 0.3,
  jumpOff: 0.15,
  strainSlow: 0.2,
} as const;
