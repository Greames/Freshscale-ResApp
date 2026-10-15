'use strict';
const crypto = require('node:crypto');

const COOKIE = 'resapp_session';
const SESSION_HOURS = 8;
const attempts = new Map();

function authError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}
function passwordHash(password, salt) {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}
function publicUser(user) {
  return { id: user.id, email: user.email, name: user.name, role: user.role, outlet_id: user.outlet_id, active: Boolean(user.active) };
}
function cookies(req) {
  const raw = req.headers.cookie || '';
  return Object.fromEntries(raw.split(';').map((part) => part.trim().split(/=(.*)/s).slice(0, 2)).filter((pair) => pair.length === 2));
}
function sessionUser(db, req) {
  const token = cookies(req)[COOKIE];
  if (!token) return null;
  const session = db.prepare('SELECT u.id,u.email,u.name,u.role,u.outlet_id,u.active,s.token_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>? AND u.active=1')
    .get(hashToken(token), new Date().toISOString());
  return session ? publicUser(session) : null;
}
function cookieValue(req, token, maxAge) {
  const secure = Boolean(req.socket && req.socket.encrypted) || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
  return COOKIE + '=' + token + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + maxAge + (secure ? '; Secure' : '');
}
function startSession(db, req, user) {
  const token = crypto.randomBytes(32).toString('hex');
  const now = new Date();
  const expires = new Date(now.getTime() + SESSION_HOURS * 60 * 60 * 1000);
  db.prepare('INSERT INTO sessions (token_hash,user_id,expires_at,created_at) VALUES (?,?,?,?)')
    .run(hashToken(token), user.id, expires.toISOString(), now.toISOString());
  return { setCookie: cookieValue(req, token, SESSION_HOURS * 60 * 60), user: publicUser(user) };
}
function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 12) throw authError(400, 'Password must be at least 12 characters');
}
function validateEmail(email) {
  const value = String(email || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) throw authError(400, 'Enter a valid email address');
  return value;
}
function createUser(db, body, role, outletId) {
  const email = validateEmail(body.email);
  const name = String(body.name || '').trim();
  if (!name) throw authError(400, 'Name is required');
  validatePassword(body.password);
  if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) throw authError(409, 'An account with this email already exists');
  if (!['admin', 'manager', 'staff'].includes(role)) throw authError(400, 'Invalid role');
  if (role !== 'admin') {
    const outlet = db.prepare('SELECT id FROM outlets WHERE id=?').get(Number(outletId));
    if (!outlet) throw authError(400, 'A valid outlet is required for managers and staff');
  }
  const salt = crypto.randomBytes(16).toString('hex');
  const result = db.prepare('INSERT INTO users (email,name,password_salt,password_hash,role,outlet_id,active,created_at) VALUES (?,?,?,?,?,?,1,?)')
    .run(email, name, salt, passwordHash(body.password, salt), role, role === 'admin' ? null : Number(outletId), new Date().toISOString());
  return publicUser(db.prepare('SELECT id,email,name,role,outlet_id,active FROM users WHERE id=?').get(Number(result.lastInsertRowid)));
}
function handleAuth(db, req, method, pathname, body) {
  const userCount = () => db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  if (method === 'GET' && pathname === '/api/auth/status') {
    const user = sessionUser(db, req);
    return { status: 200, payload: { configured: userCount() > 0, authenticated: Boolean(user), user } };
  }
  if (method === 'POST' && pathname === '/api/auth/setup') {
    if (userCount() > 0) throw authError(409, 'Initial setup is already complete. Sign in instead.');
    const user = createUser(db, body, 'admin', null);
    const session = startSession(db, req, db.prepare('SELECT * FROM users WHERE id=?').get(user.id));
    return { status: 201, payload: { user: session.user }, setCookie: session.setCookie };
  }
  if (method === 'POST' && pathname === '/api/auth/login') {
    if (userCount() === 0) throw authError(428, 'Set up the first administrator account first.');
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
    const now = Date.now(); const limit = attempts.get(ip);
    if (limit && limit.until > now && limit.count >= 5) throw authError(429, 'Too many sign-in attempts. Try again in 15 minutes.');
    const email = validateEmail(body.email);
    const user = db.prepare('SELECT * FROM users WHERE email=? AND active=1').get(email);
    const ok = user && typeof body.password === 'string' &&
      crypto.timingSafeEqual(Buffer.from(passwordHash(body.password, user.password_salt), 'hex'), Buffer.from(user.password_hash, 'hex'));
    if (!ok) {
      const next = limit && limit.until > now ? { count: limit.count + 1, until: limit.until } : { count: 1, until: now + 15 * 60 * 1000 };
      attempts.set(ip, next);
      throw authError(401, 'Email or password is incorrect');
    }
    attempts.delete(ip);
    const session = startSession(db, req, user);
    return { status: 200, payload: { user: session.user }, setCookie: session.setCookie };
  }
  if (method === 'POST' && pathname === '/api/auth/logout') {
    const token = cookies(req)[COOKIE];
    if (token) db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hashToken(token));
    return { status: 200, payload: { ok: true }, setCookie: cookieValue(req, '', 0) };
  }
  if (method === 'GET' && pathname === '/api/auth/users') {
    const current = sessionUser(db, req);
    if (!current) throw authError(401, 'Sign in required');
    if (current.role !== 'admin') throw authError(403, 'Administrator access required');
    const users = db.prepare('SELECT id,email,name,role,outlet_id,active,created_at FROM users ORDER BY name').all().map(publicUser);
    return { status: 200, payload: users };
  }
  if (method === 'POST' && pathname === '/api/auth/users') {
    const current = sessionUser(db, req);
    if (!current) throw authError(401, 'Sign in required');
    if (current.role !== 'admin') throw authError(403, 'Administrator access required');
    const role = body.role || 'staff';
    const user = createUser(db, body, role, body.outlet_id);
    return { status: 201, payload: user };
  }
  const userMatch = pathname.match(/^\/api\/auth\/users\/(\d+)$/);
  if (method === 'PUT' && userMatch) {
    const current = sessionUser(db, req);
    if (!current) throw authError(401, 'Sign in required');
    if (current.role !== 'admin') throw authError(403, 'Administrator access required');
    const id = Number(userMatch[1]);
    if (id === current.id && body.active === false) throw authError(400, 'You cannot deactivate your own account');
    const existing = db.prepare('SELECT id FROM users WHERE id=?').get(id);
    if (!existing) throw authError(404, 'User not found');
    db.prepare('UPDATE users SET active=? WHERE id=?').run(body.active ? 1 : 0, id);
    if (!body.active) db.prepare('DELETE FROM sessions WHERE user_id=?').run(id);
    return { status: 200, payload: publicUser(db.prepare('SELECT id,email,name,role,outlet_id,active FROM users WHERE id=?').get(id)) };
  }
  return null;
}
module.exports = { handleAuth, sessionUser };
