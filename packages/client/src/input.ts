// Local input: keyboard and touch zones folded into the 3 input bits the server
// understands (1 = left, 2 = right, 4 = jump). Sends only when the bits change.

export const BIT_LEFT = 1;
export const BIT_RIGHT = 2;
export const BIT_JUMP = 4;

export type TouchZone = 'left' | 'right' | 'jump';

const KEY_BITS: Readonly<Record<string, number>> = {
  ArrowLeft: BIT_LEFT,
  KeyA: BIT_LEFT,
  ArrowRight: BIT_RIGHT,
  KeyD: BIT_RIGHT,
  ArrowUp: BIT_JUMP,
  KeyW: BIT_JUMP,
  Space: BIT_JUMP,
};

const ZONE_BITS: Readonly<Record<TouchZone, number>> = { left: BIT_LEFT, right: BIT_RIGHT, jump: BIT_JUMP };

/** True when `code` is one of the game's bound keys (callers use it to preventDefault). */
export function isGameKey(code: string): boolean {
  return KEY_BITS[code] !== undefined;
}

export class InputState {
  private readonly held = new Set<string>();
  private readonly zones: Record<TouchZone, boolean> = { left: false, right: false, jump: false };
  private current = 0;

  constructor(private readonly send: (bits: number) => void) {}

  get bits(): number {
    return this.current;
  }

  key(code: string, down: boolean): void {
    if (KEY_BITS[code] === undefined) return;
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.update();
  }

  touch(zone: TouchZone, down: boolean): void {
    this.zones[zone] = down;
    this.update();
  }

  releaseAll(): void {
    this.held.clear();
    this.zones.left = this.zones.right = this.zones.jump = false;
    this.update();
  }

  private update(): void {
    let b = 0;
    for (const code of this.held) b |= KEY_BITS[code] ?? 0;
    for (const z of ['left', 'right', 'jump'] as const) if (this.zones[z]) b |= ZONE_BITS[z];
    if (b === this.current) return;
    this.current = b;
    this.send(b);
  }
}
