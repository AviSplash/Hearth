import { VERSION } from './version.js';

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value) {
  return (value || '').split(',').map((s) => s.trim()).filter(Boolean);
}

// Hosting services that put Hearth on the internet. Any of their environment
// variables switches Hearth to cloud mode (HEARTH_MODE overrides this).
const CLOUD_HOSTS = ['VERCEL', 'RENDER', 'RAILWAY_ENVIRONMENT', 'RAILWAY_PROJECT_ID', 'FLY_APP_NAME', 'K_SERVICE', 'DYNO', 'AWS_LAMBDA_FUNCTION_NAME', 'WEBSITE_SITE_NAME'];

/**
 * Settings from environment variables. `platform` is node (a long-running
 * server: your computer, Docker, Render, Fly...), vercel or cloudflare.
 *
 * Home mode is the original Hearth: open on your own network, with its own
 * certificate for https. Cloud mode is for a server on the internet: every
 * screen signs in with HEARTH_PASSWORD, the host provides https, and calendar
 * links can't point into private networks.
 */
export function loadConfig(env = {}, platform = 'node') {
  const forced = (env.HEARTH_MODE || '').trim().toLowerCase();
  const mode = forced === 'cloud' || forced === 'home' ? forced
    : platform !== 'node' || CLOUD_HOSTS.some((k) => env[k]) ? 'cloud' : 'home';
  return {
    version: VERSION,
    platform,
    mode,
    // Serverless hosts only run Hearth while answering a request, so there are
    // no timers and no connections held open between requests.
    serverless: platform !== 'node',
    password: env.HEARTH_PASSWORD || '',
    // Optional extra key for signing sessions, so a leaked cookie can't be
    // used to guess the password offline.
    secret: env.HEARTH_SECRET || '',
    // How often screens check for changes when live push isn't possible.
    pollSeconds: Math.min(300, Math.max(5, int(env.HEARTH_POLL_SECONDS, 15))),
    host: env.HOST || '0.0.0.0',
    port: int(env.PORT, 3000),
    httpsPort: int(env.HTTPS_PORT, 3443),
    // In the cloud the hosting service provides https.
    httpsEnabled: env.HTTPS ? !/^(0|false|no|off)$/i.test(env.HTTPS) : mode === 'home',
    // Extra hostnames/IPs to put in the HTTPS certificate and show on the
    // connect screen (useful behind Docker NAT or with a DNS name).
    publicHosts: list(env.PUBLIC_HOSTS),
  };
}
