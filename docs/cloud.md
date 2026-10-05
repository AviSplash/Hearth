# Running Hearth in the cloud

*New in 1.5.* Hearth can run on Vercel, on Cloudflare, or on any service that runs Node.js or Docker (Render, Fly.io, Railway, Google Cloud Run and others). Your tablets and phones then open it at an https address from anywhere, and nothing needs to run at home.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAviSplash%2FHearth&project-name=hearth&repository-name=hearth&env=HEARTH_PASSWORD&envDescription=The%20household%20password%20every%20screen%20signs%20in%20with%20%288%20or%20more%20characters%29&envLink=https%3A%2F%2Fgithub.com%2FAviSplash%2FHearth%2Fblob%2Fmain%2Fdocs%2Fcloud.md%23the-household-password&stores=%5B%7B%22type%22%3A%22integration%22%2C%22protocol%22%3A%22storage%22%2C%22productSlug%22%3A%22upstash-kv%22%2C%22integrationSlug%22%3A%22upstash%22%7D%5D)
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/AviSplash/Hearth)
[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/AviSplash/Hearth)

## What's different from running it at home

| | At home | In the cloud |
| --- | --- | --- |
| Address | `http://192.168.x.x:3000`, on your Wi-Fi only | `https://your-hearth…`, from any network |
| Installing as an app | Install Hearth's certificate on each tablet first | Works straight away, because the host provides https |
| Who can open it | Anyone on your Wi-Fi | Screens that sign in with the household password |
| Where data lives | The `data` folder | A database, or a disk on container hosts |
| Changes from other screens | About a second | About a second on a host with a disk; otherwise within 15 seconds |
| Synced calendars | Any iCal link, including ones on your home network | Public iCal links (Google, Outlook, iCloud and so on) |

Everything else works the same: the Today dashboard, chores and stars, rewards, lists, meals, weather and the parent PIN.

## The household password

Every cloud setup needs **`HEARTH_PASSWORD`**, 8 characters or more. Anyone who has it can see your family's calendar, so treat it like any other password. A few random words make a good one.

- Each tablet, phone or computer asks for it once, then stays signed in. The sign-in renews itself while the screen is in use, so a wall tablet never has to sign in again.
- **iPhone and iPad:** an app added to the Home Screen keeps its own sign-in, separate from Safari, so you sign in once more inside it.
- **Sign one screen out:** Settings → Connect devices → *Sign out this screen*. If a parent PIN is set, this asks for it, so kids can't lock the wall tablet out.
- **Sign every screen out**, for example if a tablet goes missing: change `HEARTH_PASSWORD` where Hearth is hosted and redeploy.
- After 5 wrong passwords from one address, Hearth waits a minute before accepting more.

The parent PIN works on top of this, just as it does at home.

## Pick a host

| Host | Storage | Changes show up | Good to know |
| --- | --- | --- | --- |
| **Vercel** | Upstash Redis or Neon Postgres, from the Vercel Marketplace | Within 15 s | The Hobby plan is free for personal use |
| **Cloudflare Workers** | Cloudflare D1, created for you | Within 15 s | Works on the Workers free plan |
| **Render, Fly.io, Railway** | A small disk, or Postgres/Redis | About 1 s with a disk | An always-on service with a disk usually costs a few dollars a month |
| **Any other Docker or Node.js host** | A disk, or Postgres/Redis | About 1 s with a disk | The host must put https in front of Hearth |

### Vercel

Click **Deploy with Vercel** above. It copies Hearth to your GitHub account, offers to add an Upstash Redis database, and asks for `HEARTH_PASSWORD`. When it finishes, open the address Vercel gives you and sign in.

To set it up by hand instead:

1. Put Hearth in your own GitHub account (fork it, or push a copy).
2. In Vercel, choose **Add New → Project** and import it. Vercel detects **Express**, so there's nothing to configure.
3. In the project, open **Storage → Create Database**, choose **Upstash** (Redis) and connect it to the project. This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Neon (Postgres) works too; it adds `DATABASE_URL`.
4. In **Settings → Environment Variables**, add `HEARTH_PASSWORD`.
5. Redeploy (**Deployments → ⋯ → Redeploy**). Changes to environment variables only reach new deployments.

