# Blobocracy design

Date: 2026-11-17. Status: approved; the budget behaviour at 100% is decided at deploy time.

## 1. What this is and why

Blobocracy is a browser game where everyone on the site controls the same single character at the same time, in one long, hard, hand-designed 2D side-scrolling platformer. Every player's left, right and jump inputs are blended live into the character's movement. The whole internet shares one life: a death sends everyone back to the very start and adds one to a global death counter. The goal is for the internet to cooperate long enough to beat the level, which should take days or weeks.

It spreads through short clips: funny, dramatic deaths and near-misses that people share from their phones. Every design choice serves two things: instant, joyful play with zero setup, and moments worth recording.

### Goals
- Open the link and you are playing within a couple of seconds, on desktop (keyboard) and phone (touch). No login, no download.
- Input blending that is chaotic and funny but beatable with coordination, and feels right at 2 or 20,000 players.
- One long hand-designed level in 6 zones with rising difficulty. A perfect run takes 8 to 12 minutes. Difficulty comes from precise jumps and timing, not length.
- A polished, award-worthy look and feel in the chosen **playful cartoon** direction (see `design/mockups/board-cartoon.png`), consistent across game, run history page, clips, loading screen and link previews.
- Survive a sudden viral spike of tens of thousands of simultaneous players, and degrade gracefully when overloaded.
- Server is the only source of truth; bots and spam are detected and ignored.
- Under $20/month at normal traffic, automatic scale up and down, and a cost ceiling the game enforces itself (target: never above $50/month).

### Non-goals
- Accounts, logins, friends, chat. (Anonymous for now; structured so optional nicknames can be added later, see §9.)
- Multiple simultaneous worlds or shards. There is exactly one world.
- Checkpoints. Death always returns to the very start.
- Native apps.
- Multi-region simulation. Everything runs in US East.

### Anti-goals (would be failure even if it technically works)
- Deaths that feel frustrating or unfair, rather than funny and dramatic. Every death must have a visible, readable cause.
- A level that cannot actually be beaten. We prove it is beatable (§6.6).
- A surprise bill.
- Looking like a prototype or a template.
- A game where one person with a script can steer the blob.

## 2. Decisions already made with the client

| Topic | Decision |
|---|---|
| Name | Blobocracy |
| Visual direction | B, playful cartoon: zone-tinted skies (blue, sunset orange, deep purple), cream platforms with thick plum outlines, hot pink hazards, white crowd dots, yellow blob |
| Host | Fly.io, region US East (`iad`) |
| Budget | Under $20/month at normal traffic; automatic scale-up and scale-down; cap or alert above $50/month |
| Perfect run | 8 to 12 minutes across 6 zones |
| Identity | Fully anonymous; hall of fame records date, death count, peak player count; nickname-ready schema |
| Sound | Synthesized in the browser (no audio files) |
| Data | Postgres for run history; Redis for live state |
| Clips | Server-recorded replays, rendered in the browser to vertical (1080x1920) and wide (1920x1080) video |

## 3. Approaches considered for the server architecture

The hard part is not simulating one character (that is trivial) but sending the world to tens of thousands of sockets 20 times a second while collecting their inputs, cheaply.

**A. One process does everything.** Simplest. A single Node process runs the simulation and holds every WebSocket. It falls over somewhere around a few thousand players, and when it does, the simulation (the one life) stalls for everyone. Rejected: fails the viral-spike requirement.

**B. One simulation process plus a fleet of stateless relay servers (chosen).** The *sim* runs the physics and owns all game state. Players connect to *edge relays*; each relay holds thousands of sockets, merges its players' inputs into one small summary per tick, and forwards it to the sim over Fly's private network. The sim broadcasts one state frame per tick to each relay, and the relay sends the same bytes to all its players (encoded once, sent many). The sim's work grows with the number of relays, not players. Relays scale up and down automatically. If a relay dies, only its players reconnect; the world keeps going.

**C. Managed realtime service (e.g. a hosted pub/sub product) for fan-out.** Offloads sockets entirely, but per-message pricing at 20 messages/second times tens of thousands of players is far above budget, and it adds latency and a vendor. Rejected on cost.

At normal traffic, B runs as just one sim machine and one relay machine, so it costs about the same as A.

## 4. System overview

