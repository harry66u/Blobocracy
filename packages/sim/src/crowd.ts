import {
  ACTIVE_WINDOW_S, BLEND, SAMPLE_SLOTS, cleanName, type SampleEntry, type VoteCounts, type WeightedCounts,
} from '@blobocracy/shared';

const IN_LEFT = 1, IN_RIGHT = 2, IN_JUMP = 4;
const DOT_NONE = 0, DOT_LEFT = 1, DOT_RIGHT = 2, DOT_EMPTY = 3;

interface Voter { bits: number; changedAt: number; jumpAt: number; everPressed: boolean; slot: number; remote: boolean; name?: string }

/** What the sim keeps from an edge relay's latest summary. */
export interface RelayCrowd { weighted: WeightedCounts; connections: number; sample: SampleEntry[] }
interface RelayEntry { weighted: WeightedCounts; connections: number; ids: Map<number, number>; /** Names of this relay's sampled players by sample id (as reported; applied when they hold a slot). */ names: Map<number, string> }

/** Voter id for a relay's sampled player: negative, so it never clashes with local ids. */
const remoteId = (relay: number, sid: number) => -(relay * 65536 + sid) - 1;

/**
 * Tracks every connected voter's input and decides who is "active".
 * Also owns the 128-slot crowd sample: each slotted voter keeps its slot
 * until it leaves, so its dot on everyone's screen stays the same dot.
 *
 * Players on edge relays arrive as per-relay summaries (`setRelay`): their already-weighted
 * counts are added to the local voters' counts, and each relay's sampled players hold crowd
 * slots like local voters do (they only feed the dots; their votes are in the counts).
 */
export class Voters {
  private voters = new Map<number, Voter>();
  private relays = new Map<number, RelayEntry>();
  private remoteVoters = 0;
  private slots: (number | null)[] = new Array(SAMPLE_SLOTS).fill(null);
  private unslotted = new Set<number>();
  private readonly dots = new Uint8Array(SAMPLE_SLOTS);
  private readonly dotJump = new Uint8Array(SAMPLE_SLOTS);

  join(id: number): void {
    if (this.voters.has(id)) return;
    this.voters.set(id, { bits: 0, changedAt: -Infinity, jumpAt: -Infinity, everPressed: false, slot: -1, remote: false });
    this.unslotted.add(id);
    this.fillSlots();
  }

  leave(id: number): void {
    const v = this.voters.get(id);
    if (!v) return;
    if (v.slot >= 0) this.slots[v.slot] = null;
    if (v.remote) this.remoteVoters--;
    this.voters.delete(id);
    this.unslotted.delete(id);
  }

  /** Bits: 1 left, 2 right, 4 jump. Unknown ids are ignored. */
  setInput(id: number, bits: number, nowS: number): void {
    const v = this.voters.get(id);
    if (!v || v.bits === bits) return;
    if (bits & IN_JUMP && !(v.bits & IN_JUMP)) v.jumpAt = nowS;
    v.bits = bits & 7;
    v.changedAt = nowS;
    if (bits) v.everPressed = true;
  }

  /** Replaces relay `relay`'s contribution with its latest summary. */
  setRelay(relay: number, s: RelayCrowd): void {
    let r = this.relays.get(relay);
    if (!r) { r = { weighted: s.weighted, connections: s.connections, ids: new Map(), names: new Map() }; this.relays.set(relay, r); }
    r.weighted = { ...s.weighted };
    r.connections = s.connections;
    const seen = new Set<number>();
    for (const e of s.sample) {
      seen.add(e.id);
      let id = r.ids.get(e.id);
      if (id === undefined) {
        id = remoteId(relay, e.id);
        r.ids.set(e.id, id);
        this.voters.set(id, { bits: e.bits & 7, changedAt: 0, jumpAt: 0, everPressed: true, slot: -1, remote: true });
        this.remoteVoters++;
        this.unslotted.add(id);
      } else {
        this.voters.get(id)!.bits = e.bits & 7;
      }
    }
    for (const [sid, id] of r.ids) {
      if (seen.has(sid)) continue;
      r.ids.delete(sid);
      this.leave(id);
    }
    this.fillSlots();
  }

