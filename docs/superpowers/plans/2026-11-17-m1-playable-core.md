# Blobocracy Milestone 1: Playable Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A playable Blobocracy in the browser: one server simulates the shared blob through zones 1 and 2, any number of browser tabs (keyboard or touch) steer it together, and an in-process virtual crowd makes it look like thousands are playing.

**Architecture:** npm-workspaces monorepo. `packages/shared` holds deterministic physics, blending, level parsing and the wire protocol, used by both server and client. `packages/sim` runs the authoritative 60 Hz world and, for this milestone only, also accepts browser WebSockets directly through a `LocalRelay` (milestone 4 moves that into separate edge relays behind the same `Relay` interface). `packages/client` is a Vite app with a hand-written Canvas 2D renderer in the playful cartoon style.

**Tech Stack:** Node 22, TypeScript 5.9 (strict, ESM), uWebSockets.js v20.52.0 (installed from GitHub: `uNetworking/uWebSockets.js#v20.52.0`), tsx, Vitest 5, Vite 8, Playwright (preinstalled) for screenshots.

**Spec:** `docs/superpowers/specs/2026-11-17-blobocracy-design.md` (read §5, §6.1–6.5, §7, §12). Visual reference: `design/mockups/mockup.html` and `design/mockups/board-cartoon.png`. The mockup's drawing code is the reference for shapes, proportions and colors.

## Global Constraints

- Coordinates: world units are tiles; x grows right, y grows **down**; row 0 is the top. Levels are 18 rows tall. Falling below row 18 is a pit death.
- Physics is deterministic: fixed step `DT = 1/60`, no `Date.now()` or `Math.random()` inside `packages/shared`.
- Sim steps at 60 Hz; state frames are broadcast every 3rd step (20 Hz).
- Active voter = a connection whose input changed or was held non-zero within the last 3 s.
- Blending (spec §7): `pull = (R − L) / max(A, 1)`, `pressure = J / max(A, 1)`, jump held turns on at pressure ≥ 0.30 and off below 0.15, coyote time 100 ms, jump buffer 150 ms.
- Physics starting values (spec §6.1): run speed 7 tiles/s, air control 70%, full jump 3.2 tiles high, short hop ≈1.2 tiles, hitbox 1.1 wide × 1.2 tall.
- World pauses (run clock stops) whenever there are zero active voters. A lone player has full control.
- Death: freeze 0.5 s, then the death card holds for 3 s, then reset to spawn. The death count goes up at the moment of death.
- Colors (from the mockup): ink `#2A1B3D`, cream `#FFF1D6`, cream shade `#F2D8AE`, cream highlight `#FFFBF1`, hazard `#FF3B7A`, hazard dark `#D61F5C`, blob `#FFD21F`, blob shade `#F2B300`, crowd dots `#FFFFFF`. Skies: zone 1–2 blue `#5FBFFF`→`#CDEFFF`, hills `#A9DDF7`/`#86CBEF`; zone 3–4 sunset `#FF7E5F`→`#FFD49A`, hills `#F8A877`/`#EC8662`; zone 5–6 purple `#2B1655`→`#8A4DB3`, hills `#5E3592`/`#472476`, HUD text `#FFF3DC` on purple, `#2A1B3D` elsewhere.
- Fonts: Bagel Fat One (counter, headings, banners) and Atkinson Hyperlegible Next 400/600/700/800 (all other text), self-hosted woff2 under `packages/client/public/fonts/` with their OFL license files.
- UI copy is sentence case: "deaths", "playing now", "Record 83%", "run 3,940". Numbers use `toLocaleString('en-US')`.
- The server never trusts a client for anything but its 3 input bits.

## Review Focus

