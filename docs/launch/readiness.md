# Launch readiness: spike load test and cost-cap drill

Run on 17 Nov 2026 in a 4-CPU, 16 GB Linux container, against the production build served by the real server process. Re-run any time:

```bash
SITE_URL=https://blobocracy.com npm run build
npx tsx tools/loadtest.ts --peak 6000 --ramp 10 --hold 46 --max-players 5000
npx tsx tools/capdrill.ts
```

## 1. Sudden spike: 30 → 6,000 players in 10 seconds

Real WebSocket players (4 worker threads), each changing its input every 0.3–3 s like a person and pinging every 2 s. The server ran as its own process with `MAX_PLAYERS=5000`.

| Phase | Players | Server ticks/s (target 60) | Frames per player per s (target 20) | Frame gap p99 | Ping p99 | Server CPU | Memory |
|---|---|---|---|---|---|---|---|
| Normal | 30 | 60 | 20 | 54 ms | 2 ms | 3% | 84 MB |
| Spike, +1,200 every 2 s | 1,224 → 5,000 | 60 throughout | 18.3–20 | 61–110 ms | 30–126 ms | 18% → 62% | 89 MB |
| Hold, 46 s | 5,000 | 60 (minimum seen) | 19.5–20.6 | worst 87 ms | worst 58 ms | 48–70% | 89 MB |
| After everyone left | 30 | 60 | 20 | 54 ms | 1 ms | 2% | 90 MB |

- **5,030 players admitted, 1,000 shown the packed screen, 0 failed connections.** The 1,000 over `MAX_PLAYERS` got the "Blobocracy is packed" message with the live death counter, not an error, and retry by themselves every 10–15 s.
- The simulation never fell behind: 60 ticks/s at every sample, longest loop stall 61 ms (absorbed by the fixed-step catch-up).
- Memory stayed flat at about 90 MB. 5,000 players cost about 60% of one CPU core.
- When the crowd left, everything was back to baseline within one sample (2 s).

Full log: `tools/out/loadtest-6000.log` (not committed; regenerate with the command above).

### What this does not prove

- **The load generator ran on the same machine,** over localhost, without TLS. Real networks add latency and the host's proxy adds TLS work.
- **Machine size matters a lot.** 5,000 players used about 60% of a full, dedicated core here. A shared-CPU cloud machine gets only a small guaranteed slice of a core once its burst allowance is spent. **Set `MAX_PLAYERS` for the machine you deploy on.** Roughly 400–600 on a shared-CPU-1x; thousands need a dedicated-CPU machine. Re-run this test against the deployed server (`--url wss://<domain>/ws --health https://<domain>/api/health?key=<ADMIN_KEY>`) from your laptop before launch, with a small `--peak` first.
- It is one server process. The design's split into a simulation server plus edge relays (milestone 4) is what scales past one machine. Until then, the packed screen is the overflow plan.

## 2. Cost cap and alerts: fire drill, 15/15 checks passed

`tools/capdrill.ts` starts the real server configured only by environment variables (as in production) with a $0.0012 budget, so a minute of play crosses every threshold. It points `ALERT_WEBHOOK_URL` at a local receiver that accepts the same JSON a Discord or Slack webhook does, plays 590 bots, and checks:

| Time | What happened |
|---|---|
| 13 s | Webhook: "passed the alert amount ($0.0003)". Game still normal |
| 26 s | Webhook: "reached 50% of the budget" |
| 36 s | Webhook: "reached 70%… Game is now: reduced frame rate". Measured: **12 frames/s** per player (was 20) |
| 52 s | Webhook: "reached 90%… holding capacity". Of 20 newcomers, **10 admitted** (up to `BASE_CAPACITY`), **10 shown the packed screen**; webhook: "Blobocracy is full" |
| 60 s | Webhook: "reached 100%… packed". All 5 newcomers shown the packed screen; players already in kept playing; `/api/status` reports packed |
| 63 s | `POST /admin/budget?usd=50` raised the budget live: back to normal, webhook "back to normal", 20 of 20 newcomers admitted, 20 frames/s again |

Every alert arrived once, in order, with both `content` (Discord) and `text` (Slack) in the body.

**The drill caught a real bug, now fixed:** thresholds were rounded to whole cents, so with a sub-cent budget they all collapsed to $0 and fired together at startup. That wouldn't happen with a $50 budget, but the cap shouldn't depend on luck. Thresholds now keep 6 decimal places, and a regression test covers it.

The same behaviour is covered by automated tests that run with `npm test`: `packages/sim/test/budget.test.ts` (11 tests) and the cost-cap test in `packages/sim/test/launch.test.ts`.

### What the cap is and isn't

- It's the game's **own estimate**: always-on machine cost (`BASE_MONTHLY_USD`, accrued hourly) plus bytes sent to players × $0.02/GB × 1.15 for protocol overhead. The host does not tell the game what it's actually billing. Compare the estimate with your first real invoice and adjust `BASE_MONTHLY_USD` or `EGRESS_OVERHEAD`.
- It **stops growth; it doesn't switch the game off.** At 100%, up to `PACKED_CAPACITY` (default 100) players keep playing at 12 frames/s, about 0.44 GB/hour, about 1 cent an hour. In practice a month can end a little above the budget, never far above it.
- What a big spike costs: 5,000 players at 20 frames/s is about 36 GB/hour, about $0.73/hour in bandwidth. With the defaults ($50 budget, $10 machines), that's roughly 55 hours of 5,000 people before the cap engages fully, longer once the 12 frames/s step kicks in.
- The host has no hard spending limit of its own. Keep its billing alerts on as a second, independent alarm.
- If the server restarts, the month-to-date estimate is reloaded from `DATA_DIR/budget.json` (saved every 30 s and on shutdown). Put `DATA_DIR` on a persistent volume.
