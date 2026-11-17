# Blobocracy

Everyone on the site controls the same blob at the same time. One life for the whole internet.

Status: milestones 1-5 done, 6 in progress. See `CHECKLIST.md` for progress. The full README (deployment, scaling, environment variables) comes with milestone 7.

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