1. **Phone app-switch or tab hidden while holding a button**: the player's input must drop to nothing (the client sends 0 bits on `blur`/`visibilitychange`), and on return the client snaps to the latest frame instead of fast-forwarding. Test in Task 9.
2. **Two thumbs at once on touch**: holding right with one thumb while tapping jump with the other registers both; sliding a finger from the left button onto the right button switches direction without lifting. Test in Task 9.
3. **Cellular drop**: when the socket closes, the server forgets that connection's vote immediately; the client shows a reconnecting state and retries with backoff (0.5 s doubling to 8 s). Tests in Tasks 7 and 9.
4. **Garbage or oversized messages from a client**: the server ignores any message that is not exactly a valid input or ping, never throws, and closes connections that send more than 64 bytes in one message. Test in Task 7.
5. **Resize or rotate mid-game**: canvas re-layouts at the new size and device pixel ratio with no blur, and the camera doesn't jump. Test in Task 10.

---

## File Structure

```
package.json, tsconfig.base.json, vitest.config.ts, .gitignore, .nvmrc
packages/shared/src/
  constants.ts      DT, PHYS, BLEND, timing constants
  level.ts          tile codes, Level type, parseLevel(), tileAt(), zoneAt(), progressOf()
  levels/level1.ts  zone 1 and 2 room ASCII, exported LEVEL1
  physics.ts        Body, Control, createBody(), stepBody()
  blend.ts          VoteCounts, BlendState, blend()
  protocol.ts       message types, encode/decode for input, ping, state frame; event JSON types
  index.ts          re-exports
packages/shared/test/  level.test.ts, physics.test.ts, blend.test.ts, protocol.test.ts, level1.test.ts
packages/sim/src/
  world.ts          World: run lifecycle, deaths, zones, record, pause
  crowd.ts          Voters: per-connection input tracking, active window, 128-slot sample
  virtual.ts        VirtualCrowd: fake voters for testing feel and looks
  relay.ts          Relay interface + LocalRelay (uWS server for browsers)
  server.ts         startServer(opts): wires World + Voters + relays + loop
  main.ts           CLI entry (env: PORT, VIRTUAL_PLAYERS)
packages/sim/test/  world.test.ts, crowd.test.ts, server.test.ts
packages/client/
  index.html, vite.config.ts, public/fonts/*
  src/main.ts, src/net.ts, src/input.ts, src/predict.ts, src/layout.ts
  src/render/palette.ts, background.ts, level.ts, blob.ts, crowd.ts, hud.ts, touch.ts, frame.ts
packages/client/test/   predict.test.ts, input.test.ts, layout.test.ts
tools/screenshot.ts     Playwright: desktop + phone PNGs of the running game
```

---

### Task 1: Monorepo scaffold

**Files:** Create `package.json` (workspaces `packages/*`; scripts `test`, `typecheck`, `dev:server`, `dev:client`, `dev` running both), `tsconfig.base.json` (strict, ES2022, moduleResolution bundler, noUncheckedIndexedAccess), `vitest.config.ts` (projects for each package), `.gitignore` (node_modules, dist, *.png under `tools/out/`), `.nvmrc` (`22`), `packages/{shared,sim,client}/package.json` + `tsconfig.json`. `@blobocracy/shared` is consumed by sim and client as a workspace dependency via its TypeScript source (`"exports": "./src/index.ts"`).

