# Deploying Blobocracy to Fly.io

This walks you from no account to a live game. It takes about 30 minutes. Every command runs in a terminal on your computer, inside the project folder.

What you'll end up with:

| Piece | Where | Cost at normal traffic |
|---|---|---|
| Game server ("sim"): physics, voting, cost cap | 1 Fly machine, always on | about $4/month |
| Relay ("edge"): serves the site and player connections | 1 Fly machine always on, up to 4 more that start by themselves in a spike | about $4/month, plus spikes |
| Run history, clips, hall of fame | Neon Postgres, free tier | $0 |
| Data transfer | Fly | about $4/month at ~30 players on average |

Total: roughly $12–15 a month at normal traffic. The game's own cost cap holds the month at **$50**, and it alerts you at **$25** (and again at 70%, 90% and 100%).

## 1. Accounts

1. **Fly.io**: sign up at https://fly.io/app/sign-up. Fly asks for a payment card before you can create machines.
2. **Neon** (free Postgres): sign up at https://neon.tech. Create a project:
   - Region: **AWS US East (N. Virginia)** (closest to Fly's `iad`).
   - Copy the connection string it shows (it starts with `postgresql://` and ends with `?sslmode=require`). You'll paste it in step 4.
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

Generate three random secrets and set everything in one go (paste your Neon string and webhook URL where shown):

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

```bash
fly deploy
```

The first deploy builds the image (a few minutes), creates the sim's 1 GB data volume, and starts one sim and one edge. When it finishes, open the game:

```bash
fly open
```

Check both machines are healthy:

```bash
fly status
```

## 6. Spike capacity (do this once)

Extra relays are created now and left **stopped**. A stopped machine costs a few cents a month. Fly starts them automatically when the running relay passes 1,500 players and stops them when traffic falls. The number you create is a hard ceiling on relay compute.

Find the edge machine's id:

```bash
fly machine list
```

Then clone it four times as a faster machine (repeat this line 4 times, with the edge machine id):

```bash
fly machine clone <edge-machine-id> --vm-size performance-1x --env MACHINE_HOURLY_USD=0.0431
```

Stop the clones (Fly will start them on demand):

```bash
fly machine stop <clone-id-1> <clone-id-2> <clone-id-3> <clone-id-4>
```

With 1 always-on relay plus 4 extras, the game holds roughly 10,000+ simultaneous players before the "packed" screen. Add more clones to raise that ceiling.

## 7. Cost safety

- **The game's cap** (already on): `BUDGET_MODE=cap`, `MONTHLY_BUDGET_USD=50`, `BUDGET_ALERT_USD=25` in `fly.toml`. As estimated spend nears $50, the game lowers its update rate, then turns new visitors into watchers, then shows a friendly "Blobocracy is packed" page. It never starts more relays past the cap.
- **Raise the cap on purpose** if the game takes off (no redeploy needed):

  ```bash
  curl -X POST https://blobocracy.fly.dev/admin/budget -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"monthlyUsd": 100}'
  ```

  To make it permanent, change `MONTHLY_BUDGET_USD` in `fly.toml` and run `fly deploy`.
- **Fly itself has no spending limit.** Its only hard stop is prepaid credit running out, which suspends the whole account (and takes the game down). Keep a card on file, and check Fly's dashboard → Billing for any usage alerts it offers.

## 8. Check it's working

- Game: `https://<app>.fly.dev`
- Run history: `https://<app>.fly.dev/runs`
- Hall of fame: `https://<app>.fly.dev/hall`
- Stats (players, relays, budget):

  ```bash
  curl https://blobocracy.fly.dev/admin/stats -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
  ```

- Logs:

  ```bash
  fly logs
  ```

## 9. Your own domain (optional)

```bash
fly certs add blobocracy.com
```

Fly prints the DNS records to add at your registrar. Then set the public URL so link previews use it:

```bash
fly secrets set PUBLIC_URL=https://blobocracy.com
```

## Updating the game

Commit your changes, then:

```bash
fly deploy
```

The run in progress survives deploys and restarts (the sim saves a snapshot every 2 seconds and resumes from it). A restart is never counted as a death.

## Banning someone

```bash
curl -X POST https://blobocracy.fly.dev/admin/ban -H "Authorization: Bearer YOUR_ADMIN_TOKEN" -H "Content-Type: application/json" -d '{"cidr": "203.0.113.0/24"}'
```
