'use strict';
(function () {
  const $ = (s, r) => (r || document).querySelector(s);
  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (v) => '₹' + new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(Number(v || 0));
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
  const state = { meta: null, user: null, tab: 'tasks', from: today, to: today, outlet: 'all', inventory: [], menu: [] };
  const api = async (url, method, body) => {
    const opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(url, opts); const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || 'Request failed (' + res.status + ')');
    return data;
  };
  const params = () => new URLSearchParams({ outlet: state.outlet, from: state.from, to: state.to }).toString();
  const selectOutlets = () => state.meta.outlets.map((o) => '<option value="' + o.id + '"' + (String(o.id) === state.outlet ? ' selected' : '') + '>' + esc(o.name) + ' · ' + esc(o.city) + '</option>').join('');
  const options = (rows, value, label) => rows.map((r) => '<option value="' + esc(r[value]) + '">' + esc(r[label]) + '</option>').join('');
  const field = (label, html) => '<label class="op-field"><span>' + label + '</span>' + html + '</label>';
  const input = (name, label, type, required, extra) => field(label, '<input name="' + name + '" type="' + (type || 'text') + '"' + (required ? ' required' : '') + (extra || '') + '>');
  const formShell = (id, title, fields, submit) => '<section class="card"><div class="card-head"><h2>' + title + '</h2></div><form id="' + id + '" class="op-form">' + fields + '<div class="op-actions"><button class="btn primary" type="submit">' + submit + '</button></div></form></section>';
  const table = (headers, rows, empty) => rows.length
    ? '<div class="table-wrap"><table><thead><tr>' + headers.map((h) => '<th>' + h + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>'
    : '<div class="empty">' + (empty || 'No records for this date range.') + '</div>';
  const statusSelect = (kind, id, current, statuses) => '<select aria-label="Update status" data-status-kind="' + kind + '" data-status-id="' + id + '">' +
    statuses.map((s) => '<option' + (s === current ? ' selected' : '') + '>' + s + '</option>').join('') + '</select>';
  const statusCell = (kind, id, current, statuses) => '<td>' + statusSelect(kind, id, current, statuses) + '</td>';
  function shell() {
    const usersTab = $('[data-ops-tab="users"]');
    const budgetTab = $('[data-ops-tab="budgets"]');
    if (usersTab) usersTab.hidden = !state.user || state.user.role !== 'admin';
    if (budgetTab) budgetTab.hidden = !state.user || state.user.role === 'staff';
    if (state.tab === 'users' && (!state.user || state.user.role !== 'admin')) state.tab = 'tasks';
    if (state.tab === 'budgets' && (!state.user || state.user.role === 'staff')) state.tab = 'tasks';
    $('#outlet').innerHTML = '<option value="all">All outlets</option>' + selectOutlets();
    $('#outlet').value = state.outlet;
    $('#from').value = state.from; $('#to').value = state.to;
    document.querySelectorAll('[data-ops-tab]').forEach((b) => {
      b.classList.toggle('active', b.dataset.opsTab === state.tab);
      b.setAttribute('aria-selected', String(b.dataset.opsTab === state.tab));
    });
  }
  function summaryCards(s) {
    const cards = [
      ['Open tasks', Number(s.tasks.open || 0), (s.tasks.total || 0) + ' tasks in range'],
      ['Checklist completion', (s.checklists.done || 0) + ' / ' + (s.checklists.total || 0), 'completed checks'],
      ['Recorded waste', money(s.waste.cost), (s.waste.entries || 0) + ' entries'],
      ['Production ready', (s.production.ready || 0) + ' / ' + (s.production.plans || 0), 'production plans ready']
    ];
    return '<div class="kpis">' + cards.map((c) => '<div class="kpi"><div class="label">' + c[0] + '</div><div class="value">' + c[1] + '</div><div class="sub">' + c[2] + '</div></div>').join('') + '</div>';
  }
  async function renderTasks() {
    const data = await api('/api/operations/tasks?' + params());
    const rows = data.map((t) => '<tr><td><strong>' + esc(t.title) + '</strong><div class="muted">' + esc(t.description) + '</div></td><td>' + esc(t.outlet) + '</td><td>' + esc(t.assigned_to || 'Unassigned') + '</td><td>' + esc(t.priority) + '</td><td>' + esc(t.due_date) + '</td>' + statusCell('task', t.id, t.status, ['Open','In progress','Done','Blocked']) + '</tr>');
    const fields = input('title','Task title','text',true) + input('description','Description','text',false) +
      input('assigned_to','Assigned to','text',false) +
      field('Priority','<select name="priority"><option>Normal</option><option>Low</option><option>High</option><option>Urgent</option></select>') +
      input('due_date','Due date','date',true,' value="' + state.to + '"');
    return formShell('task-form','Create task',fields,'Add task') + '<section class="card"><div class="card-head"><h2>Tasks</h2><p>Assign ownership, priority and due dates</p></div>' +
      table(['Task','Outlet','Assigned to','Priority','Due','Status'],rows,'No tasks for this date range.') + '</section>';
  }
  async function renderChecklists() {
    const data = await api('/api/operations/checklists?' + params());
    const rows = data.map((c) => '<tr><td><strong>' + esc(c.title) + '</strong><div class="muted">' + esc(c.area) + ' · ' + esc(c.shift) + '</div></td><td>' + esc(c.outlet) + '</td><td>' + esc(c.assigned_to || 'Unassigned') + '</td><td>' + esc(c.due_date) + '</td>' + statusCell('checklist', c.id, c.status, ['Pending','In progress','Done','Skipped']) + '</tr>');
    const fields = input('title','Checklist item','text',true) + input('area','Area (e.g. kitchen, hygiene)','text',false) +
      field('Shift','<select name="shift"><option>All day</option><option>Opening</option><option>Morning</option><option>Afternoon</option><option>Closing</option></select>') +
      input('assigned_to','Assigned to','text',false) + input('due_date','Due date','date',true,' value="' + state.to + '"') + input('notes','Instructions','text',false);
    return formShell('checklist-form','Add checklist item',fields,'Add item') + '<section class="card"><div class="card-head"><h2>Operational checklists</h2><p>Opening, closing, food safety and service routines</p></div>' +
      table(['Checklist item','Outlet / shift','Assigned to','Due','Status'],rows,'No checklist items for this date range.') + '</section>';
  }
  async function renderWaste() {
    const [data, inv] = await Promise.all([api('/api/operations/waste?' + params()), api('/api/inventory?outlet=' + encodeURIComponent(state.outlet === 'all' ? state.meta.outlets[0].id : state.outlet))]);
    state.inventory = inv.items || [];
    const itemOpts = '<option value="">Other / not linked to stock</option>' + state.inventory.map((i) => '<option value="' + i.id + '">' + esc(i.name) + ' (' + esc(i.unit) + ')</option>').join('');
    const rows = data.map((w) => '<tr><td>' + esc(w.logged_at) + '</td><td>' + esc(w.outlet) + '</td><td>' + esc(w.item_name || 'Other') + '</td><td>' + esc(w.qty) + ' ' + esc(w.unit) + '</td><td>' + esc(w.reason) + '</td><td class="num">' + money(w.total_cost) + '</td><td>' + esc(w.logged_by || '—') + '</td></tr>');
    const fields = field('Inventory item','<select name="item_id">' + itemOpts + '</select>') + input('qty','Quantity wasted','number',true,' min="0.01" step="0.01"') +
      input('unit','Unit (if not selected)','text',false) + input('cost_per_unit','Unit cost (optional)','number',false,' min="0" step="0.01"') +
      field('Reason','<select name="reason" required><option value="">Choose reason</option><option>Expired</option><option>Preparation error</option><option>Overproduction</option><option>Spillage / damage</option><option>Customer return</option><option>Other</option></select>') +
      input('logged_by','Recorded by','text',false) + input('date','Date','date',true,' value="' + state.to + '"') + input('notes','Notes','text',false);
    return formShell('waste-form','Record food waste',fields,'Save waste entry') + '<section class="card"><div class="card-head"><h2>Waste log</h2><p>Track causes and estimated cost to reduce avoidable waste</p></div>' +
      table(['Date','Outlet','Item','Quantity','Reason','Cost','Recorded by'],rows,'No waste entries for this date range.') + '</section>';
  }
  async function renderProduction() {
    const [data, menu] = await Promise.all([api('/api/operations/production?' + params()), api('/api/menu')]);
    state.menu = menu.filter((m) => m.active);
    const menuOpts = state.menu.map((m) => '<option value="' + m.id + '">' + esc(m.name) + ' · ' + money(m.price) + '</option>').join('');
    const rows = data.map((p) => '<tr><td>' + esc(p.plan_date) + '</td><td><strong>' + esc(p.menu_item) + '</strong></td><td>' + esc(p.outlet) + '</td><td>' + esc(p.planned_qty) + '</td><td>' + esc(p.station) + '</td><td>' + esc(p.assigned_to || 'Unassigned') + '</td>' + statusCell('production', p.id, p.status, ['Planned','In progress','Ready','Cancelled']) + '</tr>');
    const fields = field('Menu item','<select name="menu_item_id" required>' + menuOpts + '</select>') + input('planned_qty','Planned quantity / portions','number',true,' min="1" step="1"') +
      input('plan_date','Production date','date',true,' value="' + state.to + '"') + input('station','Station','text',false,' value="Kitchen"') + input('assigned_to','Kitchen owner','text',false) + input('notes','Prep notes','text',false);
    return formShell('production-form','Plan kitchen production',fields,'Add production plan') + '<section class="card"><div class="card-head"><h2>Production plan</h2><p>Plan quantities and assign preparation to kitchen staff</p></div>' +
      table(['Date','Menu item','Outlet','Qty','Station','Assigned to','Status'],rows,'No production plans for this date range.') + '</section>';
  }
  async function renderBudgets() {
    const month = state.to.slice(0, 7);
    const data = await api('/api/budgets?' + new URLSearchParams({ month: month, outlet: state.outlet }).toString());
    const metricLabels = { sales: 'Net sales', food_cost_pct: 'Food cost %', labour_pct: 'Labour cost %', expenses: 'Operating expenses' };
    const display = (metric, value) => metric.endsWith('_pct') ? Number(value || 0).toFixed(1) + '%' : money(value);
    const rows = data.rows.map((b) => '<tr><td>' + esc(b.outlet) + '</td><td>' + esc(metricLabels[b.metric] || b.metric) + '</td><td class="num">' + display(b.metric, b.target) + '</td><td class="num">' + display(b.metric, b.actual) + '</td><td class="num">' + display(b.metric, b.variance) + '</td><td><span class="badge ' + (b.status === 'On target' ? 'good' : 'warn') + '">' + esc(b.status) + '</span></td></tr>');
    const outletOptions = state.meta.outlets.map((o) => '<option value="' + o.id + '"' + (String(o.id) === (state.outlet === 'all' ? String(state.meta.outlets[0].id) : state.outlet) ? ' selected' : '') + '>' + esc(o.name) + '</option>').join('');
    const fields = field('Budget outlet','<select name="outlet_id" required>' + outletOptions + '</select>') +
      field('Metric','<select name="metric"><option value="sales">Net sales (₹)</option><option value="food_cost_pct">Food cost (%)</option><option value="labour_pct">Labour cost (%)</option><option value="expenses">Operating expenses (₹)</option></select>') +
      input('month','Budget month','month',true,' value="' + month + '"') +
      input('target','Monthly target','number',true,' min="0" step="0.01"');
    return formShell('budgets-form','Set monthly budget',fields,'Save budget') +
      '<section class="card"><div class="card-head"><h2>Budget versus actual</h2><p>Sales targets should be met or exceeded; cost targets should not be exceeded</p></div>' +
      table(['Outlet','Metric','Target','Actual','Variance','Status'],rows,'No budgets for this month. Add a target above to start tracking.') + '</section>';
  }
  async function renderUsers() {
    const data = await api('/api/auth/users');
    const rows = data.map((u) => {
      const outlet = state.meta.outlets.find((o) => o.id === u.outlet_id);
      const active = Boolean(u.active);
      const toggle = u.id === state.user.id ? '<button class="btn" disabled>Current user</button>' :
        '<button class="btn" data-user-toggle="' + u.id + '" data-active="' + (active ? '1' : '0') + '">' + (active ? 'Deactivate' : 'Activate') + '</button>';
      return '<tr><td><strong>' + esc(u.name) + '</strong><div class="muted">' + esc(u.email) + '</div></td><td>' + esc(u.role) + '</td><td>' + esc(outlet ? outlet.name : 'All outlets') + '</td><td>' + (active ? 'Active' : 'Inactive') + '</td><td>' + toggle + '</td></tr>';
    });
    const outletOptions = state.meta.outlets.map((o) => '<option value="' + o.id + '">' + esc(o.name) + '</option>').join('');
    const fields = input('name','Full name','text',true) + input('email','Email','email',true) +
      input('password','Temporary password (12+ characters)','password',true,' minlength="12"') +
      field('Role','<select name="role"><option value="staff">Staff</option><option value="manager">Manager</option><option value="admin">Administrator</option></select>') +
      field('Assigned outlet','<select name="outlet_id" required>' + outletOptions + '</select>');
    return formShell('users-form','Create team account',fields,'Create account') +
      '<section class="card"><div class="card-head"><h2>Team access</h2><p>Managers and staff are restricted to their assigned outlet</p></div>' +
      table(['User','Role','Outlet access','Status','Action'],rows,'No user accounts.') + '</section>';
  }
  async function renderStaffMeals() {
    const data = await api('/api/operations/staff-meals?' + params());
    const rows = data.map((m) => '<tr><td>' + esc(m.plan_date) + '</td><td>' + esc(m.meal_type) + '</td><td><strong>' + esc(m.menu) + '</strong><div class="muted">' + esc(m.notes || '') + '</div></td><td>' + esc(m.outlet) + '</td><td>' + esc(m.headcount) + '</td><td class="num">' + money(m.budget_per_person) + '</td><td class="num">' + money(m.planned_cost) + '</td><td>' + esc(m.assigned_to || 'Unassigned') + '</td>' + statusCell('staffmeal', m.id, m.status, ['Planned','In progress','Served','Cancelled']) + '</tr>');
    const fields = field('Meal','<select name="meal_type"><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select>') +
      input('menu','Planned menu','text',true) + input('headcount','Expected staff count','number',true,' min="1" step="1"') +
      input('budget_per_person','Budget per person (₹)','number',false,' min="0" step="0.01"') +
      input('plan_date','Meal date','date',true,' value="' + state.to + '"') + input('assigned_to','Meal owner','text',false) + input('notes','Notes / dietary needs','text',false);
    return formShell('staff-meal-form','Plan staff meals',fields,'Save meal plan') + '<section class="card"><div class="card-head"><h2>Staff meal calendar</h2><p>Plan meals from expected headcount and per-person budget</p></div>' +
      table(['Date','Meal','Menu','Outlet','Staff','Budget / person','Planned cost','Assigned to','Status'],rows,'No staff meal plans for this date range.') + '</section>';
  }
  async function render() {
    shell();
    const main = $('#ops-view');
    main.innerHTML = '<div class="empty">Loading operations data…</div>';
    try {
      const summary = await api('/api/operations/summary?' + params());
      const renderers = { tasks: renderTasks, checklists: renderChecklists, waste: renderWaste, production: renderProduction, 'staff-meals': renderStaffMeals, budgets: renderBudgets, users: renderUsers };
      main.innerHTML = summaryCards(summary) + await renderers[state.tab]();
      bindForm();
      bindStatus();
      bindUserToggles();
    } catch (err) {
      main.innerHTML = '<section class="card empty">Could not load operations: ' + esc(err.message) + '</section>';
    }
  }
  function bindForm() {
    const forms = {
      'task-form': { path: '/api/operations/tasks', tab: 'tasks', convert: (v) => v },
      'checklist-form': { path: '/api/operations/checklists', tab: 'checklists', convert: (v) => v },
      'waste-form': { path: '/api/operations/waste', tab: 'waste', convert: (v) => { v.qty = Number(v.qty); v.cost_per_unit = v.cost_per_unit === '' ? undefined : Number(v.cost_per_unit); v.item_id = v.item_id || undefined; return v; } },
      'production-form': { path: '/api/operations/production', tab: 'production', convert: (v) => { v.menu_item_id = Number(v.menu_item_id); v.planned_qty = Number(v.planned_qty); return v; } },
      'staff-meal-form': { path: '/api/operations/staff-meals', tab: 'staff-meals', convert: (v) => { v.headcount = Number(v.headcount); v.budget_per_person = Number(v.budget_per_person || 0); return v; } },
      'users-form': { path: '/api/auth/users', tab: 'users', convert: (v) => v },
      'budgets-form': { path: '/api/budgets', tab: 'budgets', convert: (v) => { v.target = Number(v.target); v.outlet_id = Number(v.outlet_id); return v; } }
    };
    Object.keys(forms).forEach((id) => {
      const form = $('#' + id); if (!form) return;
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const spec = forms[id]; const body = spec.convert(Object.fromEntries(new FormData(form)));
        if (spec.tab !== 'users' && spec.tab !== 'budgets') body.outlet_id = state.outlet === 'all' ? state.meta.outlets[0].id : Number(state.outlet);
        else body.outlet_id = Number(body.outlet_id);
        try { await api(spec.path, 'POST', body); toast('Saved successfully'); render(); }
        catch (err) { toast(err.message, true); }
      });
    });
  }
  function bindStatus() {
    document.querySelectorAll('[data-status-kind]').forEach((el) => {
      el.addEventListener('change', async () => {
        const routes = { task: '/api/operations/tasks/', checklist: '/api/operations/checklists/', production: '/api/operations/production/', staffmeal: '/api/operations/staff-meals/' };
        try { await api(routes[el.dataset.statusKind] + el.dataset.statusId, 'PUT', { status: el.value }); toast('Status updated'); render(); }
        catch (err) { toast(err.message, true); }
      });
    });
  }
  function bindUserToggles() {
    document.querySelectorAll('[data-user-toggle]').forEach((button) => {
      button.addEventListener('click', async () => {
        try {
          await api('/api/auth/users/' + button.dataset.userToggle, 'PUT', { active: button.dataset.active !== '1' });
          toast(button.dataset.active === '1' ? 'Account deactivated' : 'Account activated');
          render();
        } catch (err) { toast(err.message, true); }
      });
    });
  }
  let toastTimer;
  function toast(message, error) {
    const el = $('#ops-toast'); el.textContent = message; el.className = 'toast' + (error ? ' error' : ''); el.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, 3000);
  }
  document.querySelectorAll('[data-ops-tab]').forEach((b) => b.addEventListener('click', () => { state.tab = b.dataset.opsTab; render(); }));
  $('#outlet').addEventListener('change', (e) => { state.outlet = e.target.value; render(); });
  $('#from').addEventListener('change', (e) => { state.from = e.target.value || today; render(); });
  $('#to').addEventListener('change', (e) => { state.to = e.target.value || today; render(); });
  $('#back-dashboard').href = 'index.html#/dashboard';
  $('#ops-logout').addEventListener('click', async () => { try { await api('/api/auth/logout', 'POST'); } finally { location.replace('login.html'); } });
  api('/api/auth/status').then((auth) => {
    if (!auth.authenticated) { location.replace('login.html'); return null; }
    state.user = auth.user;
    return api('/api/meta');
  }).then((meta) => { if (!meta) return; state.meta = meta; shell(); render(); }).catch((err) => {
    $('#ops-view').innerHTML = '<section class="card empty">Unable to connect to ResApp API: ' + esc(err.message) + '</section>';
  });
})();