# Freshscale ResApp

A clean-build restaurant operations workspace inspired by restaurant ERP workflows, including Odoo's public restaurant feature set. This repository is independent: no existing ResApp source was carried forward.

## Prototype scope
- POS for dine-in, takeaway, and delivery
- Table map and occupancy
- Kitchen preparation queue
- Menu catalogue and recipe-aware stock planning
- Inventory and low-stock alerts
- Purchasing, people/shift overview, and sales reports

## Run
Requires Node.js 22+.

```sh
npm start
npm test
```

Open http://localhost:3000.

## Important
This is an interactive browser prototype using demo data in localStorage. It is not production-ready. Server-side persistence, authentication, role/outlet isolation, real payments, GST-compliant invoicing, printer integrations, recipe stock ledger, supplier receiving, and automated end-to-end tests remain to be built and validated before real use.

## Product roadmap
1. API + relational database and migrations
2. Authentication, roles, and outlet/franchise tenancy
3. Transaction-safe orders, payments, and idempotent ingredient deductions
4. Stock counts, wastage, purchase receiving, and supplier price lists
5. GST invoices, settlement reconciliation, and accounting exports
6. Kitchen display/printers, QR ordering, bookings, and delivery integrations
7. Workforce roster, attendance, leave, checklists, and task automation
8. Monitoring, backups, security testing, and deployment hardening
