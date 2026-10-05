import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { ensureCertificates } from '../server/certs.js';

test('creates a CA and a server certificate it signed, covering every host', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hearth-certs-'));
  const hosts = ['localhost', 'kitchen.local', '127.0.0.1', '192.168.1.50'];
  const first = ensureCertificates(dir, hosts);
  const ca = new crypto.X509Certificate(first.caCert);
  const leaf = new crypto.X509Certificate(first.cert.split('-----END CERTIFICATE-----')[0] + '-----END CERTIFICATE-----\n');
  assert.equal(ca.ca, true);
  assert.equal(leaf.verify(ca.publicKey), true);
  assert.equal(leaf.checkIssued(ca), true);
  assert.equal(leaf.checkHost('kitchen.local'), 'kitchen.local');
  assert.equal(leaf.checkIP('192.168.1.50'), '192.168.1.50');
  assert.ok(Date.parse(leaf.validTo) - Date.now() < 398 * 86400_000);

  // Same hosts: reuse. New IP: new server cert, same CA.
  assert.equal(ensureCertificates(dir, hosts).key, first.key);
  const moved = ensureCertificates(dir, [...hosts.slice(0, 3), '192.168.1.77']);
  assert.notEqual(moved.key, first.key);
  assert.equal(moved.caCert, first.caCert);
  fs.rmSync(dir, { recursive: true, force: true });
});