- [ ] **Step 1:** Write `packages/shared/test/smoke.test.ts` asserting `import { DT } from '../src/index'` gives `1/60`.
- [ ] **Step 2:** Run `npm test`. Expected: FAIL (module missing).
- [ ] **Step 3:** Create the files above and `packages/shared/src/constants.ts` exporting `DT = 1/60`, `TICK_HZ = 60`, `FRAME_EVERY = 3`, `ACTIVE_WINDOW_S = 3`, `DEATH_FREEZE_S = 0.5`, `DEATH_HOLD_S = 3`, `SAMPLE_SLOTS = 128`, plus `PHYS` and `BLEND` objects with the Global Constraints values (`PHYS.gravity = 52`, `PHYS.jumpVelocity = Math.sqrt(2*52*3.2)`, `PHYS.jumpCutVelocity = 6`, `PHYS.runSpeed = 7`, `PHYS.accelGround = 45`, `PHYS.accelAir = 0.7*45`, `PHYS.halfW = 0.55`, `PHYS.halfH = 0.6`, `PHYS.maxFall = 22`, `PHYS.coyoteS = 0.1`, `PHYS.bufferS = 0.15`; `BLEND.jumpOn = 0.3`, `BLEND.jumpOff = 0.15`, `BLEND.strainSlow = 0.2`). Install deps: typescript@5.9, tsx, vitest@5, vite@8, uWebSockets.js from the GitHub tag.
- [ ] **Step 4:** Run `npm test` and `npm run typecheck`. Expected: PASS, no type errors.
- [ ] **Step 5:** Commit `chore: scaffold monorepo`.

### Task 2: Level format

**Files:** Create `packages/shared/src/level.ts`; Test `packages/shared/test/level.test.ts`.