```
 browsers (keyboard / touch)
     │  WebSocket (binary), HTTPS for pages and assets
     ▼
 ┌──────────── Fly proxy (iad), balances by connection count ────────────┐
 │  edge relay 1   edge relay 2   ...   edge relay N  (N = 1 normally,   │
 │  (always on)    (autostarts)          capped by MAX_RELAYS)          │
 └───────┬────────────────┬──────────────────┬───────────────────────────┘
         │ input summaries up (≤60/s), state frames down (20/s)
         ▼  over Fly private network (6PN)
     ┌────────┐      snapshots every 2s, ban lists      ┌────────┐
     │  sim   │ ──────────────────────────────────────▶ │ Redis  │
     │ (1x)   │                                         └────────┘
     │        │ ── runs, clips, records, hall of fame ─▶ Postgres (managed, free tier)
     └────────┘
```

### Processes (one codebase, one Fly app, separate process groups)
- **sim** (exactly one machine, always on): fixed-timestep physics at 60 Hz, input blending, deaths, zones, records, replay ring buffer, run bookkeeping, writes to Postgres and Redis. Exposes an internal WebSocket for relays and a small internal HTTP API.
- **edge** (relays, min 1, max `MAX_RELAYS`): serves the static site and HTTP pages (run history, hall of fame, clip pages, link preview images), accepts player WebSockets, does per-connection abuse checks, aggregates inputs, fans out state frames. Stateless; any relay can be killed at any time.
- **redis** (one small machine with a volume): live state snapshots, shared abuse state (per-IP counters, bans) across relays.
- **Postgres**: managed free tier (Neon or Supabase; picked at deploy time, both fit). Fly's managed Postgres costs more than the whole budget.

### Tech stack
- TypeScript everywhere. Node 22 on the server.
- `uWebSockets.js` for relay and sim sockets (it holds many more sockets per CPU than `ws`, which is what makes cheap relays possible).
- Client: no game framework. Hand-written Canvas 2D renderer (the mockups prove the look is achievable with plain shapes), Web Audio for synthesized sound, Vite for builds. Target: under 120 KB gzipped JavaScript for the game page so it loads instantly on cellular.
- Shared package: level data, physics, blending and replay format, used identically by sim, client, tools and tests. The physics is deterministic (fixed timestep, no wall-clock reads), so replays, the solver and client-side extrapolation all agree with the server.
- Fonts: Bagel Fat One (display, counter, headings) and Atkinson Hyperlegible Next (all small text), self-hosted woff2, both under the Open Font License.

### Code layout (monorepo, npm workspaces)
```
packages/shared   physics, level format, levels/, blending, protocol, replay codec
packages/sim      the authoritative simulation server
packages/edge     relay + HTTP pages + link preview images
packages/client   the game, run history, hall of fame, clip pages (Vite multi-page)
packages/bots     bot crowd simulator (sockets) and in-process virtual crowds
tools/            level preview renderer, level solver, difficulty estimator, load test
```

## 5. Netcode

### Wire protocol
Binary messages, little-endian, versioned with a 1-byte message type.

**Client → relay.** Input is a 3-bit state (left, right, jump held), sent only when it changes, plus a heartbeat every 2 s. A typical player sends a few bytes per second.

**Relay → sim**, sent whenever the summary changes (at most 60/s):
- counts of active players by input state (8 buckets),
- weighted counts after abuse weighting (§8),
- connection count,
- a small rotating sample of up to 32 of its players' current input states with stable 16-bit slot ids (feeds the crowd dots, below).

