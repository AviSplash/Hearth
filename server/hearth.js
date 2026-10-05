import express from 'express';
import { loadConfig } from './config.js';
import { createStorage } from './storage/index.js';
import { Store } from './store.js';
import { CalendarSync } from './calendar.js';
import { createApi } from './api.js';
import { sseHandler, clientCount } from './bus.js';
import { createSessions } from './session.js';
import { isValidTimezone } from './time.js';

/**
 * Set up Hearth on an Express app. Every way of running Hearth goes through
 * here: server/index.js (your computer, Docker, Render, Fly...), app.js
 * (Vercel) and server/cloudflare.js (Cloudflare Workers).
 *
 *   env       environment variables (on Cloudflare, also the bindings)
 *   platform  node, vercel or cloudflare
 *   dataDir   the data folder, for file storage on long-running servers
 *   d1        the Cloudflare D1 database binding
 *   system    extra connection details for Settings → Connect devices
 *   mount     adds this platform's own routes (static files) before the 404
 */
export function buildHearth(app, { env = {}, platform = 'node', dataDir, d1, system, mount } = {}) {
  const config = loadConfig(env, platform);

  // Things that stop Hearth from working until whoever deployed it fixes
  // them. The app shows these instead of a sign-in screen.
  const problems = [];
  let storage = null;
  try {
    storage = createStorage(env, { dataDir, d1, serverless: config.serverless, detect: config.mode === 'cloud' });
  } catch (err) {
    problems.push({ code: 'storage', message: err.message });
  }
  const loginRequired = config.mode === 'cloud' || !!config.password;
  if (loginRequired && !config.password) {
    problems.push({
      code: 'password',
      message: 'Hearth is on the internet, so it needs a household password. Set HEARTH_PASSWORD (8 characters or more) in your hosting dashboard, then redeploy.',
    });
  } else if (config.password && config.password.length < 8) {
    problems.push({ code: 'password', message: 'HEARTH_PASSWORD is too short. Use 8 characters or more, then redeploy.' });
  }

  const store = storage && new Store(storage);
  const sync = storage && new CalendarSync(store, { guard: config.mode === 'cloud' });
  const sessions = createSessions(config);
  // Live push needs one long-running server that sees every change.
  const live = storage && !storage.shared && !config.serverless ? 'sse' : 'poll';

  app.disable('x-powered-by');
  app.set('etag', 'strong');
  // In the cloud, the hosting service's proxy says who's visiting and
  // whether they used https.
  if (config.mode === 'cloud') app.set('trust proxy', true);
  app.use('/api', express.json({ limit: '256kb' }));

  // What a screen needs to know before it can show anything.
  app.get('/api/hello', (req, res) => {
    res.set('Cache-Control', 'no-cache').json({
      name: 'Hearth',
      version: config.version,
      mode: config.mode,
      loginRequired,
      signedIn: !loginRequired || sessions.signedIn(req),
      problems,
      live,
      pollSeconds: config.pollSeconds,
    });
  });

  app.post('/api/login', async (req, res) => {
    if (problems.length) return res.status(503).json({ error: problems[0].message, code: 'setup_required' });
    if (!loginRequired) return res.json({ ok: true });
    const result = sessions.login(req, res, req.body?.password);
    if (!result.ok) return res.status(401).json({ error: result.error, code: 'login_failed' });
    // Cloud servers run on UTC, so until someone picks a town for the
    // weather, the first screen to sign in sets the household's time zone.
    const tz = req.body.timezone;
    const unset = (d) => !d.settings.location && d.settings.timezone === 'UTC';
    if (isValidTimezone(tz) && tz !== 'UTC' && unset(await store.get())) {
      await store.update((d) => {
        if (unset(d)) d.settings.timezone = tz;
      });
    }
    res.json({ ok: true });
  });

  app.post('/api/logout', (req, res) => {
    sessions.logout(req, res);
    res.status(204).end();
  });

  app.use('/api', (req, res, next) => {
    if (problems.length) return res.status(503).json({ error: problems[0].message, code: 'setup_required' });
    next();
  });
  if (loginRequired) app.use('/api', sessions.require);
  if (live === 'sse') app.get('/api/stream', sseHandler);
  if (store) {
    app.use('/api', createApi({
      store,
      sync,
      serverless: config.serverless,
      system: async (req) => ({
        version: config.version,
        mode: config.mode,
        live,
        urls: [],
        https: null,
        ...(await system?.(req)),
        devicesConnected: live === 'sse' ? clientCount() : null,
      }),
    }));
  }

  mount?.(app, config);
  app.use((req, res) => res.status(404).send('Not found'));
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
    if (status >= 500) console.error('[hearth]', err);
    res.status(status).json({ error: status < 500 ? err.message : 'Something went wrong' });
  });

  return { app, config, storage, store, sync, problems, live, loginRequired };
}
