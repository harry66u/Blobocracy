# Blobocracy

Everyone on the site controls the same blob at the same time. Every player's left, right and jump are blended live into one character, in one long, hard, hand-designed platformer. The whole internet shares one life: a death sends everyone back to the start and adds one to the global death counter. Beat level 1 together and level 2 unlocks.

- **Play:** open the site; no login, no download. Keyboard on desktop, touch buttons on phones.
- **Pages:** the game at `/`, every attempt at `/runs`, beaten levels at `/hall`, shareable replay clips at `/c/<id>`.
- **Progress:** `CHECKLIST.md`. Design: `docs/superpowers/specs/2026-11-17-blobocracy-design.md`. Deploying: `docs/DEPLOY.md`.

## How it works

```
browsers ──WebSocket──▶ edge relays (1 always on, more start in a spike) ──private network──▶ sim (exactly one)
                         serve the site, check sessions, merge inputs,        60 Hz physics, blending, deaths,
                         fan out the same frame bytes to every player         records, clips, cost cap
                                                                                   │
                                                              Postgres (runs, clips, hall of fame) + Redis (live state)
```

- **One source of truth:** the sim runs the physics; clients only send three bits (left, right, jump). Nothing to cheat but voting power.
- **Blending:** `pull = (right − left) / active players`, shaped by a response curve so a mostly-agreeing crowd moves decisively; a jump fires when 30% of active players press (or a fresh burst of 30% arrives within 0.25 s), and the crowd sets jump height by how long it holds. A lone player has full control; an empty world pauses.
- **Bots and spam:** a proof-of-work session token, at most 4 votes' worth per IP, rate limits, and checks for robotic timing and identical input streams. Flagged players are silently ignored.
- **Packages:** `shared` (physics, levels, protocol, replays), `sim`, `edge`, `client` (Canvas renderer, synthesized audio, pages), `bots`. Tools in `tools/` (solver, level preview, load test, screenshots).
- **Levels** are hand-designed ASCII rooms (`packages/shared/src/levels/`). A solver proves each level is beatable with human-speed inputs: level 1's perfect run is 8.2 minutes, level 2's is 10.3. Check with `npm run test:level` (slow, about 20 minutes).

## Play it on your computer

