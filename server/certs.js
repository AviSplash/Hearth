import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';

// Browsers only let a site be installed as an app (and keep the screen awake)
// over HTTPS. A home server has no public domain, so Hearth creates its own
// tiny certificate authority on first run. Install `hearth-ca.crt` on each
// tablet once and the HTTPS address is trusted from then on, even if the
// server's IP changes (only the server certificate is re-issued).
//
// The certificates are built with a minimal DER encoder and signed with
// Node's built-in crypto, so no native modules or OpenSSL install is needed.

// ---- DER encoding ---------------------------------------------------------

function derLength(n) {
  if (n < 0x80) return Buffer.from([n]);
  const bytes = [];
  while (n > 0) {
    bytes.unshift(n & 0xff);
    n >>= 8;
  }
  return Buffer.from([0x80 | bytes.length, ...bytes]);
}
const tlv = (tag, content) => Buffer.concat([Buffer.from([tag]), derLength(content.length), content]);
const seq = (...items) => tlv(0x30, Buffer.concat(items));
const set = (...items) => tlv(0x31, Buffer.concat(items));
const bool = (v) => tlv(0x01, Buffer.from([v ? 0xff : 0x00]));
const octets = (buf) => tlv(0x04, buf);
const bits = (buf, unused = 0) => tlv(0x03, Buffer.concat([Buffer.from([unused]), buf]));
const utf8 = (s) => tlv(0x0c, Buffer.from(s, 'utf8'));
const NULL = Buffer.from([0x05, 0x00]);
const explicit = (n, content) => tlv(0xa0 | n, content);

function integer(buf) {
  let b = buf;
  while (b.length > 1 && b[0] === 0 && !(b[1] & 0x80)) b = b.subarray(1);
  if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]);
  return tlv(0x02, b);
}

function oid(dotted) {
  const parts = dotted.split('.').map(Number);
  const out = [40 * parts[0] + parts[1]];
  for (const p of parts.slice(2)) {
    const chunk = [p & 0x7f];
    let v = Math.floor(p / 128);
    while (v > 0) {
      chunk.unshift((v & 0x7f) | 0x80);
      v = Math.floor(v / 128);
    }
    out.push(...chunk);
  }
  return tlv(0x06, Buffer.from(out));
}

