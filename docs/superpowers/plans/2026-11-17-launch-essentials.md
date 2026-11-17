# Launch essentials plan

Date: 2026-11-17. Goal: go from 0 to thousands of players through honest, organic sharing.

## Where the code is today

Milestone 1 (playable core, zones 1–2, one server process) is done; milestone 2 is in progress.
Not built yet and relevant here: the split sim/relay architecture and budget governor (M4),
Postgres/Redis (M5), server replays and clips (M6), production serving and deployment (M7).
This plan builds the launch pieces on top of the single-process server so they work now
and carry over when M4–M7 land. Nothing here changes gameplay.

## Decisions (builder's calls)

| Topic | Decision | Why |
|---|---|---|
| Clip source | The browser keeps its own ring buffer of the last ~6 s of state frames it received and re-renders them at 1080x1920 with the game's renderer, then an end card with the stats | Server replays are M6; every player already receives every frame, so the clip is exact |
| Video encoding | WebCodecs + `mp4-muxer` (MP4, H.264 where the browser has it, otherwise VP9); fallback to MediaRecorder | MP4 plays everywhere people share; encoding is faster than real time; lazy-loaded so the game page stays small |
| One-tap share | The share image is pre-rendered when the death happens, so the tap calls the system share sheet immediately (Safari drops the share permission after an async gap). Clip needs a second tap after it renders | Browser user-activation rules |
| Share link | `https://<site>/?via=share` in the text line; the image and clip carry the bare domain | Visible, honest attribution; no identifiers |
| Personal stats | `localStorage` only, never sent to the server. A death counts for you if you pressed something during that run | Anonymous by construction |
| Link previews | Static Open Graph + Twitter tags, a 1200x630 image rendered from the real renderer, icons, theme color. `SITE_URL` is required at build time so previews never ship with relative or localhost URLs | Crawlers don't run JS; absolute URLs are required by every unfurler |
| Analytics | First-party, built into the server: aggregate counters only. No cookies, no IP or user agent stored, no per-person rows | Free, privacy-friendly, and answers exactly the three questions (where from, how long, came back) |
| "Came back" | The browser remembers its first-visit day and first source locally; once per day it reports `{cohort day, first source}`. The server only counts | Retention by source without any identifier |
| "How long" | Once-per-visit milestone beacons: played (first input), 30 s, 2 min, 5 min, 15 min of visible time | Counters, no double counting, robust to phones killing tabs |
| Tracking links | `?via=<tag>` (e.g. `?via=webgames`), removed from the address bar after reading; referrer hostname as a fallback | Short and transparent |
| Dashboard | `/stats?key=…` served by the game server (key from `STATS_KEY`) | No third-party service |
| Production serving | The game server also serves the built client (`npm run build && npm start`) | Needed for link previews and for a load test against the real build |
| Cost cap | Budget governor in the server (spec §10) adapted to one process: month-to-date estimate from machine hours + bytes sent, alerts at the alert amount and 50/70/90/100%, frame rate 20→12 Hz at 70%, no new players past current capacity at 90%, "Blobocracy is packed" screen at 100%. Plus a hard `MAX_PLAYERS` connection cap | Fly has no spending limit of its own |
| Alerts | Webhook (Discord or Slack format) from `ALERT_WEBHOOK_URL` | Free, instant on a phone |

## Tasks

1. **Shared**: `peak` players per run in the death event; zone name available for the share text.
2. **Personal stats** (`client/src/stats.ts`): days played, deaths you were part of, best run you were part of; tests.
3. **Share card**:
   - `client/src/share/card.ts`: draws the 1080x1350 image (death number, how far, cause, zone, players, your stats, wordmark + URL).
   - `client/src/share/text.ts`: the plain text line; tests.
   - `client/src/share/recorder.ts`: frame ring buffer.
   - `client/src/share/clip.ts`: re-render last ~6 s at 1080x1920 + end card, encode to MP4.
   - `client/src/share/ui.ts`: DOM share pill under the death card (stays ~25 s), panel with the three options; system share sheet on phones, download + copy on desktop. Accessible, never steals game keys.
4. **Link previews**: meta tags, `tools/og-image.ts` renders `og.png` + icons from the real renderer, build-time `SITE_URL` check, `tools/unfurl-check.ts` validates tags and draws simulated iMessage / Discord / X / Reddit previews.
5. **Analytics**: `client/src/analytics.ts`, `sim/src/analytics.ts` (validation, aggregation, persistence, rate limit), `/stats` dashboard; tests.
6. **Production serving** in the server: static files from `client/dist`, cache headers, gzip; `/api/status`.
7. **Budget governor + alerts + capacity cap + packed screen**; tests with a fake clock and a local webhook receiver.
8. **Load test** (`tools/loadtest.ts`): spike from 0 to N real WebSocket players across worker threads; reports connect success, frames/s per player, frame gap p50/p99, ping p50/p99, server tick rate, CPU and memory. Then a cost-cap drill: tiny budget, prove each alert fires and each degradation step engages.
9. **Launch kit** (`docs/launch/`): Show HN, four subreddit drafts following each sub's current rules, tracking links, launch day checklist in Eastern time.
10. Screenshots of the share card, clip frames, link previews, dashboard, packed screen; README and CHECKLIST updates.

## What this cannot prove from here

- Real unfurls in iMessage, Discord, X and Reddit need a public URL. The previews shown are drawn from the actual tags the page serves; final check is on the deployed URL (in the checklist).
- The load test runs on this 4-CPU container against a single process, with the load generator on the same machine. It proves the server's behaviour under a spike; it does not prove Fly's network.
- The cost cap is the game's own estimate (Fly has no hard limit). It is calibrated to Fly's published prices and should be checked against the first real invoice.