**Interfaces — Produces:**
```ts
export const T_EMPTY = 0, T_SOLID = 1, T_ONEWAY = 2, T_SPIKE_UP = 3, T_SPIKE_DOWN = 4;
export type Sky = 'blue' | 'sunset' | 'purple';
export interface ZoneDef { name: string; sky: Sky; rooms: string[][] }   // each room: 18 equal-length rows
export interface Zone { index: number; name: string; sky: Sky; startX: number; endX: number }
export interface Level { id: number; version: number; width: number; height: 18; tiles: Uint8Array; zones: Zone[]; spawn: { x: number; y: number }; goalX: number }
export function parseLevel(id: number, version: number, zones: ZoneDef[]): Level
export function tileAt(level: Level, tx: number, ty: number): number   // out of bounds: x<0 → SOLID wall, y<0 → EMPTY, y≥18 → EMPTY, x≥width → SOLID
export function zoneAt(level: Level, x: number): Zone
export function progressOf(level: Level, x: number): number            // (x − spawn.x)/(goalX − spawn.x) clamped 0..1
```
Characters: `#` solid, `=` one-way, `^` floor spike, `v` ceiling spike, `.` or space empty, `@` spawn (exactly one, in the first room; spawn is the tile's bottom-center minus `PHYS.halfH`), `G` goal column (exactly one, in the last room).

- [ ] **Step 1:** Write tests: a 2-room level of widths 5 and 7 parses to width 12 with zone `startX`/`endX` 0/12; `tileAt` returns the right codes for each character; `@` sets spawn `{x: col+0.5, y: row+1−0.6}`; `G` sets `goalX`; rows of unequal length throw `/room \d+ row \d+/`; a level with zero or two `@` throws; out-of-bounds rules as in the signature; `progressOf` at spawn is 0 and at goal is 1.
- [ ] **Step 2:** Run `npx vitest run packages/shared/test/level.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement per the signatures.
- [ ] **Step 4:** Run it. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): ASCII level format`.

### Task 3: Blending

**Files:** Create `packages/shared/src/blend.ts`; Test `packages/shared/test/blend.test.ts`.

**Interfaces — Produces:**
```ts
export interface VoteCounts { left: number; right: number; jump: number; active: number }  // weighted; a voter holding L+R counts in neither
export interface Control { move: number; jumpHeld: boolean }                                // move in −1..1, already slowed by strain
export interface BlendOut extends Control { pull: number; pressure: number; strain: number }
export function blend(v: VoteCounts, prevJumpHeld: boolean): BlendOut
```
`strain = min(1, 2*min(L,R)/max(A,1))`; `move = pull * (1 − BLEND.strainSlow*strain)`; jump hysteresis per Global Constraints.

- [ ] **Step 1:** Write tests: one voter holding right → `move 1, pull 1`; one holding left+jump → `move −1, jumpHeld true`; 2 voters opposite → `pull 0, strain 1, move 0`; 10 active with 6 right → `pull 0.6`; 0 active → `pull 0, pressure 0, jumpHeld false`; pressure 0.25 with prev false → false, with prev true → true; pressure 0.14 with prev true → false; `pull` is clamped to −1..1 even if counts exceed `active`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): input blending`.

### Task 4: Physics

**Files:** Create `packages/shared/src/physics.ts`; Test `packages/shared/test/physics.test.ts`.

**Interfaces — Consumes:** `Level`, `tileAt`, `Control`, `PHYS`, `DT`. **Produces:**
```ts
export type Cause = 'spikes' | 'ceiling spikes' | 'pit';
export interface Body { x: number; y: number; vx: number; vy: number; grounded: boolean; coyote: number; buffer: number; rising: boolean; prevJumpHeld: boolean; facing: 1 | -1; landed: number }  // landed: impact speed on the step it landed, else 0
export function createBody(level: Level): Body
export function stepBody(b: Body, c: Control, level: Level): Cause | null   // mutates b, advances exactly DT
```
Approach: axis-separated AABB vs tile grid (move x, resolve; move y, resolve). One-way tiles collide only when falling and the body's previous bottom was at or above the tile top. Spike hitboxes are inset: a floor spike kills when the body's AABB overlaps the lower 60% of the tile and the middle 70% horizontally; ceiling spikes mirrored. Rising edge of `jumpHeld` sets `buffer = bufferS`; a jump fires when `buffer > 0` and (`grounded` or `coyote > 0`); while `rising` and `!jumpHeld`, `vy = max(vy, −jumpCutVelocity)`. `y − halfH > 18` → `'pit'`.

- [ ] **Step 1:** Write tests against small hand-made levels: standing still stays grounded for 120 steps; `move 1` for 1 s on flat ground reaches `vx` within 0.1 of 7; holding jump from rest reaches apex height 3.2 ± 0.1 tiles; tapping jump for 1 step gives apex 0.6–1.4 tiles; jump pressed 5 steps (83 ms) before landing still fires on landing (buffer); jump pressed 4 steps after walking off a ledge fires (coyote), 8 steps after does not; running into a wall stops `vx` at 0 without tunneling at max speed; landing on `=` from above holds, jumping up through it from below passes; touching `^` returns `'spikes'`, `v` returns `'ceiling spikes'`, falling out returns `'pit'`; a full-speed jump clears a 5-tile gap and lands; two runs with identical control sequences end in bit-identical bodies.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS. Adjust `PHYS` constants only if the jump-distance test fails (spec target: ~6 tiles long at speed).
- [ ] **Step 5:** Commit `feat(shared): deterministic platformer physics`.

### Task 5: Wire protocol

**Files:** Create `packages/shared/src/protocol.ts`; Test `packages/shared/test/protocol.test.ts`.

**Interfaces — Produces:**
```ts
export const MSG_INPUT = 1, MSG_PING = 2, MSG_STATE = 10, MSG_PONG = 12;
export const IN_LEFT = 1, IN_RIGHT = 2, IN_JUMP = 4;
export function encodeInput(bits: number): Uint8Array                 // [1, bits]
export function encodePing(t: number): Uint8Array                     // [2, u32 t]
export function decodeClient(buf: ArrayBuffer): { type: 'input'; bits: number } | { type: 'ping'; t: number } | null  // null for anything malformed
export function encodePong(t: number): Uint8Array
export const DOT_NONE = 0, DOT_LEFT = 1, DOT_RIGHT = 2;
export interface StateFrame { tick: number; run: number; x: number; y: number; vx: number; vy: number; grounded: boolean; facing: 1 | -1; phase: 'running' | 'dying' | 'paused'; pull: number; pressure: number; strain: number; jumpHeld: boolean; online: number; active: number; dots: Uint8Array /* per slot DOT_* */; dotJump: Uint8Array /* per slot 0/1 */ }
export function encodeState(f: StateFrame): Uint8Array
export function decodeServer(buf: ArrayBuffer): StateFrame | { type: 'pong'; t: number } | null
export type ServerEvent =
  | { t: 'welcome'; levelId: number; version: number; deaths: number; record: { progress: number; run: number } | null; run: number; zone: number; online: number }
  | { t: 'death'; run: number; cause: Cause; progress: number; deaths: number; zone: number; nearRecord: boolean }
  | { t: 'zone'; run: number; index: number; name: string }
  | { t: 'record'; run: number; progress: number }
  | { t: 'reset'; run: number };
