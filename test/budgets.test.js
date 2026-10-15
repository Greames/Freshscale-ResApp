const test = require('node:test');
const assert = require('node:assert/strict');
const { openDb } = require('../src/db');
const { seed } = require('../src/seed');
const { createApi } = require('../src/api');

const db = openDb(':memory:');
seed(db, { today: '2026-10-11' });
const api = createApi(db, { today: () => '2026-10-11' });
const call = (method, path, query = {}, body) => api.handle(method, path, query, body);

test('monthly budgets upsert and report actuals and variances', () => {
  const first = call('POST', '/api/budgets', {}, {
    outlet_id: 1, month: '2026-10', metric: 'sales', target: 500000
  });
  assert.equal(first.target, 500000);
  const updated = call('POST', '/api/budgets', {}, {
    outlet_id: 1, month: '2026-10', metric: 'sales', target: 550000
  });
  assert.equal(updated.target, 550000);
  const food = call('POST', '/api/budgets', {}, {
    outlet_id: 1, month: '2026-10', metric: 'food_cost_pct', target: 32
  });
  assert.equal(food.metric, 'food_cost_pct');
  const summary = call('GET', '/api/budgets', { month: '2026-10', outlet: '1' });
  assert.equal(summary.rows.length, 2);
  const sales = summary.rows.find((row) => row.metric === 'sales');
  assert.ok(Number.isFinite(sales.actual));
  assert.equal(sales.target, 550000);
  assert.equal(sales.variance, Math.round((sales.actual - sales.target) * 100) / 100);
  assert.ok(['On target', 'Below target'].includes(sales.status));
  assert.throws(() => call('POST', '/api/budgets', {}, {
    outlet_id: 1, month: '2026-13', metric: 'sales', target: 1
  }), /YYYY-MM/);
});