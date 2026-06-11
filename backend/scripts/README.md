# Backend Scripts

Utility scripts for database management. Run from the `backend/` directory.

---

## `reset.js` — Full DB Reset

Drops all `vms_unit_*` databases and truncates the central DB tables.  
Use this to wipe all data and start fresh (first-time setup).

```bash
node reset.js
```

> ⚠️ **Destructive — all unit and central data is permanently deleted.**

---

## `scripts/reset_db.js` — Advanced Reset

Extended reset with additional options. Check the file header for flags.

```bash
node scripts/reset_db.js
```

---

## `scripts/seed_unit.js` — Seed a Unit

Seeds a unit database with sample data for testing.

```bash
node scripts/seed_unit.js
```

---

## `scripts/patch_gate_passes.js` — Gate Pass Migration

One-time patch to backfill gate pass records. Run only if migrating from an older schema version.

```bash
node scripts/patch_gate_passes.js
```

---

## `scripts/patch_request_source.js` — Request Source Migration

One-time patch to backfill `request_source` on existing visit_requests rows.

```bash
node scripts/patch_request_source.js
```
