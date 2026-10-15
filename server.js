const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb } = require('./src/db');
const { seed } = require('./src/seed');
const { createApi, HttpError } = require('./src/api');
const { handleAuth, sessionUser } = require('./src/auth');

const PORT = Number(process.env.PORT) || 3000;
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'data', 'rasoinet.db');
const PUBLIC = path.join(__dirname, 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };

function start({ port = PORT, dbFile = DB_FILE, reseed = process.argv.includes('--reseed') } = {}) {
  if (dbFile !== ':memory:') {
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    if (reseed) ['', '-wal', '-shm'].forEach((s) => fs.rmSync(dbFile + s, { force: true }));
  }
  const db = openDb(dbFile);
  if (!db.prepare('SELECT COUNT(*) AS n FROM outlets').get().n) {
    console.log('Seeding demo data…');
    seed(db);
  }
  const api = createApi(db);

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) {
      let raw = '';
      req.on('data', (c) => { raw += c; if (raw.length > 1e6) req.destroy(); });
      req.on('end', () => {
        try {
          const body = raw ? JSON.parse(raw) : {};
          const authResult = handleAuth(db, req, req.method, url.pathname, body);
          if (authResult) {
            const headers = { 'Content-Type': 'application/json' };
            if (authResult.setCookie) headers['Set-Cookie'] = authResult.setCookie;
            res.writeHead(authResult.status, headers);
            res.end(JSON.stringify(authResult.payload));
            return;
          }
          const user = sessionUser(db, req);
          if (!user) throw new HttpError(401, 'Sign in required');
          const query = Object.fromEntries(url.searchParams);
          if (user.role !== 'admin') {
            query.outlet = String(user.outlet_id);
            body.outlet_id = user.outlet_id;
          }
          if (user.role === 'staff') {
            const staffAllowed = url.pathname === '/api/meta' || url.pathname === '/api/menu' || url.pathname === '/api/inventory' ||
              /^\/api\/operations\/(summary|tasks(?:\/\d+)?|checklists(?:\/\d+)?|waste|production(?:\/\d+)?|staff-meals(?:\/\d+)?)$/.test(url.pathname);
            if (!staffAllowed) throw new HttpError(403, 'Your role does not have access to this module');
          }
          if (user.role !== 'admin') {
            const assertOwnOutlet = (table, id) => {
              const record = db.prepare('SELECT outlet_id FROM ' + table + ' WHERE id=?').get(Number(id));
              if (!record || Number(record.outlet_id) !== Number(user.outlet_id)) throw new HttpError(404, 'Record not found');
            };
            let match;
            if (req.method === 'GET' && (match = url.pathname.match(/^\/api\/orders\/(\d+)$/))) assertOwnOutlet('orders', match[1]);
            if (req.method === 'GET' && (match = url.pathname.match(/^\/api\/purchases\/(\d+)$/))) assertOwnOutlet('purchases', match[1]);
            if (req.method === 'PUT' && (match = url.pathname.match(/^\/api\/licenses\/(\d+)$/))) assertOwnOutlet('licenses', match[1]);
            if (req.method === 'DELETE' && (match = url.pathname.match(/^\/api\/shifts\/(\d+)$/))) assertOwnOutlet('shifts', match[1]);
            if (req.method === 'POST' && url.pathname === '/api/payroll/adjust') assertOwnOutlet('employees', body.employee_id);
            if (req.method === 'POST' && url.pathname === '/api/shifts') assertOwnOutlet('employees', body.employee_id);
            if (req.method === 'PUT' && (match = url.pathname.match(/^\/api\/operations\/tasks\/(\d+)$/))) assertOwnOutlet('operations_tasks', match[1]);
            if (req.method === 'PUT' && (match = url.pathname.match(/^\/api\/operations\/checklists\/(\d+)$/))) assertOwnOutlet('operations_checklists', match[1]);
            if (req.method === 'PUT' && (match = url.pathname.match(/^\/api\/operations\/production\/(\d+)$/))) assertOwnOutlet('production_plans', match[1]);
            if (req.method === 'PUT' && (match = url.pathname.match(/^\/api\/operations\/staff-meals\/(\d+)$/))) assertOwnOutlet('staff_meal_plans', match[1]);
            if (req.method === 'PUT' && /^\/api\/menu\/\d+$/.test(url.pathname)) throw new HttpError(403, 'Only administrators can change shared menu pricing');
          }
          const result = api.handle(req.method, url.pathname, query, body);
          if (user.role !== 'admin' && url.pathname === '/api/meta') result.outlets = result.outlets.filter((o) => o.id === user.outlet_id);
          res.writeHead(req.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(result));
        } catch (err) {
          const status = Number.isInteger(err.status) ? err.status : err instanceof SyntaxError ? 400 : 500;
          if (status === 500) console.error(err);
          res.writeHead(status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: status === 500 ? 'Internal error' : err.message }));
        }
      });
      return;
    }
    const file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : url.pathname));
    if (!file.startsWith(PUBLIC) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404); res.end('Not found'); return;
    }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, db })));
}

if (require.main === module) {
  start().then(({ server }) => console.log(`ResApp running at http://localhost:${server.address().port}`));
}

module.exports = { start };
