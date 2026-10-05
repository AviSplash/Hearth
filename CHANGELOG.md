# Changelog

## 1.5.0

**Run Hearth in the cloud.** Besides a computer at home, Hearth now runs on Vercel, Cloudflare Workers, Render, Fly.io, Railway and any Docker or Node.js host. See [docs/cloud.md](docs/cloud.md).

- **Household password.** On the internet, every screen signs in once with `HEARTH_PASSWORD` and then stays signed in. At home this is optional. Settings → Connect devices can sign a single screen out.
- **Cloud storage.** Household data can live in Upstash Redis (the Vercel Marketplace default), PostgreSQL or Cloudflare D1, as well as the data folder. Saves check a version number, so screens and servers saving at the same moment don't overwrite each other.
- **Updates without a long-lived server.** On serverless hosts, screens check a small change counter every 15 seconds (`HEARTH_POLL_SECONDS`) and remind the server to refresh calendars that are due. Home and single-server setups keep instant live updates.
- **Safer calendar links in the cloud.** Links into private networks (`localhost`, `192.168.x.x`, cloud metadata addresses and so on) are refused, including through redirects.
- **Cloud version of Connect devices**: the https address with a QR code, and install steps without the certificate.
- **The first screen to sign in sets the time zone**, until you pick a town for the weather, because cloud servers run on UTC.
- **Deploy buttons** for Vercel, Cloudflare and Render, and `scripts/move-data.js` to copy your data from home into the cloud and back (or into a backup).
- Preact and htm are now shipped in `public/vendor/`, so CDN hosts can serve the whole app (`npm run vendor` refreshes them).
- Synced calendars are now cached one file per calendar (`data/calendars/`). The old `calendar-cache.json` is converted on first start.

Upgrading a home install works as before (`git pull && ./install.sh`, or `git pull && npm ci` on Windows). Your data and the installed certificate stay as they are.

## 1.0.0

The first release: Today dashboard, calendar with Google, Outlook and iCloud sync, chores and rewards, lists, meal planner, parent PIN, live sync between screens, and installers for Windows, macOS, Ubuntu, Raspberry Pi and Docker.
