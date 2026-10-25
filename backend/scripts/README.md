# Backend Scripts & Auto-Migrations

> **Note:** Manual execution of patches and seeders is **no longer required**!  
> The backend server automatically connects, checks schemas, runs pending migrations, and verifies all seed data on startup (`server.js`).

---

## 🚀 Automated Startup Migrations

When you run `npm run dev` or `node server.js`, the server automatically:
1. Creates `vms_central` if it does not exist.
2. Applies `vms_central_schema.sql` and verifies the 7 system roles and 7 visitor types are seeded.
3. Discovers all existing unit databases (`vms_unit_*`).
4. Applies any pending table/column migrations:
   - `host_phone_blacklist` table
   - `service_type` & `work_order_ref` columns
   - `request_source` with `PUBLIC` ENUM
   - `checkout_method`, `qr_expires_at`, `updated_at` columns
   - Drops cross-database FK constraints on `requester_user_id` and `acted_by_user_id`
5. Automatically runs migrations whenever a new unit is provisioned via the UI.

---

## 🛠️ Optional Maintenance Scripts

### `reset.js` / `scripts/reset_db.js` — Full DB Reset
Drops all unit databases and recreates a clean `vms_central` database (only use if you explicitly want to wipe all data):
```bash
node scripts/reset_db.js
```

### `scripts/seed_unit.js` — Seed Demo Unit
Optional dev utility to seed a demo branch unit with a mock user.
```bash
node scripts/seed_unit.js --code=BR01 --name="Branch Office" --city="Delhi"
```
