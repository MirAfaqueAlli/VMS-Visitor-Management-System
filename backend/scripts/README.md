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
   - `visitor_address`, `cross_unit_requester_id`, `requester_unit_id`, `reminder_sent_at` on `visit_requests`
   - `password_changed_at` on `users` (central and unit), `attempts` on OTP tables
   - Central tables `login_otp_sessions`, `password_reset_tokens`, `scheduled_job_runs`
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

---

## 📦 Yearly Backup & Archival (tender 1.1.10)

Only the current financial year (1 April – 31 March) stays in the live database.
After a financial year ends, run this **once**, from `backend/` on the server,
preferably outside office hours:

```bash
export ARCHIVE_PASSPHRASE='…'                                   # ≥ 16 chars; keep it safe

node scripts/fy_archive.js --fy 2025-26                         # 1. dry run — shows what would be archived
node scripts/fy_archive.js --fy 2025-26 --full-backup --purge --confirm
                                                                # 2. full backup → archive → remove from live DB
```

This writes to `backend/archives/FY2025-26/`:
- `full-backup-….sql.gz.enc` — encrypted `mysqldump` of every VMS database (needs the MySQL client tools on the server)
- `<database>.json.gz.enc` — that year's records per database (ID numbers already decrypted inside)
- `MANIFEST-….json` — files, SHA-256 checksums and record counts

Hand the files to OHPC, and send the passphrase separately. To open a file:
```bash
ARCHIVE_PASSPHRASE='…' node scripts/fy_archive_decrypt.js archives/FY2025-26/vms_unit_hq.json.gz.enc
```

Safety: the purge refuses the current or a future year, requires `--confirm` and a full backup
(`--full-backup`, or `--backup-taken` if you took one another way, e.g. an RDS snapshot), runs
per database in one transaction, and rolls back if anything doesn't match the archive.
Master data — users, departments, designations, visitors and the debarred list — is kept.
Gate-pass QR images and visitor photos in S3 are not deleted.
