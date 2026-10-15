const test = require('node:test');
const assert = require('node:assert/strict');
const { start } = require('../server');

test('HTTP API requires login and enforces role and outlet access', async () => {
  const { server, db } = await start({ port: 0, dbFile: ':memory:', reseed: false });
  const base = 'http://127.0.0.1:' + server.address().port;
  const call = async (path, method, body, cookie) => {
    const response = await fetch(base + path, {
      method: method || 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, cookie ? { Cookie: cookie } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
    const data = await response.json().catch(() => ({}));
    const setCookie = response.headers.get('set-cookie');
    return { status: response.status, data, cookie: setCookie ? setCookie.split(';')[0] : cookie };
  };
  try {
    assert.equal((await call('/api/meta')).status, 401);
    assert.equal((await call('/api/auth/status')).data.configured, false);
    const admin = await call('/api/auth/setup', 'POST', {
      name: 'Test Admin', email: 'admin@test.example', password: 'a secure test password'
    });
    assert.equal(admin.status, 201);
    assert.equal((await call('/api/meta', 'GET', null, admin.cookie)).data.outlets.length, 3);

    const managerCreated = await call('/api/auth/users', 'POST', {
      name: 'Test Manager', email: 'manager@test.example', password: 'another secure password',
      role: 'manager', outlet_id: 2
    }, admin.cookie);
    assert.equal(managerCreated.status, 201);
    const manager = await call('/api/auth/login', 'POST', {
      email: 'manager@test.example', password: 'another secure password'
    });
    assert.equal(manager.status, 200);
    const managerMeta = await call('/api/meta', 'GET', null, manager.cookie);
    assert.equal(managerMeta.data.outlets.length, 1);
    assert.equal(managerMeta.data.outlets[0].id, 2);
    const adminOrders = await call('/api/orders?outlet=all', 'GET', null, admin.cookie);
    const foreignOrder = adminOrders.data.find((order) => order.outlet_id !== 2);
    assert.ok(foreignOrder);
    assert.equal((await call('/api/orders/' + foreignOrder.id, 'GET', null, manager.cookie)).status, 404);
    const foreignTask = await call('/api/operations/tasks', 'POST', {
      outlet_id: 1, title: 'Private outlet task', due_date: new Date().toISOString().slice(0, 10)
    }, admin.cookie);
    assert.equal((await call('/api/operations/tasks/' + foreignTask.data.id, 'PUT', { status: 'Done' }, manager.cookie)).status, 404);
    assert.equal((await call('/api/menu/1', 'PUT', { price: 999 }, manager.cookie)).status, 403);

    const staffCreated = await call('/api/auth/users', 'POST', {
      name: 'Test Staff', email: 'staff@test.example', password: 'staff secure password',
      role: 'staff', outlet_id: 2
    }, admin.cookie);
    assert.equal(staffCreated.status, 201);
    const staff = await call('/api/auth/login', 'POST', {
      email: 'staff@test.example', password: 'staff secure password'
    });
    assert.equal(staff.status, 200);
    assert.equal((await call('/api/payroll?month=2026-10', 'GET', null, staff.cookie)).status, 403);
    assert.equal((await call('/api/operations/summary', 'GET', null, staff.cookie)).status, 200);
    assert.equal((await call('/api/auth/logout', 'POST', {}, staff.cookie)).status, 200);
    assert.equal((await call('/api/meta', 'GET', null, staff.cookie)).status, 401);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
  }
});