import './preflight.js';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import QRCode from 'qrcode';
import { buildHearth } from './hearth.js';
import { ensureCertificates } from './certs.js';
import { lanAddresses, hostnames, mdnsName } from './network.js';

// Hearth as a long-running Node.js server: on a computer at home, in Docker,
// or on a cloud host that runs containers (Render, Fly.io, Railway...).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(root, 'data'));
const publicDir = path.join(root, 'public');

let tls = null;

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
    hostname: hostnames()[1] || 'localhost',
    urls,
    https: tls ? { port: config.httpsPort, caPath: '/hearth-ca.crt' } : null,
  };
}

const app = express();
const hearth = buildHearth(app, {
  env: process.env,
  platform: 'node',
  dataDir,
  // In the cloud the screen already knows the address: it's the one it's on.
  system: () => (config.mode === 'home' ? connectionInfo() : {}),
  mount(app) {
    // The local certificate authority, for installing on tablets and phones.
    app.get(['/hearth-ca.crt', '/hearth-ca.pem'], (req, res) => {
      if (!tls) return res.status(404).send('HTTPS is turned off on this server.');
      res.set('Content-Type', req.path.endsWith('.pem') ? 'application/x-pem-file' : 'application/x-x509-ca-cert');
      res.set('Content-Disposition', `attachment; filename="${path.basename(req.path)}"`);
      res.send(tls.caCert);
    });

    app.use(
      express.static(publicDir, {
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
  },
});
const { config } = hearth;

if (config.httpsEnabled) {
  try {
    tls = ensureCertificates(dataDir, [...hostnames(), '127.0.0.1', ...lanAddresses(), ...config.publicHosts]);
  } catch (err) {
    console.warn(`[https] Could not create certificates, continuing with HTTP only: ${err.message}`);
  }
}

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

  hearth.sync?.start();

  if (config.mode === 'cloud') printCloudStatus();
  else await printHomeStatus();

  const shutdown = async () => {
    console.log('\n  Stopping Hearth...');
    httpServer.close();
    httpsServer?.close();
    await hearth.storage?.close?.().catch(() => {});
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
}

function printProblems() {
  if (!hearth.problems.length) return;
  console.log('  Hearth isn’t ready yet:');
  for (const p of hearth.problems) console.log(`    • ${p.message}`);
  console.log('');
}

function printCloudStatus() {
  const { storage, live } = hearth;
  console.log([
    '',
    `  Hearth ${config.version} is running in cloud mode on port ${config.port}`,
    `  Storage:   ${storage ? storage.label : 'not set up'}${storage?.name === 'file' ? ` (${dataDir})` : ''}`,
    `  Screens:   sign in with HEARTH_PASSWORD; ${live === 'sse' ? 'changes show up live' : `they check for changes every ${config.pollSeconds} s`}`,
    '',
  ].join('\n'));
  printProblems();
}

async function printHomeStatus() {
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
  if (hearth.storage?.name === 'file') lines.push(`  Data folder:        ${dataDir}`);
  else if (hearth.storage) lines.push(`  Storage:            ${hearth.storage.label}`);
  if (hearth.loginRequired) lines.push('  Sign-in:            each screen signs in with HEARTH_PASSWORD');
  lines.push('');
  console.log(lines.join('\n'));
  printProblems();
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
}

main().catch((err) => {
  if (err.code !== 'EADDRINUSE') console.error(err);
  process.exit(1);
});
