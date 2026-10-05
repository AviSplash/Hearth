import crypto from 'node:crypto';

// An optional parent PIN. When set, changing settings, family members,
// calendars, chores and rewards (and spending stars) needs the PIN, while
// checking off chores, editing lists and adding events stays open to everyone.

export function hashPin(pin) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pin, salt, 32);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export function checkPin(pin, stored) {
  if (!stored || typeof pin !== 'string') return false;
  const [saltHex, hashHex] = stored.split(':');
  const expected = Buffer.from(hashHex, 'hex');
  const actual = crypto.scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return crypto.timingSafeEqual(expected, actual);
}

export function isValidPin(pin) {
  return typeof pin === 'string' && /^\d{4,8}$/.test(pin);
}

// Slow down guessing: after 5 wrong PINs, refuse for 30 seconds.
let failures = 0;
let lockedUntil = 0;

export function verifyPinAttempt(pin, stored) {
  if (Date.now() < lockedUntil) return { ok: false, locked: true };
  if (checkPin(pin, stored)) {
    failures = 0;
    return { ok: true };
  }
  failures += 1;
  if (failures >= 5) {
    failures = 0;
    lockedUntil = Date.now() + 30_000;
    return { ok: false, locked: true };
  }
  return { ok: false };
}

export function parentOnly(store) {
  return (req, res, next) => {
    const stored = store.get().settings.pinHash;
    if (!stored) return next();
    const pin = req.get('x-hearth-pin');
    if (!pin) return res.status(401).json({ error: 'Parent PIN required', code: 'pin_required' });
    const result = verifyPinAttempt(pin, stored);
    if (result.ok) return next();
    return res.status(401).json({
      error: result.locked ? 'Too many tries. Wait 30 seconds.' : 'Wrong PIN',
      code: result.locked ? 'pin_locked' : 'pin_wrong',
    });
  };
}
