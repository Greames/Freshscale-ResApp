# Freshscale ResApp

Freshscale ResApp is an India-focused restaurant ERP for POS, kitchen operations, menu and recipe costing, inventory, purchasing, workforce, finance, GST compliance, and multi-outlet/franchise management.

This repository is an independent product codebase based on the existing ResApp foundation. The original `Greames/rasoinet` repository will remain unchanged.

## Technology
- Node.js 22.13+
- Built-in `node:sqlite`
- No external runtime dependencies

## Run locally
```bash
npm start
npm test
```

## Product roadmap
1. POS order lifecycle and kitchen workflow
2. Recipe-based inventory consumption with idempotent stock movements
3. Table management, modifiers, combos, refunds and payment reconciliation
4. Purchasing, workforce and multi-outlet reporting
5. Security, tests and independent deployment configuration

Tax and statutory calculations must be reviewed by a qualified professional before production use.
