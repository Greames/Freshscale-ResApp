const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { handleAuth } = require('../src/auth');

const db = openDb(':memory:');
seed(db, { today: '2026-10-11' });
const req = () => ({ headers: {}, socket: { remoteAddress: '127.0.0.1' } });
const cookieFrom = (result) => result.setCookie.split(';')[0];

test('first-run setup creates an administrator and starts a session', () => {
  const request = req();
  const result = handleAuth(db, request, 'POST', '/api/auth/setup', {
    name: 'ResApp Admin', email: 'admin@example.com', password: 'correct horse battery'
  });
  assert.equal(result.status, 201);
  assert.equal(result.payload.user.role, 'admin');
  request.headers.cookie = cookieFrom(result);
  const status = handleAuth(db, request, 'GET', '/api/auth/status', {});
  assert.equal(status.payload.authenticated, true);
  assert.equal(status.payload.user.email, 'admin@example.com');
});

test('initial setup cannot create a second administrator', () => {
  assert.throws(() => handleAuth(db, req(), 'POST', '/api/auth/setup', {
    name: 'Other Admin', email: 'other@example.com', password: 'another strong password'
  }), /already complete/);
});

test('administrator can create outlet-scoped staff and deactivate the account', () => {
  const adminReq = req();
  const login = handleAuth(db, adminReq, 'POST', '/api/auth/login', {
    email: 'admin@example.com', password: 'correct horse battery'
  });
  adminReq.headers.cookie = cookieFrom(login);
  const staff = handleAuth(db, adminReq, 'POST', '/api/auth/users', {
    name: 'Outlet Staff', email: 'staff@example.com', password: 'another strong password',
    role: 'staff', outlet_id: 1
  });
  assert.equal(staff.payload.role, 'staff');
  assert.equal(staff.payload.outlet_id, 1);
  const updated = handleAuth(db, adminReq, 'PUT', '/api/auth/users/' + staff.payload.id, { active: false });
  assert.equal(updated.payload.active, false);
});

test('login rejects incorrect passwords and weak initial passwords', () => {
  assert.throws(() => handleAuth(db, req(), 'POST', '/api/auth/login', {
    email: 'admin@example.com', password: 'wrong password'
  }), /incorrect/);
  assert.throws(() => handleAuth(openDb(':memory:'), req(), 'POST', '/api/auth/setup', {
    name: 'Weak', email: 'weak@example.com', password: 'short'
  }), /at least 12 characters/);
});