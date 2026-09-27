import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SECRET = process.env.JWT_SECRET || randomBytes(32).toString('hex');
const TOKEN_TTL_SECONDS = 8 * 60 * 60;

/** scrypt с солью: "salt:hash" в hex. */
export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const expected = Buffer.from(hash, 'hex');
  const actual = scryptSync(password, salt, 64);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

const b64url = buf => Buffer.from(buf).toString('base64url');
const sign = data => createHmac('sha256', SECRET).update(data).digest('base64url');

/** Минимальный JWT (HS256) без сторонних библиотек. */
export function createToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const now = Math.floor(Date.now() / 1000);
  const body = b64url(JSON.stringify({ ...payload, iat: now, exp: now + TOKEN_TTL_SECONDS }));
  return `${header}.${body}.${sign(`${header}.${body}`)}`;
}

export function verifyToken(token) {
  const [header, body, signature] = String(token).split('.');
  if (!header || !body || !signature) return null;
  const expected = Buffer.from(sign(`${header}.${body}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
  return payload.exp > Date.now() / 1000 ? payload : null;
}

export function requireAuth(req, res, next) {
  const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const payload = token && verifyToken(token);
  if (!payload) return res.status(401).json({ error: 'Нужна авторизация' });
  req.user = payload;
  next();
}

/** Простой лимитер: не больше `limit` попыток за `windowMs` с одного IP. */
export function rateLimit({ limit, windowMs }) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) Object.assign(entry, { count: 0, reset: now + windowMs });
    entry.count++;
    hits.set(req.ip, entry);
    if (entry.count > limit) {
      res.set('Retry-After', Math.ceil((entry.reset - now) / 1000));
      return res.status(429).json({ error: 'Слишком много попыток. Подождите минуту.' });
    }
    next();
  };
}
