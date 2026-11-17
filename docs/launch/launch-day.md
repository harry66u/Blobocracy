# Launch day checklist (US Eastern time)

All times are Eastern. In November and December that's EST, UTC−5, so 8:00 AM ET = 13:00 UTC.

**Pick the day:** a Tuesday, Wednesday or Thursday. Avoid Thanksgiving week (23–27 Nov 2026), when traffic and moderators are thin. Post one place at a time: one spike at a time is easier to handle, and you can answer every comment.

## Before launch day (the week before)

Must be true before posting anywhere:

- [ ] **The game is ready to be judged.** Today only zones 1–2 of 6 exist (milestone 2 is in progress). Launch when the level is complete, or say plainly in every post that it's unfinished.
- [ ] **Deployed** on the real domain, with HTTPS.
- [ ] Built with the real address: `SITE_URL=https://<your-domain> npm run build`. The build refuses to run without it, so previews can't ship with the wrong address.
- [ ] Server environment set: `STATS_KEY`, `ADMIN_KEY` (long random strings), `ALERT_WEBHOOK_URL` (a Discord or Slack channel on your phone), `MONTHLY_BUDGET_USD=50`, `BUDGET_ALERT_USD=25`, `BUDGET_MODE=cap`, `DATA_DIR` on a persistent volume.
- [ ] Set `BASE_MONTHLY_USD` to your real always-on machine cost from the host's pricing page, so the estimate starts honest.
- [ ] **Alerts reach your phone.** Run the fire drill (`npx tsx tools/capdrill.ts`) once locally. Then, against production, temporarily set `BUDGET_ALERT_USD=0.01`, restart, wait a minute for the alert, and set it back.
- [ ] Turn on the host's own billing alerts too, and keep a card on file. The game's cap is an estimate, so the host's alerts are the backstop.
- [ ] **Link previews, for real.** Paste the bare URL into: an iMessage to yourself, a Discord DM, an X DM or draft, a Slack DM, and WhatsApp. Check that the image, title and domain show. If an old preview is cached, change `?v=` on the image by re-rendering it (`npm run og`) and rebuilding.
- [ ] Play it on a real iPhone and a real Android phone: touch controls, share sheet with the image, the clip, copy text.
- [ ] Open `https://<your-domain>/stats?key=<STATS_KEY>` and bookmark it on your phone.
- [ ] Write your Show HN text yourself ([show-hn.md](show-hn.md)) and rewrite the Reddit drafts in your own voice.
- [ ] Check each subreddit's sidebar and rules while logged in (flair, account age, title format).
- [ ] Record two or three good clips with the in-game share button for r/IndieGaming and social posts.

## Launch day

| Time (ET) | Do |
|---|---|
| 7:00 AM | Health check: open `https://<your-domain>/api/health` (expect `"ok":true`, `"tickHz"` near 60, `"level":"normal"`). Play one run on your phone. Glance at the stats page. |
| 7:30 AM | Have the game open in a tab so there's at least one player when people arrive. Phone on loud for alerts. |
| **8:00–9:00 AM** | **Post Show HN** (plain URL, your text). If your text doesn't show at the top, post it as the first comment right away. Don't ask anyone to upvote. |
| 8:00–11:00 AM | Stay on HN and answer every comment in your own words. Every 30 minutes, look at the stats page (visitors, "played", "stayed 2 min") and `/api/health`. |
| 11:00 AM | **Checkpoint.** If Show HN is on the front page, skip Reddit today and keep answering. If not, post **r/WebGames** (`?via=webgames`) and its first comment. |
| 12:00–1:00 PM | Eat. Check alerts and the stats page once. |
| 2:00 PM | Reply round on HN and Reddit. Fix anything small that people report. Don't deploy anything risky today. |
| 5:00 PM | Share with friends and Discord servers you're already part of (`?via=friends`, `?via=discord-<server>`), using a share image or clip. |
| 9:00 PM | Write down today's numbers per source: visitors, % played, % stayed 2 min, shares. Note any bug reports for tomorrow. |

**Day 2, about 10:00 AM ET:** post **r/IndieGaming** with your best clip (`?via=indiegaming`) and the AI disclosure. Check "back next day" on the stats page for yesterday's visitors.

**Day 3 onward:** r/playmygame if its rules fit (`?via=playmygame`). Check "back within 7 days" a week after launch. That number, together with shares per visitor, says whether it's spreading on its own.

## If an alert fires

| Alert | Means | Do |
|---|---|---|
| "passed the alert amount ($25)" | Half the month's budget is gone | Look at `/api/health?key=<ADMIN_KEY>`. If the traffic is worth it, raise the budget: `curl -X POST "https://<your-domain>/admin/budget?key=<ADMIN_KEY>&usd=100"` |
| "reached 70%… reduced frame rate" | Everyone now gets 12 frames/s instead of 20. The game still plays fine. | Raise the budget if you want full smoothness back |
| "reached 90%… holding capacity" | No new players beyond `BASE_CAPACITY`; extra visitors see "Blobocracy is packed" | Raise the budget, or accept it |
| "reached 100%… packed" | Only `PACKED_CAPACITY` players; everyone else sees the packed screen with the live death counter | Raise the budget or wait for next month |
| "Blobocracy is full" | `MAX_PLAYERS` reached (a CPU limit, not money) | Expected in a big spike. The packed screen handles it. Raising `MAX_PLAYERS` needs a bigger machine. |
| "server is falling behind" | Ticks below 50/s | Check CPU on the host. Lower `MAX_PLAYERS` and restart if it continues. |

Raising the budget takes effect immediately, without a restart, and the game posts "back to normal" to the same channel.

## What not to do

- Don't post to several places in the same hour.
- Don't ask friends to upvote or comment on HN or Reddit.
- Don't delete and repost a post that didn't take off.
- Don't argue with criticism. Thank people, fix what's fair, and say so in the thread.
