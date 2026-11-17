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

## Milestone 2: the whole level
- [x] Zones 3–6 with crushers, moving platforms, crumbling blocks, springs, saws, conveyors, the Big Chomp (70+ hand-designed rooms)
- [x] Level preview image
- [x] Solver proves an 8.2 minute perfect run (`npm run test:level`)
- [~] Difficulty report from timing windows (tool built; calibrating)

## Milestone 3: feel
- [x] Blob personality: squash and stretch, blinking, looking at the crowd, panic
- [x] Death moment: freeze with cause-specific pose, heavy sound, split-flap counter flip, "how far" card, swoop back
- [x] New zone moment: banner, confetti, crowd cheer, sky shift
- [x] Particles, camera look-ahead and shake
- [x] Synthesized sound and music, mute, reduced motion, settings panel
- [x] Loading screen

## Milestone 4: scale
- [~] Separate simulation server and edge relays (agent working)
- [ ] Anti-bot: proof-of-work tokens, per-IP caps, rate limits, behaviour checks
- [ ] Bot simulator and load test with thousands of connections
- [ ] Graceful degradation; budget cap at $50/month with alert at $25

## Milestone 5: history
- [ ] Postgres + Redis, crash recovery
- [ ] Run history page
- [ ] Hall of fame page

## Milestone 6: clips
- [ ] Server-recorded replays on records and near misses
- [~] Clip page; vertical and wide video export; one-tap share (agent working)
- [ ] Link preview images

## Milestone 7: win and ship
- [ ] Win sequence and permanent hall of fame moment
- [ ] Level 2 unlocks
- [ ] Fly.io deployment walkthrough for you
- [ ] README: setup, scaling, environment variables
