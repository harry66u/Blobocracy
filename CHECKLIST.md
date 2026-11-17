# Blobocracy build checklist

Updated as work lands. `[x]` done, `[~]` in progress, `[ ]` not started.

## Milestone 1: playable core
- [x] Project skeleton (monorepo, TypeScript, tests)
- [x] Shared physics, crowd blending, level format, network protocol (57 tests)
- [x] Game server: world, deaths, zones, record, pause when empty, voters, 128 crowd dots, virtual crowd, WebSocket relay
- [x] Level 1 zones 1–2 (Welcome Mat, Pointy Meadow) designed and proven beatable by a solver bot
- [x] Cartoon renderer, HUD, touch controls (matching the approved mockup)
- [x] Wire client to server, playtest the feel with bots, desktop + phone screenshots
- [x] Crowd-feel fixes from playtesting: burst jumps, movement response curve, on-screen pit deaths
- [x] Independent code review; 6 important findings fixed
- [x] Hand-off: local link, exact steps to play, command to add a few hundred bots (see README)

## Launch essentials (built ahead of milestones 4–7; see docs/launch/)
- [x] Share after each death: image (1080x1350), 9 s vertical clip (MP4), plain text line; one tap opens the phone's share sheet
- [x] Anonymous personal stats in the browser: deaths you were part of, best run, days played
- [x] Link previews: Open Graph/Twitter tags, preview image and icons drawn by the game's renderer, crawler check (23/23)
- [x] First-party analytics (counters only, no cookies/IPs): sources, time spent, next-day and 7-day return, shares; private /stats page; tracking links
- [x] Server serves the production build; build refuses to run without SITE_URL
- [x] Budget governor with webhook alerts, capacity cap, packed screen, live budget raise (the single-process part of milestone 4)
- [x] Spike load test 30 → 6,000 players and cost-cap fire drill (15/15), results in docs/launch/readiness.md
- [x] Launch kit: Show HN fact sheet (no AI-written text, per HN rules), r/WebGames and r/IndieGaming drafts, skipped-subreddit notes, launch day checklist (ET)
- [ ] Real unfurl test in iMessage, Discord, X, Reddit on the deployed URL (needs deployment)
- [ ] Load test against the deployed machine; set MAX_PLAYERS for its CPU

## Milestone 2: the whole level
- [ ] Zones 3–6 with crushers, moving platforms, crumbling blocks, springs, saws, conveyors, the Big Chomp
- [ ] Level preview image
- [ ] Solver proves an 8–12 minute perfect run
- [ ] Simulated crowds tune difficulty (days–weeks to beat)

## Milestone 3: feel
- [ ] Blob personality: squash and stretch, blinking, looking at the crowd, panic
- [ ] Death moment: freeze, heavy sound, counter flip, "how far" card, swoop back
- [ ] New zone moment: banner, crowd cheer, sky shift
- [ ] Particles, camera look-ahead and shake
- [ ] Synthesized sound and music, mute, reduced motion
- [ ] Loading screen

## Milestone 4: scale
- [ ] Separate simulation server and edge relays
- [ ] Anti-bot: proof-of-work tokens, per-IP caps, rate limits, behaviour checks
- [ ] Bot simulator and load test with thousands of connections
- [ ] Graceful degradation; budget cap at $50/month with alert at $25

## Milestone 5: history
- [ ] Postgres + Redis, crash recovery
- [ ] Run history page
- [ ] Hall of fame page

## Milestone 6: clips
- [ ] Server-recorded replays on records and near misses
- [ ] Clip page; vertical and wide video export; one-tap share
- [ ] Link preview images

## Milestone 7: win and ship
- [ ] Win sequence and permanent hall of fame moment
- [ ] Level 2 unlocks
- [ ] Fly.io deployment walkthrough for you
- [ ] README: setup, scaling, environment variables