Notes:

- Vercel serves the app from its CDN and runs the server part as one function, using the root `app.js`.
- Preview deployments use the same database as production. If you open pull requests against your copy, scope the storage variables to *Production* only.

### Cloudflare

Click **Deploy to Cloudflare** above. It copies Hearth to your GitHub account, creates the D1 database, asks for `HEARTH_PASSWORD` and deploys. Your Hearth then lives at `https://hearth.<your-subdomain>.workers.dev`.

To set it up from your own computer instead:

```bash
npm ci
npx wrangler login
npx wrangler deploy                          # creates the D1 database the first time
npx wrangler secret put HEARTH_PASSWORD      # takes effect straight away
```

Until the password is set, the page says *Almost there* and explains what's missing.

Notes:

- `wrangler.jsonc` holds the setup. Workers Static Assets serves `public/`, and requests under `/api` run `server/cloudflare.js`.
- Older Wrangler versions (before 4.45) can't create the database by themselves. Run `npx wrangler d1 create hearth`, then copy the `database_id` it prints into `wrangler.jsonc`.
- To use your own domain, open the Worker in the Cloudflare dashboard → **Settings → Domains & Routes**.
- To try it locally, copy `.dev.vars.example` to `.dev.vars`, fill it in, and run `npx wrangler dev`.

### Render

Click **Deploy to Render** above. It reads `render.yaml`, asks for `HEARTH_PASSWORD`, and creates a web service with a 1 GB disk for your data. Disks need a paid instance. On the free plan, delete the `disk` section from `render.yaml` and set `DATABASE_URL` (Render Postgres) or the Upstash variables instead. Free instances also go to sleep when idle and take a while to wake up.

### Fly.io

```bash
fly launch --no-deploy                       # uses the Dockerfile; skip the database offers
fly volumes create hearth_data --size 1
fly secrets set HEARTH_PASSWORD='three random words'
```

Then add this to the `fly.toml` that `fly launch` wrote, and check that `internal_port` is `3000`:

```toml
[mounts]
  source = "hearth_data"
  destination = "/data"

[http_service]
  internal_port = 3000
  min_machines_running = 1
```

Finally, run `fly deploy` and then `fly scale count 1`. A volume belongs to one machine, so Hearth must run on exactly one.

### Railway

1. **New Project → Deploy from GitHub repo**, and pick your copy of Hearth. Railway builds the `Dockerfile`.
2. Add a **Volume** to the service, mounted at `/data`.
3. Under **Variables**, add `HEARTH_PASSWORD`.
4. Under **Settings → Networking**, choose **Generate Domain**.

Keep it at one replica, since the volume belongs to one copy of Hearth.

### Google Cloud Run and other hosts

Any host that runs `npm ci --omit=dev && npm start` (Node.js 20 or newer) or the `Dockerfile` will do. Set:

- `HEARTH_MODE=cloud`. Hearth detects Vercel, Render, Fly.io, Railway, Cloud Run, Heroku and Azure App Service by itself, so this is only needed elsewhere.
- `HEARTH_PASSWORD`.
- Somewhere to keep data. Use `DATA_DIR` on a lasting disk if you run exactly one copy of Hearth. Otherwise, for hosts without disks (such as Cloud Run) or with several copies running, use `DATABASE_URL` or the Upstash variables.

The host must provide https in front of Hearth. Hearth listens on `PORT`.

## Settings you can change with environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `HEARTH_PASSWORD` | *(none)* | The household password. Required in the cloud. At home it's optional and turns sign-in on. |
| `HEARTH_MODE` | detected | `cloud` or `home` |
| `HEARTH_STORAGE` | detected | `file`, `redis`, `postgres` or `d1`. In the cloud, Hearth uses the first one that's configured. At home it uses the data folder unless you set this. |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | *(none)* | Upstash Redis. `KV_REST_API_URL` and `KV_REST_API_TOKEN`, which Vercel sets, work too. |
| `HEARTH_REDIS_PREFIX` | `hearth:` | Key prefix, so several Hearths can share one Redis database |
| `DATABASE_URL` | *(none)* | PostgreSQL. `POSTGRES_URL` works too. Hearth creates its one table, `hearth_documents`. |
| `DATA_DIR` | `./data` | The data folder, when keeping data on a disk |
| `HEARTH_POLL_SECONDS` | `15` | How often screens check for changes when live updates aren't possible (5 to 300) |
| `HEARTH_SECRET` | *(none)* | Optional extra key for signing sign-ins. Changing it signs every screen out. |
| `PORT` | `3000` | Most hosts set this for you |