```
Binary state layout (little-endian): u8 type, u32 tick, u32 run, f32 x, f32 y, f32 vx, f32 vy, u8 flags (bit0 grounded, bit1 facing right, bit2 jumpHeld, bits3–4 phase), i8 pull×127, u8 pressure×255, u8 strain×255, u32 online, u32 active, u8 slotCount, then `ceil(n/4)` bytes of 2-bit dot codes, then `ceil(n/8)` bytes of jump bits. Events are JSON text frames.

- [ ] **Step 1:** Write tests: input/ping/pong round-trip; `decodeClient` returns null for empty buffer, unknown type, wrong length, bits > 7; a state frame with 128 slots round-trips (floats exact, pull/pressure/strain within 1/127) and encodes to ≤ 90 bytes; 0 slots round-trips.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(shared): binary wire protocol`.

### Task 6: World (run lifecycle)

**Files:** Create `packages/sim/src/world.ts`; Test `packages/sim/test/world.test.ts`.

**Interfaces — Consumes:** `Level`, `Body`, `stepBody`, `blend`, `VoteCounts`, `ServerEvent`, `progressOf`, `zoneAt`. **Produces:**
```ts
export interface WorldInit { deaths: number; record: { progress: number; run: number } | null }
export class World {
  constructor(level: Level, init?: WorldInit);
  readonly level: Level;
  tick: number; run: number; deaths: number; phase: 'running' | 'dying' | 'paused';
  body: Body; lastBlend: BlendOut; record: { progress: number; run: number } | null; maxProgress: number; zone: number;
  step(votes: VoteCounts): ServerEvent[];   // advances one DT
  welcome(online: number): ServerEvent;
}
```
Rules: `run = deaths + 1`. With `votes.active === 0` while running, phase becomes `paused` and nothing advances except `tick`; it resumes on the first step with active voters. On death: emit `death` (with `nearRecord = record !== null && progress ≥ record.progress − 0.05`), increment `deaths`, update `record` and emit `record` if this run beat it, enter `dying`; after `DEATH_FREEZE_S + DEATH_HOLD_S`, reset body, `run++`, zone 0, emit `reset`. Crossing into a zone index higher than this run's max emits `zone`. Reaching `goalX` is out of scope for M1 (the zone 2 end has a wall; the win comes in milestone 7).

- [ ] **Step 1:** Write tests with a tiny level (flat floor, pit at x=10, second zone starting at x=6): with zero active voters, 600 steps leave the body unchanged and phase `paused`; one voter holding right reaches zone 2 (one `zone` event with index 1) and then dies in the pit (one `death` event, cause `pit`, deaths 1, record set, a `record` event); during the next `(0.5+3)*60 − 1` steps the body doesn't move and phase is `dying`; the step after emits `reset` with run 2 and the body is at spawn; a second death at lower progress emits no `record` event and `nearRecord` follows the 5% rule; `World` constructed with `{deaths: 41, record: …}` starts at run 42.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(sim): world run lifecycle`.

### Task 7: Voters, virtual crowd, server

**Files:** Create `packages/sim/src/crowd.ts`, `virtual.ts`, `relay.ts`, `server.ts`, `main.ts`; Test `packages/sim/test/crowd.test.ts`, `server.test.ts`.

