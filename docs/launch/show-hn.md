# Show HN

**You write this one yourself, by hand.** HN's Show HN guidelines (updated March 2026) say: "Write your text by hand. Don't use an LLM to generate any of it (not even a tiny bit, including to edit or spruce it up)." The general guidelines say: "Don't post generated text or AI-edited text." Breaking this is the fastest way to get flagged, and people there do check. So this page has the rules, the facts you'll want at hand, and a shape to follow. It has no draft sentences.

Sources: https://news.ycombinator.com/showhn.html, https://news.ycombinator.com/newsguidelines.html, dang's Show HN tips (https://news.ycombinator.com/item?id=22336638).

## Rules that apply

- Title starts with `Show HN: `. No uppercase words for emphasis, no exclamation marks, no hype ("revolutionary", "the first ever"), no gratuitous numbers.
- It must be something people can try now, ideally with no signup. Blobocracy qualifies: open the link and you're playing.
- Don't ask anyone to upvote or comment, and don't let friends post booster comments. HN detects voting rings and penalises the post.
- Don't delete and repost. If it sinks, you can email hn@ycombinator.com and ask about the second-chance pool. Don't repost it yourself.
- Use your personal account. The guidelines discourage a username that's just the project's name.
- Link the game directly. Use a plain URL, no tracking tag: HN shows up as "hn" on the stats page from the referrer anyway.

## Fact sheet (true as of this build; update before posting)

- What it is: a browser game where everyone on the site controls the same single blob at once. Every player's left/right/jump is blended into one movement.
- One shared life: a death sends everyone back to the start and adds one to a global death counter.
- Blending: horizontal pull is (right − left) / active voters, shaped by a response curve (|pull|^0.6) so a clear majority moves briskly. Jumps fire when 30% of active voters press, or when a fresh burst of presses arrives, and the crowd controls jump height by how long it holds. One player alone has full control.
- Only players who pressed something in the last 3 s count, so idle tabs don't dilute the crowd. If nobody is pressing, the world pauses and the blob dozes.
- The server is the only source of truth. Clients send 3 bits of intent; the server runs the physics at 60 Hz and sends about 86-byte state frames 20 times a second.
- The crowd you see: 128 real, randomly sampled players drawn as dots, leaning the way they're actually pressing.
- Stack: TypeScript, uWebSockets.js on the server, a hand-written Canvas 2D renderer (no game engine), Vite. About 29 KB gzipped of JavaScript for the game page.
- Load test (this container, 4 CPUs): a spike from 30 to 6,000 players in 10 seconds. The server held 5,000 (its cap) at a steady 60 ticks/s and about 20 frames/s per player, at about 60% of one CPU core and 90 MB of memory. The 1,000 over the cap got a "packed" screen instead of an error. See [readiness.md](readiness.md).
- Cost cap: the game estimates its own monthly spend and steps down in stages (fewer frames, then no new players), because the host has no spending limit.
- Privacy: no accounts, no cookies, no IPs stored. Analytics are first-party daily counters only.
- Sharing: after a death you can share an image or a 9-second vertical clip. Both are re-rendered from the frames your browser already received.
- [Fill in: how long you've been working on it, why you made it, what surprised you in playtesting (e.g. crowds can't let go of jump together, which led to the "fresh burst" rule), what you'd like feedback on.]
- [Fill in, if you'll mention it: how you used AI to build it. Saying it plainly beats having someone ask.]

## A shape that works (your words)

1. **Title.** `Show HN: Blobocracy –` plus a plain description of what happens, in under about 80 characters. Say what it is, not how good it is.
2. **First paragraph.** What it is and what happens when you open it.
3. **The interesting problem.** One or two technical or design details HN readers will enjoy: blending thousands of inputs into one movement that still feels controllable, the jump rule, how deaths are made to feel fair. Pick from the fact sheet.
4. **Honest limits.** What's unfinished. For example, if it launches before all six zones are done, or what happens when it's full.
5. **What you want.** A specific question beats "feedback welcome".

If the text box at submission doesn't show your text, post it as the first comment right away.

## On the day

- Post between 8:00 and 9:00 AM Eastern, Tuesday to Thursday (see [launch-day.md](launch-day.md)). Two large studies of Show HN posts disagree on the best hour, so treat timing as a tiebreaker, not a strategy.
- Stay for the first three hours and answer every question, in your own words. Concede good criticism quickly.
- Expect the "it's just chaos" comment. Showing the stats page's "played" and "stayed 2 min" numbers is a better answer than arguing.
