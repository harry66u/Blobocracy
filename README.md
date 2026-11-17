# Blobocracy

Everyone on the site controls the same blob at the same time. One life for the whole internet.

Status: milestone 1 (playable core). See `CHECKLIST.md` for progress. The full README (deployment, scaling, environment variables) comes with milestone 7.

## Play it on your computer

You need [Node.js 22 or newer](https://nodejs.org/) and git.

```bash
git clone https://github.com/harry66u/bored.git
cd bored
git checkout claude/epic-lovelace-slfnh6
npm install
npm run dev
```

Then open http://localhost:5173 in your browser.

- Move: arrow keys or A / D. Jump: up arrow, W or space. Hold jump longer to jump higher.
- Open the same link in a second window (or on your phone on the same wifi, using the "Network" address Vite prints) and you are two players fighting over one blob.
- Stop the game with Ctrl+C.

## Add bots

```bash
npm run dev -- --bots 300
```

Any number works. Try 5, 30 and 300 to feel how blending changes with crowd size. The bots are a mixed crowd: about 70% helpers who push right and jump at obstacles after a human-like delay, 20% chaos who mash random buttons, and 10% who pressed once and wandered off.

## Tests

```bash
npm test
npm run typecheck
```

## Launch features

Share card, personal stats, link previews, analytics, cost cap and the launch kit. Plan: `docs/superpowers/plans/2026-11-17-launch-essentials.md`. Launch kit: `docs/launch/`. Screenshots: `design/screenshots/launch/`.

Run the production build locally (the game server serves the built client):

```bash
SITE_URL=https://blobocracy.com npm run build
```

```bash
STATS_KEY=pick-a-secret ADMIN_KEY=another-secret npm start
```

Then open http://localhost:8080, and http://localhost:8080/stats?key=pick-a-secret for the stats page. `SITE_URL` is required for production builds so link previews always carry the real address. All server settings are listed at the top of `packages/sim/src/main.ts`.

| Command | What it does |
|---|---|
| `npm run og` | Re-renders the link preview image and icons from the game's renderer into `packages/client/public/` |
| `npx tsx tools/unfurl-check.ts` | Fetches the built page like the iMessage/Discord/X/Reddit/Slack crawlers, checks every tag and the image, draws approximate previews |
| `npx tsx tools/launch-shots.ts` | Plays the production build until a death and screenshots the share button, panel, image, clip, stats page and packed screen |
| `npm run loadtest -- --peak 6000 --ramp 10 --hold 46` | Spike load test with real WebSocket players against the real server process |
| `npx tsx tools/capdrill.ts` | Cost-cap fire drill: tiny budget, local webhook, checks every alert and every step of the cap |

Results of the last load test and drill: `docs/launch/readiness.md`.
