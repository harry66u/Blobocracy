import { ACTIVE_WINDOW_S, SAMPLE_SLOTS, type VoteCounts } from '@blobocracy/shared';

const IN_LEFT = 1, IN_RIGHT = 2, IN_JUMP = 4;
const DOT_NONE = 0, DOT_LEFT = 1, DOT_RIGHT = 2;

interface Voter { bits: number; changedAt: number; everPressed: boolean; slot: number }

/**
 * Tracks every connected voter's input and decides who is "active".
 * Also owns the 128-slot crowd sample: each slotted voter keeps its slot
 * until it leaves, so its dot on everyone's screen stays the same dot.
 */
export class Voters {
  private voters = new Map<number, Voter>();
  private slots: (number | null)[] = new Array(SAMPLE_SLOTS).fill(null);
  private unslotted = new Set<number>();
  private readonly dots = new Uint8Array(SAMPLE_SLOTS);
  private readonly dotJump = new Uint8Array(SAMPLE_SLOTS);

  join(id: number): void {
    if (this.voters.has(id)) return;
    this.voters.set(id, { bits: 0, changedAt: -Infinity, everPressed: false, slot: -1 });
    this.unslotted.add(id);
    this.fillSlots();
  }

  leave(id: number): void {
    const v = this.voters.get(id);
    if (!v) return;
    if (v.slot >= 0) this.slots[v.slot] = null;
    this.voters.delete(id);
    this.unslotted.delete(id);
  }

  /** Bits: 1 left, 2 right, 4 jump. Unknown ids are ignored. */
  setInput(id: number, bits: number, nowS: number): void {
    const v = this.voters.get(id);
    if (!v || v.bits === bits) return;
    v.bits = bits & 7;
    v.changedAt = nowS;
    if (bits) v.everPressed = true;
  }

  counts(nowS: number): VoteCounts {
    let left = 0, right = 0, jump = 0, active = 0;
    for (const v of this.voters.values()) {
      if (!this.isActive(v, nowS)) continue;
      active++;
      const l = v.bits & IN_LEFT, r = v.bits & IN_RIGHT;
      if (l && !r) left++;
      else if (r && !l) right++;
      if (v.bits & IN_JUMP) jump++;
    }
    return { left, right, jump, active };
  }

  sample(): { dots: Uint8Array; dotJump: Uint8Array } {
    this.fillSlots();
    for (let i = 0; i < SAMPLE_SLOTS; i++) {
      const id = this.slots[i];
      const v = id == null ? undefined : this.voters.get(id);
      if (!v) { this.dots[i] = DOT_NONE; this.dotJump[i] = 0; continue; }
      const l = v.bits & IN_LEFT, r = v.bits & IN_RIGHT;
      this.dots[i] = l && !r ? DOT_LEFT : r && !l ? DOT_RIGHT : DOT_NONE;
      this.dotJump[i] = v.bits & IN_JUMP ? 1 : 0;
    }
    return { dots: this.dots, dotJump: this.dotJump };
  }

  /** The slot index this voter's dot occupies, or -1. */
  slotOf(id: number): number {
    return this.voters.get(id)?.slot ?? -1;
  }

  size(): number {
    return this.voters.size;
  }

  private isActive(v: Voter, nowS: number): boolean {
    if (!v.everPressed) return false;
    return v.bits !== 0 || nowS - v.changedAt <= ACTIVE_WINDOW_S;
  }

  private fillSlots(): void {
    if (this.unslotted.size === 0) return;
    for (let i = 0; i < SAMPLE_SLOTS && this.unslotted.size > 0; i++) {
      if (this.slots[i] != null) continue;
      const next = this.unslotted.values().next().value as number;
      this.unslotted.delete(next);
      this.slots[i] = next;
      this.voters.get(next)!.slot = i;
    }
  }
}