function time(date) {
  const p = (n) => String(n).padStart(2, '0');
  const y = date.getUTCFullYear();
  const rest = `${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
  return y < 2050 ? tlv(0x17, Buffer.from(String(y).slice(2) + rest)) : tlv(0x18, Buffer.from(String(y) + rest));
}

const name = (commonName) =>
  seq(set(seq(oid('2.5.4.10'), utf8('Hearth Family Calendar'))), set(seq(oid('2.5.4.3'), utf8(commonName))));

const extension = (id, critical, value) => seq(oid(id), ...(critical ? [bool(true)] : []), octets(value));
const SHA256_WITH_RSA = seq(oid('1.2.840.113549.1.1.11'), NULL);

function keyId(publicKey) {
  return crypto.createHash('sha1').update(publicKey.export({ type: 'spki', format: 'der' })).digest();
}

function subjectAltNames(hosts) {
  const entries = hosts.map((h) => {
    if (net.isIPv4(h)) return tlv(0x87, Buffer.from(h.split('.').map(Number)));
    return tlv(0x82, Buffer.from(h, 'ascii'));
  });
  return seq(...entries);
}

function buildCertificate({ subject, issuer, publicKey, signingKey, notBefore, notAfter, extensions }) {
  const serial = crypto.randomBytes(16);
  serial[0] &= 0x7f;
  const tbs = seq(
    explicit(0, integer(Buffer.from([2]))),
    integer(serial),
    SHA256_WITH_RSA,
    issuer,
    seq(time(notBefore), time(notAfter)),
    subject,
    publicKey.export({ type: 'spki', format: 'der' }),
    explicit(3, seq(...extensions)),
  );
  const signature = crypto.sign('sha256', tbs, signingKey);
  const der = seq(tbs, SHA256_WITH_RSA, bits(signature));
  const b64 = der.toString('base64').match(/.{1,64}/g).join('\n');
  return `-----BEGIN CERTIFICATE-----\n${b64}\n-----END CERTIFICATE-----\n`;
}

// ---- Certificate authority + server certificate ---------------------------

const DAY = 86400_000;

function createCa() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.now();
  const subject = name(`Hearth Local CA (${new Date(now).toISOString().slice(0, 10)})`);
  const cert = buildCertificate({
    subject,
    issuer: subject,
    publicKey,
    signingKey: privateKey,
    notBefore: new Date(now - DAY),
    notAfter: new Date(now + 3650 * DAY),
    extensions: [
      extension('2.5.29.19', true, seq(bool(true), integer(Buffer.from([0])))),
      // keyCertSign + cRLSign + digitalSignature
      extension('2.5.29.15', true, bits(Buffer.from([0x86]), 1)),
      extension('2.5.29.14', false, octets(keyId(publicKey))),
    ],
  });
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function createServerCert(ca, hosts) {
  const caKey = crypto.createPrivateKey(ca.key);
  const caCert = new crypto.X509Certificate(ca.cert);
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const now = Date.now();
  const cert = buildCertificate({
    subject: name(hosts.find((h) => !net.isIP(h) && h !== 'localhost') || 'hearth'),
    issuer: extractSubject(caCert.raw),
    publicKey,
    signingKey: caKey,
    notBefore: new Date(now - DAY),
    // Apple devices reject server certificates valid for more than 825 days.
    notAfter: new Date(now + 397 * DAY),
    extensions: [
      extension('2.5.29.19', false, seq()),
      // digitalSignature + keyEncipherment
      extension('2.5.29.15', true, bits(Buffer.from([0xa0]), 5)),
      extension('2.5.29.37', false, seq(oid('1.3.6.1.5.5.7.3.1'))),
      extension('2.5.29.17', false, subjectAltNames(hosts)),
      extension('2.5.29.14', false, octets(keyId(publicKey))),
      extension('2.5.29.35', false, seq(tlv(0x80, keyId(caCert.publicKey)))),
    ],
  });
  return { cert, key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

function readTlv(buf, offset) {
  const tag = buf[offset];
  let len = buf[offset + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[offset + 2 + i];
    header += n;
  }
  return { tag, start: offset, contentStart: offset + header, end: offset + header + len };
}

/** The issuer Name must be byte-identical to the CA's subject Name. */
function extractSubject(der) {
  const certSeq = readTlv(der, 0);
  const tbs = readTlv(der, certSeq.contentStart);
  let cursor = tbs.contentStart;
  const fields = [];
  while (cursor < tbs.end) {
    const f = readTlv(der, cursor);
    fields.push(f);
    cursor = f.end;
  }
  // [0] version, serial, signature alg, issuer, validity, subject, ...
  const subject = fields[0].tag === 0xa0 ? fields[5] : fields[4];
  return der.subarray(subject.start, subject.end);
}

/**
 * Make sure a CA and a server certificate covering `hosts` exist in
 * `<dataDir>/certs`. Returns the PEM strings needed by https.createServer.
 */
export function ensureCertificates(dataDir, hosts) {
  const dir = path.join(dataDir, 'certs');
  fs.mkdirSync(dir, { recursive: true });
  const file = (n) => path.join(dir, n);

  let ca;
  if (fs.existsSync(file('ca.crt')) && fs.existsSync(file('ca.key'))) {
    ca = { cert: fs.readFileSync(file('ca.crt'), 'utf8'), key: fs.readFileSync(file('ca.key'), 'utf8') };
  } else {
    ca = createCa();
    fs.writeFileSync(file('ca.crt'), ca.cert);
    fs.writeFileSync(file('ca.key'), ca.key, { mode: 0o600 });
  }

  const wanted = [...new Set(hosts)].sort();
  let meta = null;
  try {
    meta = JSON.parse(fs.readFileSync(file('server.json'), 'utf8'));
  } catch {
    meta = null;
  }
  const fresh =
    meta &&
    fs.existsSync(file('server.crt')) &&
    fs.existsSync(file('server.key')) &&
    JSON.stringify(meta.hosts) === JSON.stringify(wanted) &&
    Date.parse(meta.notAfter) - Date.now() > 30 * DAY &&
    new crypto.X509Certificate(fs.readFileSync(file('server.crt'))).verify(new crypto.X509Certificate(ca.cert).publicKey);

  let server;
  if (fresh) {
    server = { cert: fs.readFileSync(file('server.crt'), 'utf8'), key: fs.readFileSync(file('server.key'), 'utf8') };
  } else {
    server = createServerCert(ca, wanted);
    fs.writeFileSync(file('server.crt'), server.cert);
    fs.writeFileSync(file('server.key'), server.key, { mode: 0o600 });
    const x509 = new crypto.X509Certificate(server.cert);
    fs.writeFileSync(file('server.json'), JSON.stringify({ hosts: wanted, notAfter: new Date(x509.validTo).toISOString() }, null, 2));
  }

  return { key: server.key, cert: server.cert + ca.cert, caCert: ca.cert, caFile: file('ca.crt') };
}
