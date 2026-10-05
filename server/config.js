import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));

export const config = {
  root,
  version: pkg.version,
  host: process.env.HOST || '0.0.0.0',
  port: int(process.env.PORT, 3000),
  httpsPort: int(process.env.HTTPS_PORT, 3443),
  httpsEnabled: !/^(0|false|no|off)$/i.test(process.env.HTTPS || ''),
  dataDir: path.resolve(process.env.DATA_DIR || path.join(root, 'data')),
  publicDir: path.join(root, 'public'),
  // Extra hostnames/IPs to put in the HTTPS certificate and show on the
  // connect screen (useful behind Docker NAT or with a DNS name).
  publicHosts: list(process.env.PUBLIC_HOSTS),
};
