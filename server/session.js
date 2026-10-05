import crypto from 'node:crypto';

// Signing in with the household password (HEARTH_PASSWORD). Needed whenever
// Hearth can be reached from the internet. Each screen signs in once and gets
// a signed cookie that lasts as long as browsers allow (400 days) and renews
// itself while the screen is in use, so a wall tablet never has to sign in
// again. Changing the password signs every screen out.

const COOKIE = 'hearth_session';
const MAX_AGE_S = 400 * 86400;
const RENEW_MS = 7 * 86400_000;

const sha256 = (value) => crypto.createHash('sha256').update(value).digest();

function readCookie(req, name) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export function createSessions({ password, secret = '', mode }) {
  const key = sha256(`hearth-session\0${secret}\0${password || ''}`);
  const sign = (payload) => crypto.createHmac('sha256', key).update(payload).digest('base64url');

  // Slow down guessing: 5 wrong passwords from one address locks it out for a
  // minute, and 30 from anywhere within a minute locks everyone out for one.
  // (Per server; serverless hosts may run several.)
  const byClient = new Map();
  const everyone = { failures: 0, since: 0, lockedUntil: 0 };

  function clientId(req) {
    return req.get('cf-connecting-ip') || req.ip || 'unknown';
  }

  function cookieFlags(req) {
    // Cloud hosts are always https, but a local test of cloud mode isn't.
    const local = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.get('host') || '');
    const secure = req.secure || (mode === 'cloud' && !local);
    return `Path=/; HttpOnly; SameSite=Strict${secure ? '; Secure' : ''}`;
  }

  function issue(res, req) {
    const payload = `${Date.now().toString(36)}.${crypto.randomBytes(12).toString('base64url')}`;
    res.append('Set-Cookie', `${COOKIE}=${payload}.${sign(payload)}; Max-Age=${MAX_AGE_S}; ${cookieFlags(req)}`);
  }

  /** When the session was issued (ms), or null if there isn't a valid one. */
  function issuedAt(req) {
    const token = readCookie(req, COOKIE);
    const parts = token?.split('.');
    if (parts?.length !== 3) return null;
    const expected = Buffer.from(sign(`${parts[0]}.${parts[1]}`));
    const given = Buffer.from(parts[2]);
    if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return null;
    const at = Number.parseInt(parts[0], 36);
    return Number.isFinite(at) && Date.now() - at < MAX_AGE_S * 1000 ? at : null;
  }

  return {
    signedIn: (req) => issuedAt(req) !== null,

    /** Middleware: let the request through only with a valid session. */
    require(req, res, next) {
      const at = issuedAt(req);
      if (at === null) return res.status(401).json({ error: 'Sign in to Hearth', code: 'login_required' });
      if (Date.now() - at > RENEW_MS) issue(res, req);
      next();
    },

    /** Check a password; on success the response carries the new session. */
    login(req, res, given) {
      const now = Date.now();
      const id = clientId(req);
      const client = byClient.get(id) || { failures: 0, lockedUntil: 0 };
      if (now < client.lockedUntil || now < everyone.lockedUntil) {
        return { ok: false, error: 'Too many tries. Wait a minute and try again.' };
      }
      const ok = typeof given === 'string' && given.length > 0 && password
        && crypto.timingSafeEqual(sha256(given), sha256(password));
      if (ok) {
        byClient.delete(id);
        issue(res, req);
        return { ok: true };
      }
      client.failures += 1;
      if (client.failures >= 5) Object.assign(client, { failures: 0, lockedUntil: now + 60_000 });
      if (byClient.size > 1000) byClient.clear();
      byClient.set(id, client);
      if (now - everyone.since > 60_000) Object.assign(everyone, { failures: 0, since: now });
      if (++everyone.failures >= 30) everyone.lockedUntil = now + 60_000;
      return { ok: false, error: 'That password didn’t work' };
    },

    logout(req, res) {
      res.append('Set-Cookie', `${COOKIE}=; Max-Age=0; ${cookieFlags(req)}`);
    },
  };
}