**Sim → relay → client** state frame at 20 Hz (configurable), about 70 bytes:
- tick, run id, character position and velocity (quantized), facing, grounded, flags (dying, frozen, celebrating), current blend result (net horizontal pull, jump pressure),
- players online (total), active voters,
- the crowd sample: up to 128 dot slots, 2 bits each (left/right/none plus jump bit via a second plane), so the dots on screen are real, randomly chosen players leaning the way they are actually pressing,
- hazard phase info for any time-based hazards on screen (a single phase clock is enough, since all hazards are deterministic functions of the run's tick).

Events (death, zone reached, new record, clip ready, level won, counters) are separate small messages, sent reliably on the same socket. On connect, the relay sends a cached welcome snapshot (level id, death count, record, current run, recent events) so new players render instantly.

**Bandwidth**: about 70 bytes × 20/s plus overhead ≈ 2.5 KB/s per player. 20,000 players ≈ 50 MB/s ≈ 180 GB/hour ≈ $3.60/hour of egress at $0.02/GB. This is the biggest cost driver in a spike, which is why the budget governor (§10) controls frame rate and capacity.

### Responsiveness
- Your own dot reacts the instant you press (drawn locally, leaning toward your input). The character responds within one round trip.
- The client runs the shared physics forward from the latest server frame using the latest blend result, predicting up to the estimated one-way latency, and smoothly corrects toward each new server frame. With 20 Hz frames and a 30 to 80 ms round trip on US cellular, the character should appear to react in roughly 60 to 120 ms, which feels responsive for a crowd-controlled character.
- Death, zone and record are never predicted; they come from the server, so nobody sees a fake death.

### Sim loop
- 60 Hz fixed step. Each step reads the latest merged input summary from all relays, computes the blend (§7), advances physics, checks hazards, emits events. Every third step, it encodes one state frame and pushes it to every relay.
- Relays forward state frames byte-for-byte to all their sockets, skipping slow sockets whose send buffer is backed up (they get the next frame instead; never queue stale frames).

## 6. Level design

### 6.1 Units and feel targets (starting values, tuned in milestone 2)
- 1 tile = 1 world unit. The camera shows about 28 tiles wide on desktop and about 10 wide on a vertical phone (the phone camera looks further ahead, and the extra vertical space holds the HUD and touch controls, as in the mockups).
- Blob collision box about 1.1 × 1.2 tiles. Run speed about 7 tiles/s with quick acceleration; air control about 70%.
- Full jump about 3.2 tiles high and 6 tiles long at speed; short hop about 1.2 tiles. Coyote time 100 ms, jump buffer 150 ms.
- Time-based hazards are deterministic functions of the run clock, so every run sees the same timings and a crowd can learn them.

### 6.2 Authoring format
Hand-designed rooms in ASCII, about 18 rows tall and 30 to 80 columns wide, stored in `packages/shared/levels/level1/*.ts`. Rooms are concatenated left to right to make zones. Characters are tiles (`#` solid, `=` one-way platform, `^` floor spikes, `v` ceiling spikes, `~` crumbling block, `S` spring, `>`/`<` conveyor). Letters are entities whose parameters are declared in the same file (crusher timing, moving platform path, saw rail). Every placement is a deliberate design choice; the format just keeps it readable and diff-friendly.

A level preview tool renders the whole level to one long image, with zone boundaries and the solver's path overlaid, so the level can be reviewed at a glance.

### 6.3 The six zones

| # | Zone | Sky | New idea | What the crowd must learn | Signature moment | Perfect-run time |
|---|---|---|---|---|---|---|
| 1 | Welcome Mat | blue | walk, gaps, single spikes | push the same way; jump together | "Leap of Faith": first big gap | ~75 s |
| 2 | Pointy Meadow | blue | spike fields, ceiling spikes, narrow pillars | short hops (let go of jump fast) vs long jumps | "The Haircut": low spiky ceiling over floor gaps | ~90 s |
| 3 | The Grinder | sunset | the Big Press (timed crushers), moving platforms over pits | **stop and wait**, the hardest thing for a crowd | three staggered presses in a row | ~110 s |
| 4 | Sundown Steps | sunset to dusk | vertical climbing, crumbling blocks, springs | **don't hesitate**: crumbling chains punish waiting | "Don't Look Down": a crumbling climb over a long fall | ~110 s |
| 5 | Purple Panic | purple | saws on rails, conveyors that push against the crowd | hold a direction against a force; time around saws | conveyor running into a saw gate | ~120 s |
| 6 | The Last Inch | deep purple | everything combined, plus the Big Chomp (a slow wall of teeth that chases from behind) | keep moving forward under pressure, with precision | final gauntlet ending at a giant golden crown | ~120 s |

Total about 10.5 minutes for a perfect run. Each zone ends with a short safe stretch so the "new zone" banner and cheer land in calm air, and the sky transitions color across that stretch.

### 6.4 Difficulty target
Target per-attempt pass rates for an average crowd, given that the run already reached the zone: Z1 90%, Z2 60%, Z3 35%, Z4 25%, Z5 15%, Z6 10%. That gives roughly 1 win per 1,500 attempts at first. Runs average 2 to 3 minutes, so that is several days of continuous play, longer once you count quiet hours; crowds that learn will beat it sooner, crowds that change hands won't. Measured in milestone 2 with simulated crowds (§6.6) and tuned by spacing and timing, never by length. **Builder's call:** the targets assume a crowd of about 30 active voters (normal traffic). The estimator also runs at 3 and 2,000 voters, and blending constants are adjusted until pass rates at those sizes stay within about a factor of two of the 30-voter numbers, so a viral crowd can't trivialize the level and a quiet night isn't hopeless.

### 6.5 Hazard language (accessibility)
Hazards are always hot pink with a plum outline **and** have a hazard-only silhouette: points, teeth or blades. Moving hazards also carry diagonal stripes. Safe surfaces are always cream with rounded corners and no points. A colorblind player can tell them apart by shape alone. Pits get a darker gradient at the bottom so they read as deadly.

Every hazard has a name used in death messages and run history: Spikes, Ceiling Spikes, the Big Press, the Pit, Crumble, Saw, the Big Chomp.

### 6.6 Proving it is beatable
- **Solver**: a search tool that drives the deterministic sim with human-like inputs (each input held at least 150 ms) and finds a path through each zone. A test asserts the full level is beatable and reports the perfect-run time (must be 8 to 12 minutes).
- **Crowd estimator**: runs thousands of simulated runs with noisy virtual crowds (players follow the solver's plan with random reaction delays of 150 to 400 ms, some fraction disagreeing or idle) and reports per-zone pass rates against §6.4.

### 6.7 After a win: level 2
When the world beats level 1, the game plays a win sequence, writes a permanent hall of fame entry, and after a celebration unlocks level 2, a new hand-designed level with the same six-zone structure, tighter timings and one new mechanic (low-gravity zone and wind gusts). The death counter, run numbers and record are per level; the hall of fame keeps all of them. Level 2 is built in the last milestone; the system supports any sequence of levels. **Builder's call:** when the last built level is beaten, it stays playable as an encore with its own counter, and the hall of fame says a new level is coming.

## 7. Input blending

Inputs come only from **active voters**: players who pressed something in the last 3 seconds. Idle tabs don't dilute the crowd. Each voter has a weight of 1, or less if flagged (§8).

**Lone players (client's decision).** A single active player has full control at any hour, including the power to end a deep run. That is part of the comedy; late-night solo heroes can also make real progress.

**Horizontal pull**: `pull = (R − L) / max(A, 1)`, where R and L are weighted counts of players holding right and left (holding both counts as neither) and A is the weighted count of active voters. Active voters who aren't pressing a direction count as votes to stand still. Target speed = `runSpeed × sign(pull) × |pull|^0.6`, approached with acceleration, so the blob has a little inertia. The response curve (found in milestone 1 playtesting) makes a mostly-agreeing crowd feel decisive: half the crowd agreeing moves at about two thirds speed, because at half speed every jump fell short and even easy gaps were deadly. Two players pushing opposite ways make the blob strain in place, eyes darting between them (funny). One player has full control. At 20,000, the law of large numbers makes the pull smooth, so the chaos is about agreement, not noise.

**Tug-of-war wobble**: when both L and R are large (strong disagreement), the blob visibly strains and squashes, with a small speed penalty. This is purely a readability and comedy feature.

**Jump**: jump pressure = `J / max(A, 1)`, the weighted share of active voters holding jump. A jump starts when the blob can jump (grounded or within coyote time) and pressure crosses the jump threshold (default 30%, or any single press when there is only one active voter). It is buffered for 150 ms. While rising, if pressure drops below the release threshold (15%), upward velocity is cut, so **the crowd controls jump height by how long it holds**. Short hops need the crowd to let go together.

**Fresh bursts** (milestone 1 playtesting): a crowd almost never lets go together, so with only the rule above, a second jump was impossible while stragglers still held the button. So a jump also fires when a fresh burst arrives: at least 30% of active voters started pressing jump within the last 0.25 s. The burst signal uses the same hysteresis (it re-arms once the fresh share drops below 15%), so a burst hovering near the threshold fires once.

**Pit deaths** happen when the blob's center sinks 2.5 rows above the bottom of the level, while it is still on screen, so the death freeze shows it.

All constants are config, tuned in milestone 2 with simulated crowds at 2, 20, 200 and 20,000 players.

**Empty world (builder's call).** With zero active voters, the world pauses: the run clock (which drives every hazard) stops, the blob dozes on the spot with a little "zzz", and the crowd dots fade. The first press wakes it and the run continues exactly where it was. Nobody's run dies while nobody is watching, and the clock freezing keeps hazard timing deterministic.

## 8. Fairness, bots and spam

Since clients only send 3 bits of intent and the server runs the physics, there is nothing to cheat except voting power. Defenses, cheapest first:
1. **Session token.** The page fetches a signed session token before opening the socket. Getting a token requires solving a tiny proof-of-work in the browser (about 100 ms on a phone). That is invisible to humans but makes thousands of fake connections costly.
2. **Per-IP influence cap.** All connections from one IP together count as at most a few votes (default 4), split among them. Shared IPs (schools, mobile carriers) still play; a bot farm on one IP can't dominate. A connection cap per IP (default 32) bounds abuse.
3. **Rate limits.** At most 20 input changes per second per connection; beyond that, inputs are ignored and the connection is flagged.
4. **Behavior checks** (run on relays, results shared through Redis): inhumanly regular timing, reaction times faster than humanly possible to hazard phases, and many connections producing identical input streams. Flagged sessions get weight 0 (shadow-ignored: they still see the game and think they're playing).
5. **Admin override**: an authenticated admin endpoint to ban an IP range or reset weights during an incident.

The bot simulator (§11) includes abusive bot profiles to prove each defense works.

## 9. Data

### Postgres
- `levels`: id, name, created_at, unlocked_at, beaten_at, current_version.
- `level_versions`: level_id, version, geometry hash, created_at, notes. **Builder's call:** levels can be retuned after launch. Every run and clip records the level version it was played on, and every version's geometry stays in the code so old replays still draw correctly. Retuning keeps the death count, record and history (the record is marked with the version it was set on). Every change must pass the solver and estimator in CI before deploy.
- `runs`: level_id, level_version, run_number, started_at, ended_at, duration_ms, max_progress (0 to 1), max_x, zone_reached, cause (hazard name), peak_players, clip_id (nullable). Primary key (level_id, run_number). Index on max_progress for best-run queries.
- `clips`: id (short slug), level_id, level_version, run_number, kind (record, near_miss, win), created_at, progress, replay (compressed binary, about 15 to 30 KB).
- `hall_of_fame`: level_id, beaten_at, death_count, peak_players, run_number, clip_id.
- `world`: one row per level holding the death count and record; the sim's authoritative copy is in memory and is written on every death.
- Nickname-ready: every connection already has an anonymous session id (from the session token). A future `players(session_id, nickname)` table can attach names to clips and the hall of fame without changing existing tables.

### Redis
- `live:snapshot`: current level, run number, run start tick, character state, death count, record; written every 2 s and on every event. If the sim restarts, it resumes the run in progress from this snapshot. A restart is not a death.
- Abuse state: per-IP connection counts, flags, bans; shared by all relays.

## 10. Hosting, scaling and cost control

### Fly setup (normal traffic)
| Piece | Machine | Approx. monthly |
|---|---|---|
| sim | shared-cpu-1x, 512 MB, always on | ~$3.70 |
| edge | 1 × shared-cpu-1x, 512 MB, always on | ~$3.70 |
| redis | shared-cpu-1x, 256 MB + 1 GB volume | ~$2.35 |
| Postgres | managed free tier (Neon/Supabase) | $0 |
| egress | ~30 average players ≈ 200 GB | ~$4 |
| **Total** | | **~$14** |

Prices are from Fly's October 2026 pricing (shared-cpu-1x 256 MB at $2.19/month, extra RAM $6/GB/month, North American egress $0.02/GB) and are re-checked at deploy time.

### Automatic scale-up and scale-down
Extra relay machines (performance-class, so they don't get CPU-throttled under load) are created ahead of time in a stopped state; stopped machines cost only a few cents of storage. Fly's proxy starts them automatically when connections pass a soft limit per relay and stops them when traffic falls. The number of pre-created relays (`MAX_RELAYS`) is a hard ceiling on compute cost.

### Budget governor (the cost cap)
Fly has no spending limit of its own; its only hard stop (prepaid credit running out) suspends the whole account, which would take the game down mid-spike. So the game enforces its own cap:
- The sim tracks estimated month-to-date spend from machine-hours by size and bytes sent, which every relay reports.
- `BUDGET_MODE` = `cap` or `alert`; both are built. **Client decision: `cap`, budget $50/month, first alert at $25.** The client will raise the budget deliberately if the game takes off. In `alert` mode the alerts fire but nothing below is enforced. The budget can be raised live through the admin endpoint without a restart.
- `MONTHLY_BUDGET_USD` (client's setting: 50) and `BUDGET_ALERT_USD` (client's setting: 25, plus alerts at 70%, 90% and 100%):
  - over 70%: state frame rate drops from 20 to 12 Hz for everyone (gameplay still works; the client's prediction covers it);
  - over 90%: new players beyond the always-on capacity join as **watchers** (lower frame rate, inputs still count), and no new relays are started;
  - at 100%: capacity is held at the always-on relays only; extra visitors see a friendly "Blobocracy is packed" screen with the live death counter, refreshed from a cached endpoint every 10 s.
- An alert (webhook URL, e.g. a Discord or Slack channel, and an email if configured) fires at 50%, 70%, 90% and 100% of budget.
- Recommended alongside: a payment card on Fly plus any Fly billing alerts available in its dashboard at deploy time.

### Graceful degradation under overload
- Relay CPU or send backpressure high: that relay sends every other frame to its sockets.
- Relays full and the cap reached: watcher mode, then the packed screen, as above.
- Sim unreachable: clients show "Reconnecting to the blob…" over a frozen frame and retry with backoff; the run resumes from the Redis snapshot.
- Postgres unreachable: gameplay continues; run records queue in memory and Redis and are written when it returns.

## 11. Bot simulation mode
- `npm run bots -- --count 5000 --profile mixed --url ws://localhost:8080` opens real WebSocket connections and plays. Profiles: `random`, `follower` (follows the solver's plan with human-like reaction delays and disagreement), `idle`, and abusive ones (`spammer`, `farm` many sockets from one IP, `perfect-timing`).
- In-process virtual crowds (`SIM_VIRTUAL_PLAYERS=20000`) inject blended votes directly into the sim to test gameplay feel at huge scale without sockets.
- The load test reports: frames delivered per second, latency percentiles from press to server, relay CPU, memory per connection, and whether abuse defenses fired.

## 12. Player experience details

### HUD (as in the mockups)
- Top center: death counter on flip-scoreboard digit cards (Bagel Fat One); on a death, the last digit card flips over, lights up yellow, and a "+1" pops.
- Top left: players online. Top right: record and which run set it.
- Bottom: thin progress bar for the whole level, tick marks between zones, a mini blob for the current run, a pink flag at the record. Sound and settings buttons at its right end.
- In the world: a ghost flag stands at the record position, so passing it is visible on screen and in clips.
- Nothing else on screen.

### Crowd
Up to 128 real, randomly sampled players as white dots swarming around the blob. Each dot drifts toward its side (left-pushers to the left of the blob, right-pushers to the right, jumpers higher) and leans and trails toward what it is pressing, so the swarm visibly fights over left versus right. Your own dot is always drawn, highlighted with a yellow fill, a ring and a "you" tag.

### The blob
Round, with big expressive eyes. Squash and stretch on jumps and landings, idle breathing, blinking, pupils looking toward the crowd's pull, straining during a tug of war, and visible panic near danger (tiny pupils, worried brows, sweat drops, "o" mouth) when a hazard is close in its path.

### Death moment
1. Freeze for 0.5 s on the moment of death (the death frame shows the specific funny squash: flattened, poked, sliced, falling with a tiny wave).
2. A single heavy sound, then silence (the music stops).
3. The counter card flips with a satisfying bounce.
4. A card: "Run 4,812 made it 41% of the way, then the Big Press flattened it." Near the record, it opens with "So close." and offers "Share the clip".
5. After about 3 s, the camera swoops smoothly back to the start, the sky color rewinds, and the music fades back in.

### New zone moment
A short banner drops in ("Zone 3: The Grinder"), confetti from the top edge, a synthesized crowd cheer, and the sky shifts to the zone's palette. A cheer also plays when the run passes the record flag.

### Motion
Slightly bouncy easing everywhere; the camera follows smoothly, looks ahead in the direction of travel, and shakes briefly on deaths and landings. Subtle particles on jumps, landings and deaths.

### Sound (all synthesized)
Soft jump and landing sounds, ambient music that gains layers zone by zone, one heavy hit and then silence on death, a crowd cheer on new zones, and a mute button (remembered). Audio starts after the first tap or key press, as browsers require.

### Accessibility
Text meets WCAG AA contrast against its background. Hazards are distinguishable by shape (§6.5). A reduced-motion option (on by default when the OS asks for it) removes camera shake, reduces particles, replaces bounces with fades and slows sky transitions. Full keyboard play (arrows, A/D, W, Space) and visible focus on buttons. Death and zone messages are announced to screen readers through a polite live region.

### Pages, all in the same visual identity
- **Loading screen**: the blob bouncing on a cream platform under the blue sky, the logo, and the live death counter; it disappears as soon as the first state frame arrives.
- **Run history** (`/runs`): a chart of every attempt's progress over time ("the internet getting better"), then a paginated list: run number, a mini progress bar, duration, what killed it (icon and name), when, and a clip link when one exists. Filter by best runs.
- **Hall of fame** (`/hall`): one entry per beaten level, with date, death count, peak players and the winning clip.
- **Clip page** (`/c/:id`): plays the replay in the browser (rendered from data, so no video download is needed), with "Download video" in vertical or wide, and share.
- **Link previews**: a branded static image for the site; per-clip images rendered on the server at clip creation (the key frame and the progress number).

## 13. Replay clips
- The sim keeps a ring buffer of the last 30 s of state frames plus events (about 40 KB).
- Triggers: a run ends past the old record (new record), a run dies within 5% of the record (near miss), and a win (the last 60 s).
- On a trigger, the sim compresses the buffer, saves it as a clip, and broadcasts "clip ready" with its id. The death card shows "Share the clip".
- The browser renders a clip to video with the same renderer, at 1080x1920 (vertical, for phones) or 1920x1080 (wide), encoded with WebCodecs into MP4, falling back to MediaRecorder (WebM) where WebCodecs is missing. On phones, "Share the clip" opens the system share sheet with the video file and the clip link; on desktop, it downloads the video and copies the link.
- Clip framing: the camera is re-framed for each aspect ratio; the HUD shows the death counter and a small "blobocracy" wordmark plus URL in the corner of every clip so clips always carry the brand back.

## 14. Milestones
Each milestone ends with screenshots shown to the client and a check that it works and looks right before moving on.

1. **Playable core.** Shared physics and blending, zone 1 and 2 rooms, one server process (sim and relay together), Canvas renderer in the cartoon style, keyboard and touch, crowd dots, basic HUD, in-process virtual crowd.
2. **The whole level.** All six zones and their mechanics, level preview image, solver proves it is beatable in 8 to 12 minutes, crowd estimator tunes difficulty.
3. **Feel.** Blob personality and animation, particles, camera, death sequence, zone banners, synthesized sound and music, scoreboard flip, reduced motion, mute, loading screen.
4. **Scale.** Split sim and relays, binary protocol, session tokens and abuse defenses, bot simulator, a load test with thousands of bot connections, graceful degradation and the budget governor.
5. **Persistence and pages.** Postgres and Redis, crash recovery, run history and hall of fame pages.
6. **Clips and sharing.** Replay recording, clip page, video export in both shapes, share flows, link preview images.
7. **Win and ship.** Win sequence, hall of fame moment, level 2, Fly deployment walkthrough, README covering setup, scaling and environment variables.

## 15. Left to the builder
- Exact physics constants, blend thresholds and hazard timings (tuned against §6.4 with the tools in §6.6).
- Room-by-room layout within each zone's theme and difficulty targets.
- Exact binary encodings, quantization and compression choices.
- Music composition and sound design within §12.
- Choice between Neon and Supabase for Postgres at deploy time.
- Exact abuse-detection thresholds, validated with the bot profiles.