## Moving your data

`scripts/move-data.js` copies your household (family, events, chores, stars, lists, meals and settings) between a data folder and cloud storage. Run it from a copy of Hearth after `npm ci`. Synced calendars aren't copied; they download again within a minute or two.

```bash
# From your computer at home into Upstash or Postgres (use the same values as the host):
UPSTASH_REDIS_REST_URL=… UPSTASH_REDIS_REST_TOKEN=… node scripts/move-data.js
DATABASE_URL=postgres://… node scripts/move-data.js

# Into Cloudflare D1:
node scripts/move-data.js --sql hearth.sql
npx wrangler d1 execute hearth --remote --file=hearth.sql

# Back up the cloud (or move back home): copies into ./backup/hearth.json
DATABASE_URL=postgres://… node scripts/move-data.js --to-home --data ./backup
```

It won't replace household data that's already there unless you add `--force`. Use `--data <folder>` if your data folder isn't `./data`. On Cloudflare, `npx wrangler d1 export hearth --remote --output=hearth-backup.sql` makes a full backup. Exported files hold your PIN hash and private calendar links, so keep them somewhere safe.

## How live updates work in the cloud

On a host with a disk, Hearth runs as one long-lived server and pushes changes to every screen within about a second, just as it does at home.

Vercel and Cloudflare (and any setup with a shared database) may run many short-lived copies of Hearth, so screens ask "anything new?" every `HEARTH_POLL_SECONDS` instead. Each check is one tiny request. An always-on screen makes about 5,800 of them a day at the default 15 seconds, plus a few more when something changes. Hidden screens (screen off, app in the background) don't check. If several screens strain a free plan, set `HEARTH_POLL_SECONDS=30` to halve that.

These hosts also have no clock of their own, so open screens remind the server every few minutes to refresh synced calendars. A wall tablet is always open, so in practice calendars stay as fresh as at home.

## Security notes

- Everything is behind the household password, except the app's own files (HTML, scripts, icons), which contain no household data.
- The sign-in cookie is `HttpOnly`, `Secure` and `SameSite=Strict`.
- In the cloud, Hearth won't fetch calendar links that point into private networks (`localhost`, `10.x`, `192.168.x`, cloud metadata addresses and so on), including through redirects.
- Your database holds your household data, including the parent PIN (as a salted hash) and your private calendar links. Use a database account that only you control.

## Troubleshooting

| Problem | Fix |
| --- | --- |
| The page says *Almost there* | Follow what it lists. On Vercel and Render, environment variable changes only apply after a redeploy. |
| *Needs a database* on Vercel | Open the project's **Storage** tab, connect Upstash (or Neon), then redeploy. |
| Times are off by a few hours | Pick your town under Settings → Weather, which sets the time zone. You can also set it under Settings → General. Cloud servers run on UTC, so until then Hearth uses the time zone of the first screen that signed in. |
| Calendar says *private network address* | That calendar lives on your home network, which a cloud server can't reach. Use its public iCal link, or run Hearth at home. |
| Changes from a phone take a few seconds | That's normal on Vercel and Cloudflare. Lower `HEARTH_POLL_SECONDS` if you want them sooner. |
| *Too many tries* when signing in | Wait a minute, then try again. |
| Cloudflare deploy complains about `database_id` | Run `npx wrangler@latest deploy`, or create the database with `npx wrangler d1 create hearth` and copy its id into `wrangler.jsonc`. |
| Lost track of who's signed in | Change `HEARTH_PASSWORD` and redeploy. Every screen then has to sign in again. |
