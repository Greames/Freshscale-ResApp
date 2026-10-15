const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { createApi } = require('../src/api');

const TODAY = '2026-10-11';
const db = openDb(':memory:');
seed(db, { today: TODAY });
const api = createApi(db, { today: () => TODAY });
const call = (method, path, query = {}, body) => api.handle(method, path, query, body);

test('operations tasks can be assigned and moved through statuses', () => {
  const task = call('POST', '/api/operations/tasks', {}, {
    outlet_id: 1, title: 'Check chiller temperature', assigned_to: 'Shift manager',
    priority: 'High', due_date: TODAY, description: 'Record opening temperature'
  });
  assert.equal(task.status, 'Open');
  assert.equal(task.priority, 'High');
  const updated = call('PUT', '/api/operations/tasks/' + task.id, {}, { status: 'Done' });
  assert.equal(updated.status, 'Done');
  assert.equal(updated.completed_at, TODAY);
  assert.equal(call('GET', '/api/operations/tasks', { outlet: '1', from: TODAY, to: TODAY }).length, 1);
});

test('checklists support shift routines and completion tracking', () => {
  const item = call('POST', '/api/operations/checklists', {}, {
    outlet_id: 1, title: 'Sanitize prep counters', area: 'Kitchen', shift: 'Opening',
    assigned_to: 'Supervisor', due_date: TODAY
  });
  assert.equal(item.status, 'Pending');
  const updated = call('PUT', '/api/operations/checklists/' + item.id, {}, { status: 'Done', notes: 'Verified' });
  assert.equal(updated.status, 'Done');
  assert.equal(updated.notes, 'Verified');
});

test('waste log records quantity and calculated cost', () => {
  const before = call('GET', '/api/inventory', { outlet: '1' });
  const item = before.items.find((row) => row.onHand > 3) || before.items[0];
  const waste = call('POST', '/api/operations/waste', {}, {
    outlet_id: 1, item_id: item.id, qty: 2, reason: 'Preparation error', date: TODAY
  });
  assert.equal(waste.item_name, item.name);
  assert.equal(waste.total_cost, Math.round(2 * item.cost * 100) / 100);
  const after = call('GET', '/api/inventory', { outlet: '1' }).items.find((row) => row.id === item.id);
  assert.equal(after.wasted, 2);
  assert.equal(after.onHand, Math.round(Math.max(0, item.onHand - 2) * 100) / 100);
  assert.equal(call('GET', '/api/operations/waste', { outlet: '1', from: TODAY, to: TODAY }).length, 1);
  assert.throws(() => call('POST', '/api/operations/waste', {}, { outlet_id: 1, qty: 0, reason: 'Other' }), /greater than zero/);
});

test('kitchen production plans assign a menu item to a station and owner', () => {
  const plan = call('POST', '/api/operations/production', {}, {
    outlet_id: 1, menu_item_id: 1, planned_qty: 40, plan_date: TODAY, station: 'Grill', assigned_to: 'Chef A'
  });
  assert.equal(plan.status, 'Planned');
  const updated = call('PUT', '/api/operations/production/' + plan.id, {}, { status: 'Ready' });
  assert.equal(updated.status, 'Ready');
  assert.equal(call('GET', '/api/operations/production', { outlet: '1', from: TODAY, to: TODAY }).length, 1);
});

test('staff meal plans calculate headcount budget and track service status', () => {
  const plan = call('POST', '/api/operations/staff-meals', {}, {
    outlet_id: 1, meal_type: 'Lunch', menu: 'Rice, dal and vegetables',
    headcount: 14, budget_per_person: 65, plan_date: TODAY, assigned_to: 'Kitchen lead'
  });
  assert.equal(plan.planned_cost, 910);
  const updated = call('PUT', '/api/operations/staff-meals/' + plan.id, {}, { status: 'Served' });
  assert.equal(updated.status, 'Served');
  assert.equal(call('GET', '/api/operations/staff-meals', { outlet: '1', from: TODAY, to: TODAY }).length, 1);
});

test('operations summary returns task, checklist, waste and production KPIs', () => {
  const summary = call('GET', '/api/operations/summary', { outlet: '1', from: TODAY, to: TODAY });
  assert.ok(summary.tasks.total >= 1);
  assert.ok(summary.checklists.total >= 1);
  assert.ok(summary.waste.entries >= 1);
  assert.ok(summary.production.plans >= 1);
});