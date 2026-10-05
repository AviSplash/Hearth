import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { buildHearth } from '../server/hearth.js';
import { MemoryStorage } from './helpers/fakes.js';

// Cloud servers run on UTC; new households start there.
process.env.TZ = 'UTC';

const dirs = [];
const servers = [];

async function start(env, { platform = 'node' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-cloud-'));
  dirs.push(dir);
  const app = express();
  const hearth = buildHearth(app, { env, platform, dataDir: dir });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  servers.push(server);
  const base = `http://127.0.0.1:${server.address().port}/api`;
  let cookie = '';
  const call = async (p, { method = 'GET', body, headers = {}, jar = true } = {}) => {
    const res = await fetch(base + p, {
      method,
      headers: { 'content-type': 'application/json', ...(jar && cookie ? { cookie } : {}), ...headers },
      body: body ? JSON.stringify(body) : undefined,
    });
    const set = res.headers.get('set-cookie');
    if (set && jar) cookie = set.split(';')[0];
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null, setCookie: set };
  };
  return { hearth, call, cookie: () => cookie, setCookie: (c) => (cookie = c) };
}

after(() => {
  for (const s of servers) s.close();
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

let cloud;
before(async () => {
  cloud = await start({ HEARTH_MODE: 'cloud', HEARTH_PASSWORD: 'correct-horse' });
});

test('cloud mode: every API call needs the household password', async () => {
  const { call } = cloud;
  const hello = (await call('/hello')).body;
  assert.deepEqual([hello.mode, hello.loginRequired, hello.signedIn, hello.problems], ['cloud', true, false, []]);
  assert.equal((await call('/state')).body.code, 'login_required');
  assert.equal((await call('/poll')).status, 401);
  assert.equal((await call('/qr.svg?text=x')).status, 401);

  const wrong = await call('/login', { method: 'POST', body: { password: 'nope' } });
  assert.deepEqual([wrong.status, wrong.body.code], [401, 'login_failed']);

  const ok = await call('/login', { method: 'POST', body: { password: 'correct-horse', timezone: 'America/Denver' } });
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /^hearth_session=[\w-]+\.[\w-]+\.[\w-]+; Max-Age=34560000; Path=\/; HttpOnly; SameSite=Strict$/);
  assert.equal((await call('/hello')).body.signedIn, true);

  const state = (await call('/state')).body;
  assert.equal(state.settings.timezone, 'America/Denver', 'the first sign-in sets the time zone');

  // A second screen signing in from elsewhere doesn't move it again.
  await call('/login', { method: 'POST', body: { password: 'correct-horse', timezone: 'Asia/Tokyo' }, jar: false });
  assert.equal((await call('/state')).body.settings.timezone, 'America/Denver');
});

test('cloud mode: a forged or altered cookie is refused, and sign out ends the session', async () => {
  const { call, cookie, setCookie } = cloud;
  const good = cookie();
  const [name, value] = good.split('=');
  const [at, nonce, sig] = value.split('.');
  setCookie(`${name}=${(Number.parseInt(at, 36) + 1).toString(36)}.${nonce}.${sig}`);
  assert.equal((await call('/state')).status, 401);
  setCookie(`${name}=${at}.${nonce}.${'A'.repeat(sig.length)}`);
  assert.equal((await call('/state')).status, 401);
  setCookie(good);
  assert.equal((await call('/state')).status, 200);

  const out = await call('/logout', { method: 'POST' });
  assert.match(out.setCookie, /^hearth_session=; Max-Age=0/);
  assert.equal((await call('/state')).status, 401);
  await call('/login', { method: 'POST', body: { password: 'correct-horse' } });
});

test('cloud mode: the change counter moves when anything is saved', async () => {
  const { call } = cloud;
  const before = (await call('/poll')).body.rev;
  const list = (await call('/state')).body.lists[0];
  await call(`/lists/${list.id}/items`, { method: 'POST', body: { text: 'Milk' } });
  const after = (await call('/poll')).body.rev;
  assert.ok(after > before, `${after} > ${before}`);
});

test('cloud mode: calendar links into private networks are refused', async () => {
  const { call } = cloud;
  for (const url of ['http://169.254.169.254/latest/meta-data', 'http://127.0.0.1:3000/x.ics', 'https://[::1]/x.ics', 'http://10.0.0.5/cal.ics', 'https://nas.local/cal.ics']) {
    const res = await call('/calendars', { method: 'POST', body: { name: 'Sneaky', url } });
    assert.equal(res.status, 201);
    assert.match(res.body.lastError, /private network/, url);
  }
});

test('guessing the password gets locked out', async () => {
  const { call } = await start({ HEARTH_MODE: 'cloud', HEARTH_PASSWORD: 'correct-horse' });
  for (let i = 0; i < 5; i++) await call('/login', { method: 'POST', body: { password: `guess-${i}` } });
  const locked = await call('/login', { method: 'POST', body: { password: 'correct-horse' } });
  assert.equal(locked.status, 401);
  assert.match(locked.body.error, /Too many tries/);
});

test('cloud mode without a password (or a database) explains what to set up', async () => {
  const bare = await start({ HEARTH_MODE: 'cloud' });
  const hello = (await bare.call('/hello')).body;
  assert.deepEqual(hello.problems.map((p) => p.code), ['password']);
  assert.match(hello.problems[0].message, /HEARTH_PASSWORD/);
  const res = await bare.call('/state');
  assert.deepEqual([res.status, res.body.code], [503, 'setup_required']);
  assert.equal((await bare.call('/login', { method: 'POST', body: { password: 'x' } })).status, 503);

  const short = await start({ HEARTH_MODE: 'cloud', HEARTH_PASSWORD: 'short' });
  assert.match((await short.call('/hello')).body.problems[0].message, /too short/);

  // Serverless hosts have no lasting disk, so file storage isn't an option.
  const vercel = await start({ HEARTH_PASSWORD: 'correct-horse' }, { platform: 'vercel' });
  const v = (await vercel.call('/hello')).body;
  assert.deepEqual([v.mode, v.live, v.problems.map((p) => p.code)], ['cloud', 'poll', ['storage']]);
  assert.match(v.problems[0].message, /Upstash/);
});

test('home mode stays open, unless a password is set', async () => {
  const home = await start({});
  const hello = (await home.call('/hello')).body;
  assert.deepEqual([hello.mode, hello.loginRequired, hello.live], ['home', false, 'sse']);
  assert.equal((await home.call('/state')).status, 200);
  // Home mode can still subscribe to calendars on the local network.
  const cal = await home.call('/calendars', { method: 'POST', body: { name: 'NAS', url: 'http://127.0.0.1:1/cal.ics' } });
  assert.doesNotMatch(cal.body.lastError, /private network/);

  const elsewhere = await start({ DATABASE_URL: 'postgres://someone-elses-app' });
  assert.equal(elsewhere.hearth.storage.name, 'file', 'home mode ignores a stray DATABASE_URL');

  const locked = await start({ HEARTH_PASSWORD: 'correct-horse' });
  assert.equal((await locked.call('/hello')).body.loginRequired, true);
  assert.equal((await locked.call('/state')).status, 401);
});

test('screens poll instead of streaming when storage is shared', async () => {
  const app = express();
  const { live, storage } = buildHearth(app, { env: { HEARTH_MODE: 'cloud', HEARTH_PASSWORD: 'correct-horse', DATABASE_URL: 'postgres://unused' } });
  assert.deepEqual([storage.name, live], ['postgres', 'poll']);
  // MemoryStorage stands in for any shared database.
  assert.equal(new MemoryStorage().shared, true);
});