**Interfaces — Produces:**
```ts
// crowd.ts
export class Voters {
  join(id: number): void; leave(id: number): void;
  setInput(id: number, bits: number, nowS: number): void;   // bits with both L and R count as neither direction
  counts(nowS: number): VoteCounts;                         // active = changed or non-zero within ACTIVE_WINDOW_S
  sample(): { dots: Uint8Array; dotJump: Uint8Array };       // SAMPLE_SLOTS long; a voter keeps its slot until it leaves; free slots go to unslotted voters
  size(): number;
}
// virtual.ts
export class VirtualCrowd { constructor(voters: Voters, count: number, seed: number); update(nowS: number, world: World): void }
// relay.ts
export interface Relay { broadcast(frame: Uint8Array): void; broadcastEvent(e: ServerEvent): void; close(): Promise<void> }
export function startLocalRelay(opts: { port: number; voters: Voters; world: World; clock: () => number }): Promise<Relay & { port: number }>
// server.ts
export function startServer(opts: { port: number; virtualPlayers: number; level?: Level }): Promise<{ port: number; world: World; stop(): Promise<void> }>
```
`VirtualCrowd` (seeded, uses its own PRNG): 60% of fake voters lean toward the right, 25% left, the rest idle; each re-rolls its intent every 0.4–2.5 s; when the blob is within 3 tiles before a spike or gap, each follower presses jump with a random 150–400 ms delay and holds 150–500 ms. Virtual voters occupy sample slots like real ones. `LocalRelay` serves `/ws`, sends `welcome` on open, ignores malformed messages via `decodeClient`, closes a socket whose message exceeds 64 bytes (uWS `maxPayloadLength: 64`), answers pings, and drops the socket's vote on close. Loop: `setInterval`-driven accumulator stepping `World` at 60 Hz with `Voters.counts()`; every 3rd step, `encodeState` once and `broadcast`. `main.ts` reads `PORT` (default 8080) and `VIRTUAL_PLAYERS` (default 0).

