import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FileStorage } from '../server/storage/file.js';
import { RedisStorage } from '../server/storage/redis.js';
import { PostgresStorage } from '../server/storage/postgres.js';
import { D1Storage } from '../server/storage/d1.js';
import { createStorage } from '../server/storage/index.js';
import { Store } from '../server/store.js';
import { MemoryStorage, startFakeUpstash, fakeD1 } from './helpers/fakes.js';

// Every storage must behave the same way.
async function contract(storage) {
  for (const key of ['hearth', 'calendars/x1', 'calendars/x2']) await storage.remove(key);
  assert.equal(await storage.read('hearth'), null);
  assert.equal(await storage.version('hearth'), 0);
  assert.equal(await storage.write('hearth', { a: 1 }, 0), 1);
  assert.equal(await storage.write('hearth', { a: 2 }, 0), null, 'created only once');
  assert.deepEqual(await storage.read('hearth'), { data: { a: 1 }, version: 1 });
  assert.equal(await storage.write('hearth', { a: 2, emoji: '🛒' }, 1), 2);
  assert.equal(await storage.write('hearth', { a: 3 }, 1), null, 'a stale version is refused');
  assert.deepEqual((await storage.read('hearth')).data, { a: 2, emoji: '🛒' });
  assert.equal(await storage.write('hearth', { a: 4 }), 3, 'writes without a version always land');
  assert.equal(await storage.version('hearth'), 3);

  await storage.write('calendars/x1', { events: [1] });
  await storage.write('calendars/x2', { events: [2] });
  assert.deepEqual(await storage.readMany(['calendars/x1', 'calendars/x2', 'calendars/none']), {
    'calendars/x1': { events: [1] },
    'calendars/x2': { events: [2] },
  });
  assert.deepEqual(await storage.readMany([]), {});
  await storage.remove('calendars/x1');
  assert.equal(await storage.read('calendars/x1'), null);
}

// Two servers changing the household at the same moment: nothing is lost.
async function concurrentServers(storageA, storageB) {
  await storageA.remove('hearth');
  const a = new Store(storageA);
  const b = new Store(storageB);
  await a.get();
  await Promise.all(Array.from({ length: 6 }, (_, i) => (i % 2 ? a : b).update((d) => {
    d.lists[0].items.push({ id: `i${i}`, text: `Item ${i}`, done: false });
  })));
  const items = (await b.get()).lists[0].items.map((x) => x.id).sort();
  assert.deepEqual(items, ['i0', 'i1', 'i2', 'i3', 'i4', 'i5']);
}

test('file storage', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-file-'));
  try {
    await contract(new FileStorage(dir));
    assert.ok(fs.existsSync(path.join(dir, 'hearth.json')));
    assert.ok(fs.existsSync(path.join(dir, 'calendars', 'x2.json')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('file storage: keeps a backup, survives a broken file, and moves the 1.0 calendar cache', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-file-'));
  try {
    fs.writeFileSync(path.join(dir, 'hearth.json'), JSON.stringify({ settings: { householdName: 'Kims' } }));
    fs.writeFileSync(path.join(dir, 'calendar-cache.json'), JSON.stringify({ abc: { syncedAt: 'x', events: [{ id: 'e' }] } }));
    const storage = new FileStorage(dir);
    assert.equal(fs.existsSync(path.join(dir, 'calendar-cache.json')), false);
    assert.deepEqual(await storage.readMany(['calendars/abc']), { 'calendars/abc': { syncedAt: 'x', events: [{ id: 'e' }] } });
    assert.equal((await new Store(storage).get()).settings.householdName, 'Kims');
    assert.ok(fs.existsSync(path.join(dir, 'hearth.json.bak')));

    fs.writeFileSync(path.join(dir, 'hearth.json'), '{ not json');
    const again = await new FileStorage(dir).read('hearth');
    assert.equal(again.data.settings.householdName, 'Kims', 'falls back to the backup');
    assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('hearth.json.broken-')));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Redis storage (Upstash REST API)', async () => {
  const upstash = await startFakeUpstash();
  try {
    const make = () => new RedisStorage({ url: upstash.url, token: upstash.token });
    await contract(make());
    await concurrentServers(make(), make());
    await assert.rejects(new RedisStorage({ url: upstash.url, token: 'wrong' }).read('hearth'), /Unauthorized/);
  } finally {
    upstash.close();
  }
});

test('D1 storage (on SQLite)', async (t) => {
  const db = await fakeD1();
  if (!db) return t.skip('needs node:sqlite (Node 22.5+)');
  await contract(new D1Storage(db));
  await concurrentServers(new D1Storage(db), new D1Storage(db));
});

test('PostgreSQL storage', { skip: !process.env.TEST_DATABASE_URL && 'set TEST_DATABASE_URL to run' }, async () => {
  const a = new PostgresStorage(process.env.TEST_DATABASE_URL);
  const b = new PostgresStorage(process.env.TEST_DATABASE_URL);
  try {
    await contract(a);
    await concurrentServers(a, b);
  } finally {
    await a.close();
    await b.close();
  }
});

test('updates that collide are retried, not lost', async () => {
  const shared = new MemoryStorage();
  await concurrentServers(shared, shared);
  assert.ok(shared.conflicts > 0, 'the test really made updates collide');
});

test('a failed update changes nothing', async () => {
  const store = new Store(new MemoryStorage());
  const before = await store.get();
  await assert.rejects(store.update((d) => {
    d.members.push({ id: 'x' });
    throw new Error('nope');
  }), /nope/);
  assert.deepEqual(await store.get(), before);
});

test('storage is picked from the environment', () => {
  const dataDir = os.tmpdir();
  assert.equal(createStorage({}, { dataDir }).name, 'file');
  // At home, a DATABASE_URL meant for something else is left alone.
  assert.equal(createStorage({ DATABASE_URL: 'postgres://x' }, { dataDir, detect: false }).name, 'file');
  assert.equal(createStorage({ DATABASE_URL: 'postgres://x', HEARTH_STORAGE: 'postgres' }, { dataDir, detect: false }).name, 'postgres');
  assert.equal(createStorage({ KV_REST_API_URL: 'https://x.upstash.io', KV_REST_API_TOKEN: 't' }, { dataDir }).name, 'redis');
  assert.equal(createStorage({ UPSTASH_REDIS_REST_URL: 'https://x.upstash.io', UPSTASH_REDIS_REST_TOKEN: 't' }, { dataDir }).name, 'redis');
  assert.equal(createStorage({ DATABASE_URL: 'postgres://x' }, { dataDir }).name, 'postgres');
  assert.equal(createStorage({ DATABASE_URL: 'postgres://x' }, { d1: {} }).name, 'd1');
  assert.equal(createStorage({ HEARTH_STORAGE: 'file', DATABASE_URL: 'postgres://x' }, { dataDir }).name, 'file');
  assert.throws(() => createStorage({}, { serverless: true }), /needs a database/);
  assert.throws(() => createStorage({ HEARTH_STORAGE: 'redis' }, { dataDir }), /UPSTASH_REDIS_REST_URL/);
  assert.throws(() => createStorage({ HEARTH_STORAGE: 'mongo' }, { dataDir }), /Unknown HEARTH_STORAGE/);
});
