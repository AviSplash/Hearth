import './preflight.js';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { createRequire } from 'node:module';
import express from 'express';
import QRCode from 'qrcode';
import { config } from './config.js';
import { Store } from './store.js';
import { CalendarSync } from './calendar.js';
import { createApi } from './api.js';
import { sseHandler } from './bus.js';
import { ensureCertificates } from './certs.js';
import { lanAddresses, hostnames, mdnsName } from './network.js';

const require = createRequire(import.meta.url);
const store = new Store(config.dataDir);
const sync = new CalendarSync(store, config.dataDir);

let tls = null;
if (config.httpsEnabled) {
  try {
    tls = ensureCertificates(config.dataDir, [...hostnames(), '127.0.0.1', ...lanAddresses(), ...config.publicHosts]);
  } catch (err) {
    console.warn(`[https] Could not create certificates, continuing with HTTP only: ${err.message}`);
  }
}

function connectionInfo() {
  const hosts = [...new Set([...config.publicHosts, ...lanAddresses()])];
  const entry = (host, label) => ({
    host,
    label,
    http: `http://${host}:${config.port}`,
    https: tls ? `https://${host}:${config.httpsPort}` : null,
  });
  const urls = hosts.map((h) => entry(h, 'Network address'));
  const mdns = mdnsName();
  if (mdns && !hosts.includes(mdns)) urls.push(entry(mdns, 'By name (keeps working if the IP changes)'));
  return {
    version: config.version,
    hostname: hostnames()[1] || 'localhost',
    urls,
    https: tls ? { port: config.httpsPort, caPath: '/hearth-ca.crt' } : null,
  };
}

const app = express();
app.disable('x-powered-by');
app.set('etag', 'strong');
app.use(express.json({ limit: '256kb' }));

app.get('/api/stream', sseHandler);
app.use('/api', createApi({ store, sync, system: connectionInfo }));

// The local certificate authority, for installing on tablets and phones.
app.get(['/hearth-ca.crt', '/hearth-ca.pem'], (req, res) => {
  if (!tls) return res.status(404).send('HTTPS is turned off on this server.');
  res.set('Content-Type', req.path.endsWith('.pem') ? 'application/x-pem-file' : 'application/x-x509-ca-cert');
  res.set('Content-Disposition', `attachment; filename="${path.basename(req.path)}"`);
  res.send(tls.caCert);
});

// Preact + htm in a single ES module, served straight from node_modules so
// there is no build step.
const vendorFile = path.join(path.dirname(require.resolve('htm')), '..', 'preact', 'standalone.module.js');
app.get('/vendor/preact-htm.js', (req, res) => {
  res.set('Cache-Control', 'no-cache');
  res.type('application/javascript').sendFile(vendorFile);
});

app.use(
  express.static(config.publicDir, {
    index: 'index.html',
    setHeaders(res, file) {
      // Always revalidate so tablets pick up updates; the service worker
      // keeps a copy for when the server is unreachable.
      res.set('Cache-Control', 'no-cache');
      if (file.endsWith('.webmanifest')) res.type('application/manifest+json');
      if (file.endsWith(`${path.sep}sw.js`)) res.set('Service-Worker-Allowed', '/');
    },
  }),
);

app.use((req, res) => res.status(404).send('Not found'));

// ---- start ----------------------------------------------------------------

function listen(server, port, label) {
  return new Promise((resolve, reject) => {
    server.once('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        const envName = label === 'HTTPS' ? 'HTTPS_PORT' : 'PORT';
        const help = {
          win32: [
            `Find it with   netstat -ano | findstr :${port}   then   taskkill /PID <pid> /F`,
            `Or use another port:   $env:${envName}=${port + 1}   (cmd: set ${envName}=${port + 1})`,
          ],
          darwin: [
            'If Hearth is installed as a service it is already running: launchctl print gui/$(id -u)/com.hearth.server',
            `Otherwise find it with   lsof -nP -iTCP:${port} -sTCP:LISTEN   then   kill <pid>`,
            `Or use another port:   ${envName}=${port + 1} npm start`,
          ],
          linux: [
            'If Hearth is installed as a service it is already running: systemctl status hearth',
            `Otherwise find it with   sudo ss -ltnp 'sport = :${port}'   then   kill <pid>`,
            `Or use another port:   ${envName}=${port + 1} npm start`,
          ],
        };
        console.error(`\n  Port ${port} (${label}) is already in use. Is Hearth already running?`);
        for (const line of help[process.platform] || help.linux) console.error(`  ${line}`);
        console.error('');
      }
      reject(err);
    });
    server.listen(port, config.host, resolve);
  });
}

async function main() {
  const httpServer = http.createServer(app);
  await listen(httpServer, config.port, 'HTTP');
  let httpsServer = null;
  if (tls) {
    httpsServer = https.createServer({ key: tls.key, cert: tls.cert }, app);
    try {
      await listen(httpsServer, config.httpsPort, 'HTTPS');
    } catch {
      httpsServer = null;
      tls = null;
    }
  }

  sync.start();

  const info = connectionInfo();
  const best = info.urls[0];
  const lines = [
    '',
    `  Hearth ${config.version} is running`,
    '',
    `  On this computer:   http://localhost:${config.port}`,
  ];
  for (const u of info.urls) {
    lines.push(`  On your network:    ${u.http}${u.https ? `   (secure: ${u.https})` : ''}`);
  }
  if (!info.urls.length) lines.push('  No network connection found. Only this computer can open Hearth.');
  lines.push(`  Data folder:        ${config.dataDir}`, '');
  console.log(lines.join('\n'));
  // The QR code only helps someone looking at a terminal, not a service log.
  if (best && process.stdout.isTTY) {
    const qr = await QRCode.toString(best.http, { type: 'terminal', small: true });
    console.log(`  Scan to open on a tablet or phone:\n${qr}`);
  }
  const firewallHint = {
    win32: 'Run scripts\\windows\\open-firewall.ps1 as Administrator.',
    linux: `If ufw is on: sudo ufw allow ${config.port},${config.httpsPort}/tcp   (./install.sh does this for you)`,
    darwin: 'Check System Settings > Network > Firewall, or run ./install.sh to allow Hearth through it.',
  };
  if (process.stdout.isTTY) {
    console.log(`  Other devices can't connect? ${firewallHint[process.platform] || firewallHint.linux}\n`);
    console.log('  Press Ctrl+C to stop.\n');
  }

  const shutdown = () => {
    console.log('\n  Stopping Hearth...');
    httpServer.close();
    httpsServer?.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

main().catch((err) => {
  if (err.code !== 'EADDRINUSE') console.error(err);
  process.exit(1);
});