- [ ] **Step 1:** Write `crowd.test.ts`: L+R bits count as neither; a voter who last changed input 3.1 s ago with bits 0 is not active, with bits 2 is active; slots are stable across `setInput` calls; after `leave`, its slot is freed and the next unslotted voter gets it; 200 voters fill exactly 128 slots.
- [ ] **Step 2:** Write `server.test.ts` (uses Node's global `WebSocket` against `startServer({port: 0, virtualPlayers: 0})`): the first message is a `welcome` JSON with `deaths: 0`; after sending `encodeInput(IN_RIGHT)`, a state frame within 500 ms shows `active: 1` and `pull > 0.9`, and within 2 s the body's x has increased; sending 100 random bytes, an empty message and a 1 KB message never crashes the server (a second client still receives frames) and the 1 KB sender is disconnected; closing the client makes the next frames show `active: 0` and `phase: 'paused'`.
- [ ] **Step 3:** Run both. Expected: FAIL.
- [ ] **Step 4:** Implement.
- [ ] **Step 5:** Run both. Expected: PASS.
- [ ] **Step 6:** Commit `feat(sim): voters, virtual crowd, local relay and server loop`.

### Task 8: Level 1, zones 1 and 2

**Files:** Create `packages/shared/src/levels/level1.ts`; Test `packages/shared/test/level1.test.ts`.

**Interfaces — Produces:** `export const LEVEL1: Level` (id 1, version 1), built from two `ZoneDef`s: `{ name: 'Welcome Mat', sky: 'blue' }` and `{ name: 'Pointy Meadow', sky: 'blue' }`. Milestone 2 appends zones 3 to 6.

Design (spec §6.3): ground near row 13. Zone 1, about 75 s for a perfect run and roughly 300 columns: flat start with 12 safe columns, then single gaps of 2–3, single spikes, double spikes, a raised step of 2, gaps of 4, a short one-way platform hop, and the "Leap of Faith" (a 5-wide gap with a landing 1 tile lower), then 10 safe columns. Zone 2, about 90 s and roughly 380 columns: spike fields of 3–4 with landing islands, the first ceiling spikes (a corridor with ceiling spikes at row 9 over a gap, so only short hops survive), a staircase of narrow 2-wide pillars, and "The Haircut" (a 20-column corridor with ceiling spikes 3 rows above the floor and three floor gaps of 2), then 10 safe columns and a closing wall (M1 only). Each room is 30–80 columns and has a comment naming its intent.

- [ ] **Step 1:** Write `level1.test.ts`: `LEVEL1` parses; zone names and order as above; widths 280–320 and 360–400; and a **beatability lint** over each column range: no gap wider than 5, no rise steeper than 3 rows within one jump, no spike run wider than 4 without a landing tile before it, and no ceiling spike lower than 3 rows above the floor beneath it. Also a scripted test: a hand-written control script (array of `[seconds, move, jumpHeld]`) drives `stepBody` from spawn to the end of zone 1 without dying. Generate the script by hand while authoring; it is replaced by the solver in milestone 2.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Author the rooms and the script.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Commit `feat(levels): level 1 zones 1 and 2`.

### Task 9: Client networking, input and prediction

**Files:** Create `packages/client/index.html`, `vite.config.ts` (dev proxy `/ws` → `ws://localhost:8080`), `src/net.ts`, `src/input.ts`, `src/predict.ts`; Test `packages/client/test/input.test.ts`, `predict.test.ts`.

**Interfaces — Produces:**
```ts
// net.ts
export interface NetState { connected: boolean; latest: StateFrame | null; latestAt: number; rttMs: number; welcome: ServerEvent | null }
export function connect(url: string, onEvent: (e: ServerEvent) => void): { state: NetState; sendInput(bits: number): void; close(): void }  // auto-reconnect: 0.5 s doubling to 8 s; ping every 2 s
// input.ts
export class InputState { constructor(send: (bits: number) => void); key(code: string, down: boolean): void; touch(zone: 'left' | 'right' | 'jump', down: boolean): void; releaseAll(): void; readonly bits: number }  // sends only on change; ArrowLeft/KeyA, ArrowRight/KeyD, ArrowUp/KeyW/Space
// predict.ts
export function predict(frame: StateFrame, level: Level, aheadS: number): Body   // runs stepBody forward with the frame's control, at most 0.15 s; returns frame state unchanged when phase ≠ 'running'
export function smooth(prev: { x: number; y: number }, target: { x: number; y: number }, dtS: number): { x: number; y: number }  // exponential correction, half-life 60 ms; snaps if distance > 3 tiles
```
- [ ] **Step 1:** Write `input.test.ts`: right key down sends `2`, plus jump sends `6`, releasing right sends `4`; repeated keydown events don't resend; touch `left` down then `right` down (finger slid) then `left` up sends `1`, `3`, `2` — **two zones held at once** both count; `releaseAll()` sends `0` once.
- [ ] **Step 2:** Write `predict.test.ts`: predicting 0.1 s on flat ground with `pull 1` moves x forward by about `vx*0.1`; predicting from a `dying` frame returns it unchanged; `aheadS` 0.5 is clamped to 0.15; `smooth` snaps at 4 tiles and closes half the gap in 60 ms.
- [ ] **Step 3:** Run. Expected: FAIL.
- [ ] **Step 4:** Implement. In `main.ts` (Task 10) wire `window` `blur` and `visibilitychange`(hidden) to `releaseAll()`, and on becoming visible drop any interpolation state so the next frame snaps.
- [ ] **Step 5:** Run. Expected: PASS.
- [ ] **Step 6:** Commit `feat(client): networking, input and prediction`.

### Task 10: Renderer, HUD and touch controls

**Files:** Create `packages/client/src/layout.ts`, `src/main.ts`, `src/render/palette.ts`, `background.ts`, `level.ts`, `blob.ts`, `crowd.ts`, `hud.ts`, `touch.ts`, `frame.ts`; fonts in `public/fonts/`; Test `packages/client/test/layout.test.ts`; Create `tools/screenshot.ts`.

**Interfaces — Produces:**
```ts
// layout.ts
export interface Layout { w: number; h: number; dpr: number; tile: number; groundY: number; lookAhead: number; phone: boolean }
export function computeLayout(w: number, h: number, dpr: number): Layout   // phone = h > w*1.15; desktop tile = h/16; phone tile = w/10.3, groundY = 0.715h, lookAhead 3.4 tiles; desktop groundY = 0.733h, lookAhead 9.6 tiles
export function camera(layout: Layout, focus: { x: number; y: number }, prev: { x: number; y: number } | null, dtS: number): { x: number; y: number }   // left edge in tiles; eased follow
```
Rendering matches the mockup (`design/mockups/mockup.html`), ported from SVG to Canvas 2D: sky gradient + parallax hills + clouds per zone sky; cream rounded platforms with thick ink outline, shade band, highlight lip and speckles, pre-rendered once per level into offscreen canvas chunks 32 tiles wide; pink spikes with ink outline and glint; the blob (body, shade, highlight, eyes whose pupils follow `pull`, worried brows and "o" mouth when a spike, ceiling spike or gap is within 3 tiles ahead; full squash/stretch and blinking come in milestone 3); crowd dots per slot leaning toward their input with the tail polygon, each slot with a stable home offset derived from its index (left-pushers settle left of the blob, right-pushers right, jumpers higher), easing toward home; your own dot drawn locally from `InputState.bits`, yellow with ring and "you" tag; HUD exactly as the mockup: flip-card counter (cards 58×80 desktop, 36×52 phone), "deaths" label, players online and record in the corners, progress bar with 6 zone ticks, run marker and record flag, sound and settings buttons (inert until milestone 3). Touch controls are DOM `<button>`s (accessible, multi-touch via pointer events with `setPointerCapture` disabled so sliding works through `pointermove` hit-testing), shown only when the device has a coarse pointer; styled as the mockup's cream discs. A death in M1 shows a plain version of the death card ("Run N made it P% of the way, then the C got it."); the polished sequence is milestone 3.

- [ ] **Step 1:** Write `layout.test.ts`: 1600×900 → desktop, tile 56.25; 390×844 → phone, tile ≈ 37.9; 844×390 (rotated phone) → desktop; dpr is carried through; `camera` with no prev returns focus minus lookAhead; with prev it moves at most part-way per frame; after a resize from 390×844 to 844×390, `camera` called with the old position doesn't move more than 1 tile in one frame.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement the layout and renderer. Canvas backing size = CSS size × dpr, recomputed on `resize` and `orientationchange`.
- [ ] **Step 4:** Run. Expected: PASS.
- [ ] **Step 5:** Write `tools/screenshot.ts`: starts `startServer({port: 8080, virtualPlayers: 400})`, starts Vite, opens Playwright at 1600×900 and at 390×844 (deviceScaleFactor 2), holds right for 4 s, then saves `tools/out/m1-desktop.png` and `tools/out/m1-phone.png`, and one more phone shot 1 s after a death.
- [ ] **Step 6:** Run `npx tsx tools/screenshot.ts`, then look at the three images next to `design/mockups/board-cartoon.png`. Expected: same palette, outlines, HUD layout and proportions; crowd split into left and right camps; text readable; no console errors.
- [ ] **Step 7:** Commit `feat(client): cartoon canvas renderer, HUD and touch controls`.

### Task 11: Milestone check

- [ ] **Step 1:** Run `npm test` and `npm run typecheck`. Expected: all pass.
- [ ] **Step 2:** Run `npm run dev` with `VIRTUAL_PLAYERS=2000`, open two browser contexts with Playwright, press opposite directions in each, and confirm the blob strains in place and the `active` count is 2002.
- [ ] **Step 3:** Push the branch, open the pull request, and send the client the screenshots from Task 10.