  /** A local voter's chosen name (null clears it). Names are cleaned again here: nothing unchecked is ever shown. */
  setName(id: number, name: string | null): void {
    const v = this.voters.get(id);
    if (!v) return;
    const c = name === null ? null : cleanName(name);
    if (c === null) delete v.name; else v.name = c;
  }

  /** Replaces the names relay `relay` reports for its sampled players, keyed by sample id. */
  setRelayNames(relay: number, names: Record<string, unknown>): void {
    let r = this.relays.get(relay);
    if (!r) {
      r = { weighted: { left: 0, right: 0, jump: 0, active: 0, fresh: 0 }, connections: 0, ids: new Map(), names: new Map() };
      this.relays.set(relay, r);
    }
    const next = new Map<number, string>();
    let n = 0;
    for (const [k, raw] of Object.entries(names)) {
      if (++n > SAMPLE_SLOTS) break;
      const sid = Number(k);
      if (!Number.isInteger(sid) || sid < 0 || sid > 0xffff) continue;
      const c = cleanName(raw);
      if (c !== null) next.set(sid, c);
    }
    r.names = next;
  }

  /** [slot, name] for every crowd slot whose player has a name, lowest slot first. */
  slotNames(): [number, string][] {
    const out: [number, string][] = [];
    for (const v of this.voters.values()) if (!v.remote && v.name && v.slot >= 0) out.push([v.slot, v.name]);
    for (const r of this.relays.values()) {
      for (const [sid, id] of r.ids) {
        const name = r.names.get(sid);
        const slot = name === undefined ? -1 : this.voters.get(id)?.slot ?? -1;
        if (name !== undefined && slot >= 0) out.push([slot, name]);
      }
    }
    return out.sort((a, b) => a[0] - b[0]);
  }

  /** Forgets a relay (its link closed): its votes, players and dots go at once. */
  dropRelay(relay: number): void {
    const r = this.relays.get(relay);
    if (!r) return;
    for (const id of r.ids.values()) this.leave(id);
    this.relays.delete(relay);
  }

  /** The crowd slot of relay `relay`'s sampled player `sid`, or -1. */
  relaySlotOf(relay: number, sid: number): number {
    const id = this.relays.get(relay)?.ids.get(sid);
    return id === undefined ? -1 : this.slotOf(id);
  }

  /** Relay ids currently contributing. */
  relayIds(): number[] {
    return [...this.relays.keys()];
  }

  counts(nowS: number): VoteCounts {
    let left = 0, right = 0, jump = 0, active = 0, fresh = 0;
    for (const r of this.relays.values()) {
      const w = r.weighted;
      left += w.left; right += w.right; jump += w.jump; active += w.active; fresh += w.fresh;
    }
    for (const v of this.voters.values()) {
      if (v.remote || !this.isActive(v, nowS)) continue;
      active++;
      const l = v.bits & IN_LEFT, r = v.bits & IN_RIGHT;
      if (l && !r) left++;
      else if (r && !l) right++;
      if (v.bits & IN_JUMP) {
        jump++;
        if (nowS - v.jumpAt <= BLEND.freshS) fresh++;
      }
    }
    return { left, right, jump, active, fresh };
  }

  sample(): { dots: Uint8Array; dotJump: Uint8Array } {
    this.fillSlots();
    for (let i = 0; i < SAMPLE_SLOTS; i++) {
      const id = this.slots[i];
      const v = id == null ? undefined : this.voters.get(id);
      if (!v) { this.dots[i] = DOT_EMPTY; this.dotJump[i] = 0; continue; }
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

  /** Players online: local voters plus every relay's connections. */
  size(): number {
    let n = this.voters.size - this.remoteVoters;
    for (const r of this.relays.values()) n += r.connections;
    return n;
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
