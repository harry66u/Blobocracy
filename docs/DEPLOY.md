# Deploying Blobocracy to Fly.io

This walks you from no account to a live game. It takes about 30 minutes. Every command runs in a terminal on your computer, inside the project folder.

What you'll end up with:

| Piece | Where | Cost at normal traffic |
|---|---|---|
| Game server ("sim"): physics, voting, cost cap | 1 Fly machine, always on | about $4/month |
| Relay ("edge"): serves the site and player connections | 1 Fly machine always on, plus up to 4 faster "burst" relays that start by themselves in a spike | about $4/month, plus spikes |
| Run history, clips, hall of fame | Neon Postgres, free tier (see the note in step 1) | $0 to $19 |
| Live state, shared abuse counters | Redis (strongly recommended, see "Redis" below) | about $2–10/month |
| Data transfer | Fly | about $4/month at ~30 players on average |

Total: roughly $15–25 a month at normal traffic. The game's own cost cap holds the month at **$50**, and it alerts you at **$25** (and again at 70%, 90% and 100%).

## 1. Accounts

1. **Fly.io**: sign up at https://fly.io/app/sign-up. Fly asks for a payment card before you can create machines.
2. **Neon** (free Postgres): sign up at https://neon.tech. Create a project:
   - Region: **AWS US East (N. Virginia)** (closest to Fly's `iad`).
   - Copy the connection string it shows (it starts with `postgresql://` and ends with `?sslmode=require`). You'll paste it in step 4.
   - **Free tier limits:** Neon's free plan includes a limited number of compute hours a month and suspends the database when it is idle. The game writes to the database on every death, so while people are playing it never goes idle, and a busy month can use up the free hours (the database then stops until the next month; the game keeps going, but history writes queue in memory). Check the usage page in Neon's console after the first week. If it is on track to run out, move to Neon's paid plan (about $19/month) or use the **Supabase** free tier instead (Project settings → Database → connection string, "Session pooler", with `?sslmode=require`); Supabase's free projects only pause after a week with no activity.
3. **Alerts** (recommended): make a Discord channel for alerts, then Channel settings → Integrations → Webhooks → New webhook → Copy webhook URL. A Slack incoming-webhook URL works too.

## 2. Install the Fly command line tool

macOS:

```bash
brew install flyctl
```

Linux:

```bash
curl -L https://fly.io/install.sh | sh
```

Windows (PowerShell):

```powershell
iwr https://fly.io/install.ps1 -useb | iex
```

Then log in (it opens your browser):

```bash
fly auth login
```

## 3. Create the app

App names are global on Fly. Try `blobocracy`; if it's taken, pick another (for example `blobocracy-game`).

```bash
fly apps create blobocracy
```

If you used a different name, change two lines in `fly.toml`: `app = "..."` and the `SIM_URL` line (`ws://sim.process.<your-app-name>.internal:8081/relay`).

## 4. Secrets

Generate three random secrets and set everything in one go (paste your Neon string and webhook URL where shown). The game refuses to start in production without `SESSION_SECRET`, `RELAY_SECRET` and `DATABASE_URL`:

```bash
fly secrets set \
  SESSION_SECRET=$(openssl rand -hex 32) \
  RELAY_SECRET=$(openssl rand -hex 32) \
  ADMIN_TOKEN=$(openssl rand -hex 32) \
  DATABASE_URL='postgresql://…your Neon string…' \
  ALERT_WEBHOOK_URL='https://discord.com/api/webhooks/…'
```

Save the `ADMIN_TOKEN` somewhere safe (a password manager). You need it to see stats and to raise the budget. To print it later, there is no "show" command, so if you lose it just set a new one with `fly secrets set ADMIN_TOKEN=$(openssl rand -hex 32)`.

On Windows without `openssl`, use any password generator to make three long random strings instead.

## 5. Deploy

The first time, deploy with `--ha=false`. Without it Fly creates two machines per process group for high availability, and there must only ever be **one** sim (two would each run their own blob):

```bash
fly deploy --ha=false
```

The first deploy builds the image (a few minutes), creates the sim's 1 GB data volume, and starts one sim, one edge and one burst relay. **Stop that burst relay right away** (step 6 shows how): it belongs stopped until a spike, and while it runs the load balancer sends it half the visitors. Later deploys are a plain `fly deploy`: it keeps the number of machines in each group. When it finishes, open the game:

```bash
fly open
```

Check both machines are healthy:

```bash
fly status
```

## 6. Spike capacity (do this once)

The spike relays are their own process group, `burst`, defined in `fly.toml`: faster `performance-1x` machines whose price is reported to the cost cap. Because their size and price live in `fly.toml`, later deploys keep them as they are. Create four:

```bash
fly scale count burst=4
```

Then stop them. A stopped machine costs a few cents a month; Fly starts one automatically when the running relays pass 600 players each, and stops it again a few minutes after traffic falls. The number you create is a hard ceiling on relay compute. Find their ids (the `PROCESS` column says `burst`):

```bash
fly machine list
```

```bash
fly machine stop <burst-id-1> <burst-id-2> <burst-id-3> <burst-id-4>
```

(If you skip this, Fly stops idle burst relays by itself after a few minutes; stopping them yourself just saves those minutes.)

With 1 always-on relay plus 4 burst relays the game holds about 3,000 players comfortably (600 each) and up to about 5,000 at the hard limit before the "packed" screen. Raise the ceiling with `fly scale count burst=6` (and stop the new ones).

**Ready for a viral spike (tens of thousands of players):** capacity grows with the number of burst relays, about 600–1,000 players each, so 20,000 players needs about 25–30 burst relays (`fly scale count burst=30`, then stop them). Stopped relays only cost their disk (cents each per month). But a crowd that size also uses about $3–4 an hour in data transfer, so at your $50 monthly cap the game will hold that crowd for a limited time and then show the "packed" page. When you decide it's worth it, raise the budget live (section 7) and the relays are already there.

**Check after a spike** that the always-on relay is the `edge` machine: `fly status` should show the `edge` machine started and the `burst` machines stopped. Fly keeps one relay running but does not promise which. If a burst machine is the one left running (about $31/month instead of $4), start the edge and stop the burst one: `fly machine start <edge-id>` then `fly machine stop <burst-id>`. The cost cap counts whatever runs at its real price either way.

## 7. Cost safety

- **The game's cap** (already on): `BUDGET_MODE=cap`, `MONTHLY_BUDGET_USD=50`, `BUDGET_ALERT_USD=25` in `fly.toml`. As estimated spend nears $50 the game lowers its update rate (70%), then turns new visitors into watchers (90%). At 100% only the always-on relay keeps players, up to its capacity (600): the burst relays close their connections and those players see "Blobocracy is packed", and new visitors get the packed page.
- **What the cap cannot do:** Fly's proxy starts stopped burst relays by itself whenever the running relay is past its soft limit; the game cannot prevent that. At 100% a burst relay that Fly starts only serves the packed page and has no players, so Fly stops it again after a few idle minutes. Those minutes are still billed (and counted in the estimate), so a huge crowd at the cap costs a little more than nothing. The real ceiling is how many burst machines exist (step 6).
- **Idle players:** a browser tab left in the background disconnects after a minute and reconnects when it is shown again, and a connection that sends no input for 10 minutes (`IDLE_DISCONNECT_MIN`) is closed; the player rejoins with any key press or tap. Forgotten tabs therefore stop costing bandwidth.
- **Raise the cap on purpose** if the game takes off (no redeploy needed):

  ```bash
  curl -X POST https://<your-app>.fly.dev/admin/budget -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"monthlyUsd": 100}'
  ```

  To make it permanent, change `MONTHLY_BUDGET_USD` in `fly.toml` and run `fly deploy`.
- **Fly itself has no spending limit.** Its only hard stop is prepaid credit running out, which suspends the whole account (and takes the game down). Keep a card on file, and check Fly's dashboard → Billing for any usage alerts it offers.

## 8. Check it's working

- Game: `https://<your-app>.fly.dev`
- Run history: `https://<your-app>.fly.dev/runs`
- Hall of fame: `https://<your-app>.fly.dev/hall`
- Stats (players, relays, budget):

  ```bash
  curl https://<your-app>.fly.dev/admin/stats -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
  ```

- Logs:

  ```bash
  fly logs
  ```

## Redis (strongly recommended)

Without `REDIS_URL` the game works, but each relay keeps its own abuse state: the per-IP connection cap and the shadow-ban flags apply per relay, so during a spike (when burst relays run) one address can hold more connections than intended, and a flagged bot that reconnects to a different relay starts clean. The budget counters and the live snapshot fall back to files on the sim's volume, which is fine. With Redis all relays share the counts and the flags, and a sim restart resumes from the snapshot in Redis.

Two ways to get one:

- **Upstash Redis through Fly** (managed, nothing to run):

  ```bash
  fly redis create
  ```

  Pick the region `iad` and no eviction. It prints a `redis://…` URL. Upstash bills per command; the game sends a few hundred thousand commands a day while people play (the snapshot every 2 seconds, each relay's counts every 2 seconds), which is a few dollars a month on pay-as-you-go. Check the usage page after a week, and pick a fixed plan if it is cheaper.
- **A small Redis machine in your Fly account** (about $2.35/month with its volume; this is the `PRICE_FIXED_MONTHLY_USD` the cost cap already assumes). Follow Fly's "Redis on Fly" guide (a `shared-cpu-1x` machine with 256 MB and a 1 GB volume), reachable at `<redis-app>.internal`.

Then:

```bash
fly secrets set REDIS_URL='redis://…'
```

If you use Upstash's per-command pricing instead of the machine, set `PRICE_FIXED_MONTHLY_USD` in `fly.toml` to your expected monthly Redis bill, so the cost cap counts it.

## 9. Your own domain (optional)

```bash
fly certs add blobocracy.com
```

Fly prints the DNS records to add at your registrar. Then set the public URL so link previews use it:

```bash
fly secrets set PUBLIC_URL=https://blobocracy.com
```

(The game only accepts connections from pages on its own site: `PUBLIC_URL` and whatever host the request was made to, so both `<your-app>.fly.dev` and your domain work.)

## Updating the game

Commit your changes, then:

```bash
fly deploy
```

The run in progress survives deploys and restarts (the sim saves a snapshot every 2 seconds and resumes from it). A restart is never counted as a death.

## Banning someone

```bash
curl -X POST https://<your-app>.fly.dev/admin/ban -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"cidr": "203.0.113.0/24"}'
```