You need [Node.js 22 or newer](https://nodejs.org/) and git.

```bash
git clone https://github.com/harry66u/Blobocracy.git
cd Blobocracy
git checkout claude/epic-lovelace-slfnh6
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

- Move: arrow keys or A / D. Jump: up arrow, W or space. Hold jump longer to jump higher.
- Open the same link in a second window (or on your phone on the same wifi, using the "Network" address Vite prints) and you are two players fighting over one blob.
- Stop the game with Ctrl+C.

## Run history, hall of fame and clips

`npm run dev` needs no database: without `DATABASE_URL` and `REDIS_URL` the history lives in memory. To see the pages with something in them:

```bash
npm run dev -- --seed 2000
```

then open http://localhost:5173/runs (every attempt, the chart, the list) and http://localhost:5173/hall. Records and near misses (dying within 5% of the record) become clips automatically; the death card offers "Share the clip", which opens `/c/<id>`.

With real services (what production uses):

| Variable | Who | What |
|---|---|---|
| `DATABASE_URL` | sim | Postgres for runs, clips, hall of fame, levels and level versions, the world row. Migrations (`packages/sim/migrations`) run on boot. If Postgres is unreachable the game carries on and writes queue until it returns. |
| `REDIS_URL` | sim, edges | The live snapshot (a restarted sim resumes the run in progress), budget counters, per-IP socket caps and abuse flags shared by all relays. |
| `LIVE_STATE_FILE`, `BUDGET_STATE_FILE` | sim | JSON files used instead of Redis when `REDIS_URL` is unset. |
| `PUBLIC_URL` | edges | Origin used in link previews (`og:image`, `og:url`). |

The read API (`/api/summary`, `/api/runs?page=&best=1`, `/api/hall`, `/api/clips/<id>`, `/api/clips/<id>/meta`, `/api/clips/<id>/og.png`) is served by the sim's internal port; edges proxy and cache it. The site's preview image is `packages/client/public/og.png` (regenerate with `npx tsx tools/og-image.ts`); each clip gets its own, drawn by the sim when the clip is made. Page screenshots with fake data: `npx tsx tools/pages-shots.ts`.

## Add bots

```bash
npm run dev -- --bots 300
```

Any number works. Try 5, 30 and 300 to feel how blending changes with crowd size. The bots are a mixed crowd: about 70% helpers who push right and jump at obstacles after a human-like delay, 20% chaos who mash random buttons, and 10% who pressed once and wandered off.

## Run it the way production does (sim + two relays)

```bash
npm run dev:split
```

This starts the simulation, two edge relays and two browser addresses: http://localhost:5173 (relay A) and http://localhost:5174 (relay B). Open one of each and you are steering the same blob through different relays. Pages solve a small proof of work before joining, as they will online. Stop with Ctrl+C.

## Real bot connections and the load test

```bash
npm run bots -- --count 500 --profile mixed --url ws://localhost:8080,ws://localhost:8082
npm run loadtest -- --count 5000
```

`bots` connects real sockets to running relays (profiles: follower, random, idle, spammer, farm, perfect-timing, mixed; start the relays with `TRUST_TEST_IP_HEADER=1` so each bot gets its own fake address). `loadtest` starts everything itself, reports frames per second, latency, relay CPU and memory, and which bot defenses fired, and saves the numbers to `tools/out/`.

## Tests

```bash
npm test
npm run typecheck
```

The Postgres and Redis store tests run only against real services: `TEST_DATABASE_URL=postgres://… TEST_REDIS_URL=redis://localhost:6379/15 npm test`.

## Deploying

Step-by-step for Fly.io, from no account to a live game, is in **`docs/DEPLOY.md`**. In short: create the app, set five secrets, `fly deploy`, and pre-create stopped spike relays.

## Scaling and cost

- **Normal traffic** runs on one sim and one relay (shared-cpu machines) plus free-tier Postgres: about $12–15 a month.
- **Spikes:** Fly's proxy starts pre-created, stopped relays when the running relay passes 1,500 players, and stops them when traffic falls. How many relays you pre-create is a hard ceiling on compute. Measured locally: a relay handles about 2,500 players on 0.4 of a CPU core, 4,900 on 0.53, at 25–45 KB of memory per player. The sim's work grows with the number of relays, not players.
- **Bandwidth** is the main cost in a spike: about 2.5 KB/s per player (~$3.60 an hour at 20,000 players).
- **Cost cap:** the sim estimates month-to-date spend from machine hours and bytes sent. In cap mode (the default) it alerts at $25 and at 70/90/100% of $50, lowers the frame rate at 70%, turns new visitors into watchers at 90%, and holds capacity with a friendly "packed" page at 100%. Raise it live with `POST /admin/budget` (see `docs/DEPLOY.md`).
- **Graceful degradation:** slow sockets skip frames instead of lagging; an overloaded relay sends every other frame; if the sim restarts, players see "Reconnecting to the blob…" and the run resumes from a snapshot (a restart is never a death); if Postgres is down, the game keeps going and writes queue until it returns.

## Environment variables

Every variable, with its default and which process reads it, is documented at the top of `fly.toml`. The ones you set:

| Variable | Process | Purpose |
|---|---|---|
| `SESSION_SECRET` | edge | Signs session tokens (required in production). |
| `RELAY_SECRET` | sim, edge | Shared secret for the relay ↔ sim link. |
| `ADMIN_TOKEN` | sim | Bearer token for `/admin/*` (stats, bans, budget). Unset = admin off. |
| `DATABASE_URL` | sim | Postgres. Unset = history in memory only. |
| `REDIS_URL` | sim, edge | Live snapshot, budget counters, shared per-IP caps. Unset = files on the sim volume. |
| `ALERT_WEBHOOK_URL` | sim | Discord/Slack webhook for budget alerts. |
| `PUBLIC_URL` | edge | Your domain, for link previews. |
| `BUDGET_MODE`, `MONTHLY_BUDGET_USD`, `BUDGET_ALERT_USD` | sim | `cap`, `50`, `25` (your choice). |
| `POW_DIFFICULTY`, `IP_VOTE_CAP`, `IP_CONN_CAP`, `INPUT_RATE_LIMIT` | edge | Bot defenses: 14 bits, 4 votes, 32 sockets, 20 changes/s. |
| `PORT`, `VIRTUAL_PLAYERS` | dev | Server port (8080); fake players for testing. |
