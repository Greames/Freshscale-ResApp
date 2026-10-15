# Freshscale ResApp

Freshscale ResApp is an independent restaurant operations platform, built from a clean codebase and inspired by public restaurant ERP workflows such as Odoo. It does not reuse the old ResApp implementation or Odoo's source code, branding, or assets.

## Current build

- Restaurant overview and menu catalogue
- POS order creation for dine-in, takeaway, and delivery
- Kitchen ticket workflow: New → Preparing → Ready → Paid
- Recipe-based ingredient consumption when an order is created
- Transactional stock validation and rollback if an order needs more ingredients than are available
- Stock movement ledger with order-linked sale movements and cancellation reversals
- Ingredient inventory, low-stock alerts, and manual adjustments
- Purchase order creation and receiving, with receiving protected against duplicate stock additions
- Staff/shift overview, floor/table mock-up, reports and CSV export
- SQLite-backed API and responsive browser interface
- Basic automated API and interface tests plus a GitHub Actions workflow

## Run locally

Requires Node.js 22 or newer, with the built-in `node:sqlite` module.

```sh
npm start
npm test
```

Open http://localhost:3000. The default SQLite file is `data/freshscale.sqlite`; set `DB_PATH` to use a different file. For a clean in-memory database in tests, the API supports `:memory:`.

## API routes currently available

- `GET /api/health`
- `GET /api/state`
- `GET, POST /api/menu`
- `PATCH /api/menu/:id`
- `GET /api/inventory`
- `POST /api/inventory/:id/adjust`
- `GET, POST /api/orders`
- `PATCH /api/orders/:id/status`
- `GET, POST /api/purchases`
- `POST /api/purchases/:id/receive`

## Important limitations

This is an early prototype, not production-ready restaurant software. It currently has no authentication or server-side user/role/outlet isolation. Tax is deliberately not calculated because a production GST configuration must be designed and reviewed rather than guessed. Payment gateways, compliant invoice numbering, receipt printers, reservations, supplier integrations, full recipe editing, multi-outlet/franchise controls, backups and deployment hardening are not complete. Staff and floor/table state are still browser-local demo data.

Before using this for real restaurant transactions, implement and validate secure authentication, access controls, GST rules, payment reconciliation, idempotency keys for client retries, audit trails, migrations/backups, monitoring, and end-to-end tests.

## Roadmap

1. Secure authentication, roles, and outlet/franchise tenancy
2. Persist tables, staff, shifts, and operations tasks on the server
3. Configure recipes and inventory units with explicit conversions
4. GST-ready invoices, refunds, payment reconciliation and accounting exports
5. Kitchen display/printing, QR ordering, bookings and delivery integrations
6. Purchase approvals, wastage, stock counts and supplier price lists
7. Security review, backups, observability and production deployment
