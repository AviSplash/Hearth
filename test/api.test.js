import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { Store } from '../server/store.js';
import { CalendarSync } from '../server/calendar.js';
import { createApi } from '../server/api.js';

let server;
let base;
let dir;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-api-'));
  const store = new Store(dir);
  const sync = new CalendarSync(store, dir);
  const app = express();
  app.use(express.json());
  app.use('/api', createApi({ store, sync, system: () => ({ urls: [] }) }));
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => {
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(p, { method = 'GET', body, pin } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (pin) headers['x-hearth-pin'] = pin;
  const res = await fetch(base + p, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

test('chores earn stars, rewards spend them, and the PIN guards parent actions', async () => {
  const kid = (await call('/members', { method: 'POST', body: { name: 'Sam' } })).body;
  const chore = (await call('/chores', { method: 'POST', body: { title: 'Feed cat', memberIds: [kid.id], points: 3 } })).body;
  assert.equal(chore.schedule.type, 'daily');

  const t1 = await call(`/chores/${chore.id}/toggle`, { method: 'POST', body: { memberId: kid.id, date: '2026-10-05' } });
  assert.deepEqual([t1.body.done, t1.body.points[kid.id]], [true, 3]);

  const reward = (await call('/rewards', { method: 'POST', body: { title: 'Ice cream', cost: 5 } })).body;
  const tooPoor = await call(`/rewards/${reward.id}/redeem`, { method: 'POST', body: { memberId: kid.id } });
  assert.equal(tooPoor.status, 400);

  await call(`/chores/${chore.id}/toggle`, { method: 'POST', body: { memberId: kid.id, date: '2026-10-06' } });
  const ok = await call(`/rewards/${reward.id}/redeem`, { method: 'POST', body: { memberId: kid.id } });
  assert.equal(ok.status, 201);
  assert.equal((await call('/state')).body.points[kid.id], 1);

  assert.equal((await call('/pin', { method: 'PUT', body: { pin: '4321' } })).status, 204);
  assert.equal((await call('/state')).body.settings.hasPin, true);
  assert.equal((await call('/chores', { method: 'POST', body: { title: 'X', memberIds: [kid.id] } })).body.code, 'pin_required');
  assert.equal((await call('/chores', { method: 'POST', body: { title: 'X', memberIds: [kid.id] }, pin: '0000' })).body.code, 'pin_wrong');
  assert.equal((await call('/chores', { method: 'POST', body: { title: 'X', memberIds: [kid.id] }, pin: '4321' })).status, 201);
  // Kids can still check off chores and edit lists without the PIN.
  assert.equal((await call(`/chores/${chore.id}/toggle`, { method: 'POST', body: { memberId: kid.id, date: '2026-10-07' } })).status, 200);
  const list = (await call('/state')).body.lists[0];
  assert.equal((await call(`/lists/${list.id}/items`, { method: 'POST', body: { text: 'Milk' } })).status, 201);
});

test('household events validate input and support deleting one repeat', async () => {
  const bad = await call('/events', { method: 'POST', body: { title: '', start: 'nope' } });
  assert.equal(bad.status, 400);
  const ev = (await call('/events', {
    method: 'POST',
    body: { title: 'Gym', start: '2026-10-05T17:00:00Z', end: '2026-10-05T18:00:00Z', rrule: 'FREQ=DAILY' },
  })).body;
  const range = '?start=2026-10-05T00:00:00Z&end=2026-10-08T00:00:00Z';
  assert.equal((await call(`/events${range}`)).body.length, 3);
  await call(`/events/${ev.id}?occurrence=2026-10-06`, { method: 'DELETE' });
  assert.equal((await call(`/events${range}`)).body.length, 2);
  const evil = await call('/events', { method: 'POST', body: { title: 'x', start: '2026-10-05T17:00:00Z', rrule: 'FREQ=SECONDLY' } });
  assert.equal(evil.status, 400);
});
