import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadConfig } from '../server/config.js';
import { VERSION } from '../server/version.js';
import { assertPublicUrl, fetchPublic } from '../server/safe-fetch.js';

test('home or cloud mode', () => {
  assert.equal(loadConfig({}).mode, 'home');
  for (const env of [{ VERCEL: '1' }, { RENDER: 'true' }, { FLY_APP_NAME: 'h' }, { RAILWAY_ENVIRONMENT: 'production' }, { K_SERVICE: 'h' }]) {
    assert.equal(loadConfig(env).mode, 'cloud', JSON.stringify(env));
  }
  assert.equal(loadConfig({ RENDER: 'true', HEARTH_MODE: 'home' }).mode, 'home');
  assert.equal(loadConfig({ HEARTH_MODE: 'cloud' }).mode, 'cloud');
  const cf = loadConfig({}, 'cloudflare');
  assert.deepEqual([cf.mode, cf.serverless], ['cloud', true]);
  // The hosting service provides https in the cloud.
  assert.equal(loadConfig({}).httpsEnabled, true);
  assert.equal(loadConfig({ HEARTH_MODE: 'cloud' }).httpsEnabled, false);
  assert.equal(loadConfig({ HTTPS: 'off' }).httpsEnabled, false);
  assert.equal(loadConfig({ HEARTH_POLL_SECONDS: '1' }).pollSeconds, 5);
});

test('version and vendored Preact match package.json and node_modules', () => {
  const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(VERSION, pkg.version);
  const vendored = fs.readFileSync(new URL('../public/vendor/preact-htm.js', import.meta.url));
  const installed = fs.readFileSync(new URL('../node_modules/htm/preact/standalone.module.js', import.meta.url));
  assert.ok(vendored.equals(installed), 'run `npm run vendor` after updating htm');
});

test('private addresses are refused in the cloud', async () => {
  const refused = [
    'http://127.0.0.1/x.ics', 'http://10.1.2.3/x.ics', 'http://172.16.5.4/x.ics', 'http://192.168.1.10/x.ics',
    'http://169.254.169.254/latest', 'http://100.64.0.1/x', 'http://0.0.0.0/x', 'http://[::1]/x', 'http://[fd00::1]/x',
    'http://[fe80::1]/x', 'http://[::ffff:127.0.0.1]/x', 'http://[::ffff:a9fe:a9fe]/x', 'http://[::127.0.0.1]/x',
    'http://localhost:3000/x', 'http://printer.local/x',
    'http://metadata.google.internal/x', 'http://intranet/x', 'http://router.lan/x',
  ];
  for (const url of refused) await assert.rejects(assertPublicUrl(url), /private network/, url);
  for (const url of ['https://8.8.8.8/x.ics', 'http://93.184.215.14/x', 'https://[2606:4700:4700::1111]/x', 'http://[::ffff:808:808]/x']) {
    await assertPublicUrl(url);
  }
  await assert.rejects(assertPublicUrl('ftp://8.8.8.8/x'), /https/);
});

test('a redirect into a private network is refused before it is followed', async () => {
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url, init) => {
    asked.push([url, init.redirect]);
    if (url === 'http://93.184.215.14/cal.ics') return new Response(null, { status: 302, headers: { location: 'http://8.8.8.8/moved.ics' } });
    if (url === 'http://8.8.8.8/moved.ics') return new Response(null, { status: 301, headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    return new Response('BEGIN:VCALENDAR');
  };
  try {
    await assert.rejects(fetchPublic('http://93.184.215.14/cal.ics', {}, { guard: true }), /private network/);
    assert.deepEqual(asked, [['http://93.184.215.14/cal.ics', 'manual'], ['http://8.8.8.8/moved.ics', 'manual']]);

    asked.length = 0;
    const res = await fetchPublic('http://192.168.1.5/cal.ics', {}, { guard: false });
    assert.equal(await res.text(), 'BEGIN:VCALENDAR');
    assert.deepEqual(asked, [['http://192.168.1.5/cal.ics', 'follow']]);
  } finally {
    globalThis.fetch = real;
  }
});
