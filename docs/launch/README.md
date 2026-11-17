# Blobocracy launch kit

Everything for going from 0 to thousands of players through honest sharing.

| File | What it is |
|---|---|
| [launch-day.md](launch-day.md) | The launch day checklist, in US Eastern time, plus the week before |
| [show-hn.md](show-hn.md) | Show HN: rules, a fact sheet and a structure. **No ready-made text, on purpose** (see below) |
| [reddit-webgames.md](reddit-webgames.md) | r/WebGames draft |
| [reddit-indiegaming.md](reddit-indiegaming.md) | r/IndieGaming draft (with the AI disclosure that sub requires) |
| [skipped-subreddits.md](skipped-subreddits.md) | Why r/InternetIsBeautiful and r/incremental_games are not in the plan, and what to do instead |
| [readiness.md](readiness.md) | Load test and cost-cap drill results: what was proven and what wasn't |

## Read this first

1. **Show HN text has to be yours.** Since March 2026 the Show HN guidelines say: "Write your text by hand. Don't use an LLM to generate any of it (not even a tiny bit, including to edit or spruce it up)." The HN guidelines also say "Don't post generated text or AI-edited text." So [show-hn.md](show-hn.md) gives you facts and a shape, not prose. Write the title, the post and your replies yourself.
2. **Two of the four subreddits you named would be rule-breaking posts.** r/InternetIsBeautiful bans web games (its rule 3), and r/incremental_games is only for incremental/idle games. Details and alternatives are in [skipped-subreddits.md](skipped-subreddits.md).
3. **Rewrite the Reddit drafts in your own voice.** They are starting points. Reddit readers spot marketing copy fast, and r/IndieGaming requires saying how AI was used, including in the game itself.
4. **Rules were checked on 17 Nov 2026, partly through third-party mirrors.** Reddit blocked direct reads of the rules pages from here. Open each sub's sidebar and rules while logged in before posting.

## Tracking links

Use one tag per place you post, so the stats page can tell them apart. The tag is removed from the address bar when someone arrives, so if they copy the link and pass it on, the next visitor doesn't inherit your tag.

| Where | Link |
|---|---|
| Show HN | `https://<your-domain>/` (plain: HN is recognised from the referrer, and a clean URL looks better there) |
| r/WebGames | `https://<your-domain>/?via=webgames` |
| r/IndieGaming | `https://<your-domain>/?via=indiegaming` |
| r/playmygame | `https://<your-domain>/?via=playmygame` |
| X / Bluesky / Threads | `?via=x`, `?via=bluesky`, `?via=threads` |
| Discord servers you're in | `?via=discord-<server>` |
| Friends and family | `?via=friends` |

Visitors from HN, Reddit, X, Discord and others are recognised from the referrer even without a tag; the tag just makes it precise (Reddit's apps often strip the referrer). Players' own shares carry `?via=share`.

The stats page is at `https://<your-domain>/stats?key=<STATS_KEY>`. It shows visitors per day, and for each source: how many pressed a button, how many stayed 2, 5 and 15 minutes, how many came back the next day and within a week, and how many shared.
