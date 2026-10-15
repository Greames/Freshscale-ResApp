'use strict';

function operationsRoutes(db, { today }) {
  const q = (sql) => db.prepare(sql);
  const rows = (sql, ...args) => q(sql).all(...args).map((r) => ({ ...r }));
  const one = (sql, ...args) => q(sql).get(...args);
  const required = (body, fields) => {
    const missing = fields.filter((key) => body[key] === undefined || body[key] === null || body[key] === '');
    if (missing.length) { const e = new Error('Missing: ' + missing.join(', ')); e.status = 400; throw e; }
  };
  const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
  const outlet = (id) => {
    const result = one('SELECT id FROM outlets WHERE id=?', Number(id));
    if (!result) fail(404, 'Outlet not found');
    return result.id;
  };
  const allowed = (value, choices, field) => {
    if (!choices.includes(value)) fail(400, 'Invalid ' + field);
    return value;
  };
  const range = (qs) => ({ outlet: qs.outlet || 'all', from: qs.from || today(), to: qs.to || today() });
  const outletClause = (outletId) => outletId === 'all' ? { sql: '', args: [] } : { sql: ' AND outlet_id=?', args: [Number(outletId)] };

  function listTasks(qs) {
    const r = range(qs); const f = outletClause(r.outlet);
    return rows('SELECT t.*, o.name AS outlet FROM operations_tasks t JOIN outlets o ON o.id=t.outlet_id WHERE t.due_date BETWEEN ? AND ?' +
      f.sql.replaceAll('outlet_id', 't.outlet_id') +
      " ORDER BY CASE t.status WHEN 'Open' THEN 0 WHEN 'In progress' THEN 1 ELSE 2 END, CASE t.priority WHEN 'Urgent' THEN 0 WHEN 'High' THEN 1 WHEN 'Normal' THEN 2 ELSE 3 END, t.due_date",
      r.from, r.to, ...f.args);
  }
  function createTask(b) {
    required(b, ['outlet_id', 'title']);
    const oid = outlet(b.outlet_id); const priority = allowed(b.priority || 'Normal', ['Low', 'Normal', 'High', 'Urgent'], 'priority');
    const id = Number(q('INSERT INTO operations_tasks (outlet_id,title,description,assigned_to,priority,due_date,status,created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(oid, String(b.title).trim(), b.description || '', b.assigned_to || '', priority, b.due_date || today(), 'Open', today()).lastInsertRowid);
    return { ...one('SELECT * FROM operations_tasks WHERE id=?', id) };
  }
  function updateTask(p, b) {
    const task = one('SELECT * FROM operations_tasks WHERE id=?', Number(p.id));
    if (!task) fail(404, 'Task not found');
    const status = allowed(b.status || task.status, ['Open', 'In progress', 'Done', 'Blocked'], 'status');
    const priority = allowed(b.priority || task.priority, ['Low', 'Normal', 'High', 'Urgent'], 'priority');
    q('UPDATE operations_tasks SET title=?,description=?,assigned_to=?,priority=?,due_date=?,status=?,completed_at=? WHERE id=?')
      .run(b.title === undefined ? task.title : String(b.title).trim(), b.description === undefined ? task.description : b.description,
        b.assigned_to === undefined ? task.assigned_to : b.assigned_to, priority, b.due_date || task.due_date,
        status, status === 'Done' ? today() : null, task.id);
    return { ...one('SELECT * FROM operations_tasks WHERE id=?', task.id) };
  }
  function listChecklists(qs) {
    const r = range(qs); const f = outletClause(r.outlet);
    return rows('SELECT c.*, o.name AS outlet FROM operations_checklists c JOIN outlets o ON o.id=c.outlet_id WHERE c.due_date BETWEEN ? AND ?' +
      f.sql.replaceAll('outlet_id', 'c.outlet_id') + ' ORDER BY c.due_date,c.shift,c.title', r.from, r.to, ...f.args);
  }
  function createChecklist(b) {
    required(b, ['outlet_id', 'title']); const oid = outlet(b.outlet_id);
    const id = Number(q('INSERT INTO operations_checklists (outlet_id,title,area,shift,due_date,assigned_to,status,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(oid, String(b.title).trim(), b.area || 'General', b.shift || 'All day', b.due_date || today(),
        b.assigned_to || '', 'Pending', b.notes || '', today()).lastInsertRowid);
    return { ...one('SELECT * FROM operations_checklists WHERE id=?', id) };
  }
  function updateChecklist(p, b) {
    const item = one('SELECT * FROM operations_checklists WHERE id=?', Number(p.id));
    if (!item) fail(404, 'Checklist item not found');
    const status = allowed(b.status || item.status, ['Pending', 'In progress', 'Done', 'Skipped'], 'status');
    q('UPDATE operations_checklists SET status=?,assigned_to=?,notes=?,completed_at=? WHERE id=?')
      .run(status, b.assigned_to === undefined ? item.assigned_to : b.assigned_to, b.notes === undefined ? item.notes : b.notes,
        status === 'Done' ? today() : null, item.id);
    return { ...one('SELECT * FROM operations_checklists WHERE id=?', item.id) };
  }
  function listWaste(qs) {
    const r = range(qs); const f = outletClause(r.outlet);
    return rows('SELECT w.*,o.name AS outlet,i.name AS item_name,ROUND(w.qty*w.cost_per_unit,2) AS total_cost FROM waste_logs w JOIN outlets o ON o.id=w.outlet_id LEFT JOIN inventory_items i ON i.id=w.item_id WHERE w.logged_at BETWEEN ? AND ?' +
      f.sql.replaceAll('outlet_id', 'w.outlet_id') + ' ORDER BY w.logged_at DESC,w.id DESC', r.from, r.to, ...f.args);
  }
  function createWaste(b) {
    required(b, ['outlet_id', 'qty', 'reason']); const oid = outlet(b.outlet_id); const qty = Number(b.qty);
    if (!(qty > 0) || !Number.isFinite(qty)) fail(400, 'Quantity must be greater than zero');
    let item = null;
    if (b.item_id) { item = one('SELECT id,name,unit,cost FROM inventory_items WHERE id=?', Number(b.item_id)); if (!item) fail(404, 'Inventory item not found'); }
    const cost = b.cost_per_unit === undefined || b.cost_per_unit === '' ? Number(item ? item.cost : 0) : Number(b.cost_per_unit);
    if (!(cost >= 0) || !Number.isFinite(cost)) fail(400, 'Cost must be zero or greater');
    const id = Number(q('INSERT INTO waste_logs (outlet_id,item_id,qty,unit,cost_per_unit,reason,logged_at,logged_by,notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(oid, item ? item.id : null, qty, b.unit || (item ? item.unit : ''), cost, String(b.reason).trim(), b.date || today(), b.logged_by || '', b.notes || '').lastInsertRowid);
    return { ...one('SELECT * FROM waste_logs WHERE id=?', id), item_name: item ? item.name : '', total_cost: Math.round(qty * cost * 100) / 100 };
  }
  function listProduction(qs) {
    const r = range(qs); const f = outletClause(r.outlet);
    return rows('SELECT p.*,o.name AS outlet,m.name AS menu_item,m.category FROM production_plans p JOIN outlets o ON o.id=p.outlet_id JOIN menu_items m ON m.id=p.menu_item_id WHERE p.plan_date BETWEEN ? AND ?' +
      f.sql.replaceAll('outlet_id', 'p.outlet_id') + ' ORDER BY p.plan_date,p.station,m.name', r.from, r.to, ...f.args);
  }
  function createProduction(b) {
    required(b, ['outlet_id', 'menu_item_id', 'planned_qty']); const oid = outlet(b.outlet_id); const qty = Number(b.planned_qty);
    if (!(qty > 0) || !Number.isFinite(qty)) fail(400, 'Planned quantity must be greater than zero');
    const menu = one('SELECT id FROM menu_items WHERE id=? AND active=1', Number(b.menu_item_id));
    if (!menu) fail(404, 'Active menu item not found');
    const id = Number(q('INSERT INTO production_plans (outlet_id,plan_date,menu_item_id,planned_qty,assigned_to,station,status,notes) VALUES (?,?,?,?,?,?,?,?)')
      .run(oid, b.plan_date || today(), menu.id, qty, b.assigned_to || '', b.station || 'Kitchen', 'Planned', b.notes || '').lastInsertRowid);
    return { ...one('SELECT * FROM production_plans WHERE id=?', id) };
  }
  function updateProduction(p, b) {
    const item = one('SELECT * FROM production_plans WHERE id=?', Number(p.id)); if (!item) fail(404, 'Production plan not found');
    const status = allowed(b.status || item.status, ['Planned', 'In progress', 'Ready', 'Cancelled'], 'status');
    const qty = b.planned_qty === undefined ? item.planned_qty : Number(b.planned_qty);
    if (!(qty > 0) || !Number.isFinite(qty)) fail(400, 'Planned quantity must be greater than zero');
    q('UPDATE production_plans SET status=?,assigned_to=?,planned_qty=?,notes=? WHERE id=?')
      .run(status, b.assigned_to === undefined ? item.assigned_to : b.assigned_to, qty, b.notes === undefined ? item.notes : b.notes, item.id);
    return { ...one('SELECT * FROM production_plans WHERE id=?', item.id) };
  }
  function listStaffMeals(qs) {
    const r = range(qs); const f = outletClause(r.outlet);
    return rows('SELECT s.*,o.name AS outlet,ROUND(s.headcount*s.budget_per_person,2) AS planned_cost FROM staff_meal_plans s JOIN outlets o ON o.id=s.outlet_id WHERE s.plan_date BETWEEN ? AND ?' +
      f.sql.replaceAll('outlet_id', 's.outlet_id') + ' ORDER BY s.plan_date,s.meal_type', r.from, r.to, ...f.args);
  }
  function createStaffMeal(b) {
    required(b, ['outlet_id', 'meal_type', 'menu', 'headcount']); const oid = outlet(b.outlet_id);
    const headcount = Math.floor(Number(b.headcount)); const budget = Number(b.budget_per_person || 0);
    if (!(headcount > 0)) fail(400, 'Headcount must be at least one');
    if (!(budget >= 0) || !Number.isFinite(budget)) fail(400, 'Budget must be zero or greater');
    const id = Number(q('INSERT INTO staff_meal_plans (outlet_id,plan_date,meal_type,menu,headcount,budget_per_person,assigned_to,status,notes) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(oid, b.plan_date || today(), String(b.meal_type).trim(), String(b.menu).trim(), headcount, budget, b.assigned_to || '', 'Planned', b.notes || '').lastInsertRowid);
    return { ...one('SELECT * FROM staff_meal_plans WHERE id=?', id), planned_cost: Math.round(headcount * budget * 100) / 100 };
  }
  function updateStaffMeal(p, b) {
    const item = one('SELECT * FROM staff_meal_plans WHERE id=?', Number(p.id)); if (!item) fail(404, 'Staff meal plan not found');
    const status = allowed(b.status || item.status, ['Planned', 'In progress', 'Served', 'Cancelled'], 'status');
    q('UPDATE staff_meal_plans SET status=?,assigned_to=?,notes=? WHERE id=?')
      .run(status, b.assigned_to === undefined ? item.assigned_to : b.assigned_to, b.notes === undefined ? item.notes : b.notes, item.id);
    return { ...one('SELECT * FROM staff_meal_plans WHERE id=?', item.id) };
  }

  return [
    ['GET', '/api/operations/summary', (_, qs) => {
      const r = range(qs); const f = outletClause(r.outlet);
      const tasks = one("SELECT COUNT(*) AS total,SUM(CASE WHEN status='Open' THEN 1 ELSE 0 END) AS open,SUM(CASE WHEN status='In progress' THEN 1 ELSE 0 END) AS in_progress,SUM(CASE WHEN status='Done' THEN 1 ELSE 0 END) AS done FROM operations_tasks WHERE due_date BETWEEN ? AND ?" + f.sql, r.from, r.to, ...f.args);
      const checks = one("SELECT COUNT(*) AS total,SUM(CASE WHEN status='Done' THEN 1 ELSE 0 END) AS done FROM operations_checklists WHERE due_date BETWEEN ? AND ?" + f.sql, r.from, r.to, ...f.args);
      const waste = one('SELECT COUNT(*) AS entries,ROUND(COALESCE(SUM(qty*cost_per_unit),0),2) AS cost FROM waste_logs WHERE logged_at BETWEEN ? AND ?' + f.sql, r.from, r.to, ...f.args);
      const production = one("SELECT COUNT(*) AS plans,SUM(CASE WHEN status='Ready' THEN 1 ELSE 0 END) AS ready FROM production_plans WHERE plan_date BETWEEN ? AND ?" + f.sql, r.from, r.to, ...f.args);
      return { from: r.from, to: r.to, tasks, checklists: checks, waste, production };
    }],
    ['GET', '/api/operations/tasks', (_, qs) => listTasks(qs)],
    ['POST', '/api/operations/tasks', (_, __, b) => createTask(b)],
    ['PUT', '/api/operations/tasks/:id', (p, _, b) => updateTask(p, b)],
    ['GET', '/api/operations/checklists', (_, qs) => listChecklists(qs)],
    ['POST', '/api/operations/checklists', (_, __, b) => createChecklist(b)],
    ['PUT', '/api/operations/checklists/:id', (p, _, b) => updateChecklist(p, b)],
    ['GET', '/api/operations/waste', (_, qs) => listWaste(qs)],
    ['POST', '/api/operations/waste', (_, __, b) => createWaste(b)],
    ['GET', '/api/operations/production', (_, qs) => listProduction(qs)],
    ['POST', '/api/operations/production', (_, __, b) => createProduction(b)],
    ['PUT', '/api/operations/production/:id', (p, _, b) => updateProduction(p, b)],
    ['GET', '/api/operations/staff-meals', (_, qs) => listStaffMeals(qs)],
    ['POST', '/api/operations/staff-meals', (_, __, b) => createStaffMeal(b)],
    ['PUT', '/api/operations/staff-meals/:id', (p, _, b) => updateStaffMeal(p, b)],
  ];
}

module.exports = { operationsRoutes };
