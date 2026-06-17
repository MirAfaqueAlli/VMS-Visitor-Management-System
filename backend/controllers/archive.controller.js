// backend/controllers/archive.controller.js
'use strict';

const { sendSuccess, sendError } = require('../utils/response.util');
const { logAudit }               = require('../utils/auditLogger.util');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

// ── Financial year helpers ───────────────────────────────────────────────────
/**
 * Returns the current Indian financial year string, e.g. "2024-25"
 */
function currentFY() {
  const now   = new Date();
  const year  = now.getFullYear();
  const month = now.getMonth() + 1; // 1-based
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/**
 * Returns SQL date bounds for a FY string like "2024-25"
 * Indian FY: April 1 → March 31
 */
function fyBounds(fy) {
  const startYear = parseInt(fy.split('-')[0], 10);
  if (isNaN(startYear)) throw new Error(`Invalid FY format: ${fy}`);
  return {
    start: `${startYear}-04-01`,
    end:   `${startYear + 1}-03-31`,
  };
}

/**
 * Generates an array of completed FY strings up to and including last FY.
 * Never returns the current FY (can't archive an in-progress year).
 */
function completedFYs(yearsBack = 5) {
  const now  = new Date();
  const month = now.getMonth() + 1;
  const year  = now.getFullYear();
  const latestCompletedStart = month >= 4 ? year - 1 : year - 2;

  const fys = [];
  for (let i = 0; i < yearsBack; i++) {
    const s = latestCompletedStart - i;
    fys.push(`${s}-${String(s + 1).slice(-2)}`);
  }
  return fys;
}

// ── Ensure archive table exists ──────────────────────────────────────────────
async function ensureArchiveTable(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS financial_year_archives (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      financial_year   VARCHAR(20)  NOT NULL UNIQUE,
      total_records    INT          NOT NULL DEFAULT 0,
      archive_status   ENUM('PENDING','COMPLETED','PURGED') DEFAULT 'PENDING',
      backup_data      LONGTEXT     NULL,
      archived_by      INT          NULL,
      archived_at      TIMESTAMP    NULL,
      purged_at        TIMESTAMP    NULL,
      purged_by        INT          NULL,
      created_at       TIMESTAMP    DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// ── GET /api/archive/status ──────────────────────────────────────────────────
/**
 * Returns a list of completed FYs with their archival status.
 * Unit admins see their unit's status; super_admin passes unit_db via header.
 */
const getStatus = async (req, res) => {
  try {
    const db = req.db;
    await ensureArchiveTable(db);

    const fys = completedFYs(6);

    // Fetch existing archive records
    const [existing] = await db.query(
      `SELECT financial_year, total_records, archive_status, archived_at, purged_at, archived_by, purged_by
       FROM financial_year_archives ORDER BY financial_year DESC`
    );
    const existingMap = {};
    for (const row of existing) existingMap[row.financial_year] = row;

    // For each FY, count live records then filter out years with no data at all
    const all = await Promise.all(fys.map(async (fy) => {
      const { start, end } = fyBounds(fy);
      let liveCount = 0;
      try {
        const [[{ cnt }]] = await db.query(
          `SELECT COUNT(*) AS cnt FROM visit_requests WHERE visit_date BETWEEN ? AND ?`,
          [start, end]
        );
        liveCount = Number(cnt);
      } catch (_) {}

      const archive = existingMap[fy] || null;
      return {
        financial_year:  fy,
        fy_start:        start,
        fy_end:          end,
        live_records:    liveCount,
        archive_status:  archive?.archive_status  || 'NOT_STARTED',
        total_records:   archive?.total_records   || 0,
        archived_at:     archive?.archived_at     || null,
        purged_at:       archive?.purged_at       || null,
        archive_id:      archive ? (existing.find(e => e.financial_year === fy) ?? null) : null,
      };
    }));

    // Only surface FYs that actually have data — either live records exist OR
    // an archive record exists (COMPLETED / PURGED = was intentionally processed).
    const result = all.filter(item =>
      item.live_records > 0 || item.archive_status !== 'NOT_STARTED'
    );

    return sendSuccess(res, {
      current_fy: currentFY(),
      archives:   result,
    }, 'Archive status fetched.');
  } catch (err) {
    console.error('[ArchiveController] getStatus error:', err.message);
    return sendError(res, 'Failed to fetch archive status.', 500);
  }
};

// ── POST /api/archive/run ────────────────────────────────────────────────────
/**
 * Runs the archival process for a given financial year.
 * Reads all visit data for that FY, serialises to JSON, stores in DB.
 * Does NOT delete any records — that's a separate purge step.
 */
const runArchive = async (req, res) => {
  try {
    const { financial_year } = req.body;
    if (!financial_year) return sendError(res, 'financial_year is required.', 400);

    // Block archiving the current FY
    if (financial_year === currentFY()) {
      return sendError(res, 'Cannot archive the current financial year — it is still in progress.', 400);
    }

    const db = req.db;
    await ensureArchiveTable(db);

    // Check if already archived/purged
    const [[existing]] = await db.query(
      `SELECT id, archive_status FROM financial_year_archives WHERE financial_year = ? LIMIT 1`,
      [financial_year]
    );
    if (existing?.archive_status === 'PURGED') {
      return sendError(res, 'This financial year has already been purged.', 409);
    }
    if (existing?.archive_status === 'COMPLETED') {
      return sendError(res, 'This financial year is already archived. Download or purge it.', 409);
    }

    let { start, end } = fyBounds(financial_year);

    // ── Collect all relevant data ──────────────────────────────────────────
    const [[{ total }]] = await db.query(
      `SELECT COUNT(*) AS total FROM visit_requests WHERE visit_date BETWEEN ? AND ?`,
      [start, end]
    );
    const totalRecords = Number(total);

    if (totalRecords === 0) {
      // Still create an archive record so it shows up in status
      await db.query(
        `INSERT INTO financial_year_archives
           (financial_year, total_records, archive_status, archived_by, archived_at)
         VALUES (?, 0, 'COMPLETED', ?, NOW())
         ON DUPLICATE KEY UPDATE
           archive_status = 'COMPLETED', archived_by = VALUES(archived_by), archived_at = NOW()`,
        [financial_year, req.user.id]
      );
      return sendSuccess(res, { financial_year, total_records: 0 }, 'No records found for this FY. Archive marked complete.');
    }

    // Fetch visit requests
    const [visitRequests] = await db.query(
      `SELECT vr.*,
              h.full_name AS host_name, h.employee_code AS host_code,
              d.name AS department_name
       FROM visit_requests vr
       LEFT JOIN users       h ON h.id = vr.host_user_id
       LEFT JOIN departments d ON d.id = vr.department_id
       WHERE vr.visit_date BETWEEN ? AND ?
       ORDER BY vr.visit_date ASC`,
      [start, end]
    );

    const vrIds = visitRequests.map(r => r.id);
    let companions = [], approvalHistory = [], gatePasses = [], visitLogs = [];

    if (vrIds.length > 0) {
      const placeholders = vrIds.map(() => '?').join(',');

      [companions]      = await db.query(`SELECT * FROM request_companions   WHERE visit_request_id IN (${placeholders})`, vrIds);
      [approvalHistory] = await db.query(`SELECT ah.*, u.full_name AS acted_by_name FROM approval_history ah JOIN users u ON u.id = ah.acted_by_user_id WHERE ah.visit_request_id IN (${placeholders})`, vrIds);
      [gatePasses]      = await db.query(`SELECT gp.*, u.full_name AS issued_by_name FROM gate_passes gp LEFT JOIN users u ON u.id = gp.issued_by WHERE gp.visit_request_id IN (${placeholders})`, vrIds);

      const gpIds = gatePasses.map(g => g.id);
      if (gpIds.length > 0) {
        const gpPlaceholders = gpIds.map(() => '?').join(',');
        [visitLogs] = await db.query(
          `SELECT vl.*, ci.full_name AS checked_in_by_name, co.full_name AS checked_out_by_name
           FROM visit_logs vl
           LEFT JOIN users ci ON ci.id = vl.checked_in_by
           LEFT JOIN users co ON co.id = vl.checked_out_by
           WHERE vl.gate_pass_id IN (${gpPlaceholders})`,
          gpIds
        );
      }
    }

    // Build the backup payload
    const backupPayload = {
      financial_year,
      fy_start:       start,
      fy_end:         end,
      archived_at:    new Date().toISOString(),
      archived_by:    req.user.full_name,
      total_records:  totalRecords,
      visit_requests:  visitRequests,
      companions,
      approval_history: approvalHistory,
      gate_passes:     gatePasses,
      visit_logs:      visitLogs,
    };

    const backupJson = JSON.stringify(backupPayload);

    // Store in DB
    await db.query(
      `INSERT INTO financial_year_archives
         (financial_year, total_records, archive_status, backup_data, archived_by, archived_at)
       VALUES (?, ?, 'COMPLETED', ?, ?, NOW())
       ON DUPLICATE KEY UPDATE
         total_records = VALUES(total_records),
         archive_status = 'COMPLETED',
         backup_data    = VALUES(backup_data),
         archived_by    = VALUES(archived_by),
         archived_at    = NOW()`,
      [financial_year, totalRecords, backupJson, req.user.id]
    );

    await logAudit({
      db, userId: req.user.id,
      action: 'ARCHIVE_FY', module: 'ARCHIVE',
      recordType: 'FINANCIAL_YEAR_ARCHIVE',
      newValues: { financial_year, total_records: totalRecords },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, {
      financial_year,
      total_records: totalRecords,
      archive_status: 'COMPLETED',
    }, `Financial year ${financial_year} archived successfully — ${totalRecords} records backed up.`);
  } catch (err) {
    console.error('[ArchiveController] runArchive error:', err.message);
    return sendError(res, 'Archival failed: ' + err.message, 500);
  }
};

// ── GET /api/archive/:fy/download ────────────────────────────────────────────
/**
 * Streams the backup JSON for a completed archive as a downloadable file.
 */
const downloadArchive = async (req, res) => {
  try {
    const { fy } = req.params;
    const db = req.db;
    await ensureArchiveTable(db);

    const [[row]] = await db.query(
      `SELECT financial_year, total_records, archive_status, backup_data, archived_at
       FROM financial_year_archives WHERE financial_year = ? LIMIT 1`,
      [fy]
    );

    if (!row) return sendError(res, 'Archive not found for this financial year.', 404);
    if (row.archive_status === 'NOT_STARTED') return sendError(res, 'Archive has not been run yet.', 400);
    if (!row.backup_data) return sendError(res, 'No backup data available.', 404);

    const filename = `VMS_Archive_${fy.replace('-', '_')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(row.backup_data);
  } catch (err) {
    console.error('[ArchiveController] downloadArchive error:', err.message);
    return sendError(res, 'Failed to download archive.', 500);
  }
};

// ── DELETE /api/archive/:fy/purge ────────────────────────────────────────────
/**
 * Permanently deletes visit data for the given FY from the live DB.
 * Requires the archive to be COMPLETED first.
 * Sets archive_status to PURGED and clears backup_data from DB (already downloaded).
 */
const purgeArchive = async (req, res) => {
  try {
    const { fy } = req.params;
    const db = req.db;
    await ensureArchiveTable(db);

    const [[row]] = await db.query(
      `SELECT id, financial_year, archive_status FROM financial_year_archives WHERE financial_year = ? LIMIT 1`,
      [fy]
    );

    if (!row)                               return sendError(res, 'Archive not found. Run archival first.', 404);
    if (row.archive_status !== 'COMPLETED') return sendError(res, 'Archive must be COMPLETED before purging.', 400);

    const { start, end } = fyBounds(fy);

    // Get IDs to delete in order (dependencies first)
    const [vrRows] = await db.query(
      `SELECT id FROM visit_requests WHERE visit_date BETWEEN ? AND ?`,
      [start, end]
    );
    const vrIds = vrRows.map(r => r.id);

    let purgedCount = 0;
    if (vrIds.length > 0) {
      const placeholders = vrIds.map(() => '?').join(',');

      // Get gate pass IDs first
      const [gpRows] = await db.query(
        `SELECT id FROM gate_passes WHERE visit_request_id IN (${placeholders})`, vrIds
      );
      const gpIds = gpRows.map(g => g.id);

      const conn = await db.getConnection();
      await conn.beginTransaction();
      try {
        // Delete in dependency order
        if (gpIds.length > 0) {
          const gpPlaceholders = gpIds.map(() => '?').join(',');
          await conn.query(`DELETE FROM visit_logs        WHERE gate_pass_id        IN (${gpPlaceholders})`, gpIds);
          await conn.query(`DELETE FROM gate_passes       WHERE id                  IN (${gpPlaceholders})`, gpIds);
        }
        await conn.query(`DELETE FROM approval_history  WHERE visit_request_id    IN (${placeholders})`, vrIds);
        await conn.query(`DELETE FROM request_companions WHERE visit_request_id    IN (${placeholders})`, vrIds);
        await conn.query(`DELETE FROM notifications      WHERE visit_request_id    IN (${placeholders})`, vrIds);
        await conn.query(`DELETE FROM visit_requests     WHERE id                  IN (${placeholders})`, vrIds);

        purgedCount = vrIds.length;

        // Mark archive as PURGED and clear the heavy backup_data blob
        await conn.query(
          `UPDATE financial_year_archives
           SET archive_status = 'PURGED', purged_by = ?, purged_at = NOW(), backup_data = NULL
           WHERE financial_year = ?`,
          [req.user.id, fy]
        );

        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        conn.release();
        throw txErr;
      }
      conn.release();
    } else {
      await db.query(
        `UPDATE financial_year_archives SET archive_status = 'PURGED', purged_by = ?, purged_at = NOW() WHERE financial_year = ?`,
        [req.user.id, fy]
      );
    }

    await logAudit({
      db, userId: req.user.id,
      action: 'PURGE_FY', module: 'ARCHIVE',
      recordType: 'FINANCIAL_YEAR_ARCHIVE',
      newValues: { financial_year: fy, purged_records: purgedCount },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { financial_year: fy, purged_records: purgedCount }, `${purgedCount} records for FY ${fy} permanently purged from live database.`);
  } catch (err) {
    console.error('[ArchiveController] purgeArchive error:', err.message);
    return sendError(res, 'Purge failed: ' + err.message, 500);
  }
};

module.exports = { getStatus, runArchive, downloadArchive, purgeArchive, getGlobalStatus, runGlobalArchive, downloadGlobalArchive, purgeGlobalArchive };

// ── GLOBAL (Super-Admin) Archive Endpoints ────────────────────────────────────
// These fan-out to EVERY active unit's DB and aggregate data year-wise.

/**
 * GET /api/archive/global
 * Returns per-FY stats aggregated across ALL unit DBs.
 * Response: { current_fy, fys: [{ financial_year, units: [{ unit_id, unit_name, unit_code, live_records, archive_status, ... }], total_live, total_archived }] }
 */
async function getGlobalStatus(req, res) {
  try {
    const { centralPool, getPool } = require('../services/dbManager');

    // 1. Get all active units
    const [units] = await centralPool.query(
      `SELECT id, name, code, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE' ORDER BY name`
    );

    if (units.length === 0) {
      return sendSuccess(res, { current_fy: currentFY(), fys: [] }, 'No active units found.');
    }

    const fys = completedFYs(6);

    // 2. For each unit, query its DB in parallel
    const unitResults = await Promise.all(units.map(async (unit) => {
      try {
        const db = getPool(unit.db_name);
        await ensureArchiveTable(db);

        const [existing] = await db.query(
          `SELECT financial_year, total_records, archive_status, archived_at, purged_at
           FROM financial_year_archives ORDER BY financial_year DESC`
        );
        const existingMap = {};
        for (const row of existing) existingMap[row.financial_year] = row;

        const fyData = await Promise.all(fys.map(async (fy) => {
          const { start, end } = fyBounds(fy);
          let liveCount = 0;
          try {
            const [[{ cnt }]] = await db.query(
              `SELECT COUNT(*) AS cnt FROM visit_requests WHERE visit_date BETWEEN ? AND ?`,
              [start, end]
            );
            liveCount = Number(cnt);
          } catch (_) {}

          const arch = existingMap[fy] || null;
          return {
            financial_year: fy,
            live_records:   liveCount,
            archive_status: arch?.archive_status || 'NOT_STARTED',
            total_records:  arch?.total_records  || 0,
            archived_at:    arch?.archived_at    || null,
            purged_at:      arch?.purged_at      || null,
          };
        }));

        return { unit_id: unit.id, unit_name: unit.name, unit_code: unit.code, db_name: unit.db_name, fys: fyData };
      } catch (unitErr) {
        // Unit DB unreachable — return placeholder
        return {
          unit_id: unit.id, unit_name: unit.name, unit_code: unit.code, db_name: unit.db_name,
          fys: fys.map(fy => ({ financial_year: fy, live_records: 0, archive_status: 'UNAVAILABLE', total_records: 0, archived_at: null, purged_at: null })),
          error: unitErr.message,
        };
      }
    }));

    // 3. Pivot: group by FY, collect per-unit info
    const fyMap = {};
    for (const fy of fys) {
      fyMap[fy] = { financial_year: fy, fy_start: fyBounds(fy).start, fy_end: fyBounds(fy).end, units: [], total_live: 0, total_archived: 0 };
    }

    for (const unitResult of unitResults) {
      for (const fyRow of unitResult.fys) {
        const slot = fyMap[fyRow.financial_year];
        if (!slot) continue;
        slot.units.push({
          unit_id:        unitResult.unit_id,
          unit_name:      unitResult.unit_name,
          unit_code:      unitResult.unit_code,
          db_name:        unitResult.db_name,
          live_records:   fyRow.live_records,
          archive_status: fyRow.archive_status,
          total_records:  fyRow.total_records,
          archived_at:    fyRow.archived_at,
          purged_at:      fyRow.purged_at,
          error:          unitResult.error || null,
        });
        slot.total_live     += fyRow.live_records;
        slot.total_archived += fyRow.total_records;
      }
    }

    // 4. Only show FYs that have any data across any unit
    const result = Object.values(fyMap).filter(fy =>
      fy.total_live > 0 || fy.units.some(u => u.archive_status !== 'NOT_STARTED' && u.archive_status !== 'UNAVAILABLE')
    );

    return sendSuccess(res, { current_fy: currentFY(), fys: result }, 'Global archive status fetched.');
  } catch (err) {
    console.error('[ArchiveController] getGlobalStatus error:', err.message);
    return sendError(res, 'Failed to fetch global archive status.', 500);
  }
}

/**
 * POST /api/archive/global/run
 * Body: { financial_year, unit_ids?: [1,2,3] }  (omit unit_ids to archive ALL units)
 * Archives the given FY for every specified unit (or all) in parallel.
 */
async function runGlobalArchive(req, res) {
  try {
    const { financial_year, unit_ids } = req.body;
    if (!financial_year) return sendError(res, 'financial_year is required.', 400);
    if (financial_year === currentFY()) return sendError(res, 'Cannot archive the current financial year.', 400);

    const { centralPool, getPool } = require('../services/dbManager');

    let unitQuery = `SELECT id, name, code, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`;
    let unitParams = [];
    if (Array.isArray(unit_ids) && unit_ids.length > 0) {
      unitQuery += ` AND id IN (${unit_ids.map(() => '?').join(',')})`;
      unitParams = unit_ids;
    }
    const [units] = await centralPool.query(unitQuery, unitParams);

    // Run archive for each unit in parallel using the existing runArchive logic
    const results = await Promise.all(units.map(async (unit) => {
      try {
        const db = getPool(unit.db_name);
        await ensureArchiveTable(db);

        const [[existing]] = await db.query(
          `SELECT id, archive_status FROM financial_year_archives WHERE financial_year = ? LIMIT 1`,
          [financial_year]
        );
        if (existing?.archive_status === 'PURGED')    return { unit_id: unit.id, unit_name: unit.name, status: 'SKIPPED', reason: 'Already purged' };
        if (existing?.archive_status === 'COMPLETED') return { unit_id: unit.id, unit_name: unit.name, status: 'SKIPPED', reason: 'Already archived' };

        const { start, end } = fyBounds(financial_year);
        const [[{ total }]] = await db.query(
          `SELECT COUNT(*) AS total FROM visit_requests WHERE visit_date BETWEEN ? AND ?`, [start, end]
        );
        const totalRecords = Number(total);

        if (totalRecords === 0) {
          await db.query(
            `INSERT INTO financial_year_archives (financial_year, total_records, archive_status, archived_by, archived_at)
             VALUES (?, 0, 'COMPLETED', ?, NOW())
             ON DUPLICATE KEY UPDATE archive_status='COMPLETED', archived_by=VALUES(archived_by), archived_at=NOW()`,
            [financial_year, req.user.id]
          );
          return { unit_id: unit.id, unit_name: unit.name, status: 'COMPLETED', total_records: 0 };
        }

        const [visitRequests] = await db.query(
          `SELECT vr.*, h.full_name AS host_name, d.name AS department_name
           FROM visit_requests vr
           LEFT JOIN users h       ON h.id = vr.host_user_id
           LEFT JOIN departments d ON d.id = vr.department_id
           WHERE vr.visit_date BETWEEN ? AND ? ORDER BY vr.visit_date ASC`,
          [start, end]
        );
        const vrIds = visitRequests.map(r => r.id);
        let companions = [], approvalHistory = [], gatePasses = [], visitLogs = [];
        if (vrIds.length > 0) {
          const ph = vrIds.map(() => '?').join(',');
          [companions]      = await db.query(`SELECT * FROM request_companions WHERE visit_request_id IN (${ph})`, vrIds);
          [approvalHistory] = await db.query(`SELECT ah.*, u.full_name AS acted_by_name FROM approval_history ah JOIN users u ON u.id = ah.acted_by_user_id WHERE ah.visit_request_id IN (${ph})`, vrIds);
          [gatePasses]      = await db.query(`SELECT * FROM gate_passes WHERE visit_request_id IN (${ph})`, vrIds);
          const gpIds = gatePasses.map(g => g.id);
          if (gpIds.length > 0) {
            const gph = gpIds.map(() => '?').join(',');
            [visitLogs] = await db.query(`SELECT * FROM visit_logs WHERE gate_pass_id IN (${gph})`, gpIds);
          }
        }

        const backupPayload = {
          unit_id: unit.id, unit_name: unit.name, unit_code: unit.code,
          financial_year, fy_start: start, fy_end: end,
          archived_at: new Date().toISOString(), archived_by: req.user.full_name,
          total_records: totalRecords,
          visit_requests: visitRequests, companions, approval_history: approvalHistory,
          gate_passes: gatePasses, visit_logs: visitLogs,
        };

        await db.query(
          `INSERT INTO financial_year_archives (financial_year, total_records, archive_status, backup_data, archived_by, archived_at)
           VALUES (?, ?, 'COMPLETED', ?, ?, NOW())
           ON DUPLICATE KEY UPDATE total_records=VALUES(total_records), archive_status='COMPLETED', backup_data=VALUES(backup_data), archived_by=VALUES(archived_by), archived_at=NOW()`,
          [financial_year, totalRecords, JSON.stringify(backupPayload), req.user.id]
        );

        return { unit_id: unit.id, unit_name: unit.name, status: 'COMPLETED', total_records: totalRecords };
      } catch (unitErr) {
        return { unit_id: unit.id, unit_name: unit.name, status: 'ERROR', reason: unitErr.message };
      }
    }));

    const succeeded = results.filter(r => r.status === 'COMPLETED').length;
    const skipped   = results.filter(r => r.status === 'SKIPPED').length;
    const failed    = results.filter(r => r.status === 'ERROR').length;

    await logAudit({
      db: req.db, userId: req.user.id,
      action: 'GLOBAL_ARCHIVE_FY', module: 'ARCHIVE',
      recordType: 'FINANCIAL_YEAR_ARCHIVE',
      newValues: { financial_year, succeeded, skipped, failed },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { financial_year, results, succeeded, skipped, failed },
      `Global archive complete: ${succeeded} archived, ${skipped} skipped, ${failed} failed.`);
  } catch (err) {
    console.error('[ArchiveController] runGlobalArchive error:', err.message);
    return sendError(res, 'Global archive failed: ' + err.message, 500);
  }
}

/**
 * GET /api/archive/global/:fy/download
 * Downloads a combined JSON with all units' backup data for the given FY.
 */
async function downloadGlobalArchive(req, res) {
  try {
    const { fy } = req.params;
    const { centralPool, getPool } = require('../services/dbManager');
    const [units] = await centralPool.query(
      `SELECT id, name, code, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE' ORDER BY name`
    );

    const combined = { financial_year: fy, exported_at: new Date().toISOString(), units: [] };

    for (const unit of units) {
      try {
        const db = getPool(unit.db_name);
        const [[row]] = await db.query(
          `SELECT financial_year, total_records, archive_status, backup_data, archived_at
           FROM financial_year_archives WHERE financial_year = ? LIMIT 1`, [fy]
        );
        if (row && row.backup_data) {
          combined.units.push({ unit_id: unit.id, unit_name: unit.name, unit_code: unit.code, ...JSON.parse(row.backup_data) });
        } else {
          combined.units.push({ unit_id: unit.id, unit_name: unit.name, unit_code: unit.code, archive_status: row?.archive_status || 'NOT_STARTED', note: 'No backup data available' });
        }
      } catch (_) {
        combined.units.push({ unit_id: unit.id, unit_name: unit.name, unit_code: unit.code, note: 'Unit DB unavailable' });
      }
    }

    const filename = `VMS_Global_Archive_${fy.replace('-', '_')}.json`;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.send(JSON.stringify(combined, null, 2));
  } catch (err) {
    console.error('[ArchiveController] downloadGlobalArchive error:', err.message);
    return sendError(res, 'Global download failed.', 500);
  }
}

/**
 * DELETE /api/archive/global/:fy/purge
 * Body: { unit_ids?: [1,2,3] }  (omit to purge ALL units)
 * Purges a FY from the specified unit DBs. Requires COMPLETED status on each.
 */
async function purgeGlobalArchive(req, res) {
  try {
    const { fy } = req.params;
    const { unit_ids } = req.body || {};
    const { centralPool, getPool } = require('../services/dbManager');

    let unitQuery = `SELECT id, name, code, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'`;
    let unitParams = [];
    if (Array.isArray(unit_ids) && unit_ids.length > 0) {
      unitQuery += ` AND id IN (${unit_ids.map(() => '?').join(',')})`;
      unitParams = unit_ids;
    }
    const [units] = await centralPool.query(unitQuery, unitParams);

    const results = await Promise.all(units.map(async (unit) => {
      try {
        const db = getPool(unit.db_name);
        await ensureArchiveTable(db);
        const [[row]] = await db.query(
          `SELECT id, archive_status FROM financial_year_archives WHERE financial_year = ? LIMIT 1`, [fy]
        );
        if (!row)                               return { unit_id: unit.id, unit_name: unit.name, status: 'SKIPPED', reason: 'Not archived yet' };
        if (row.archive_status !== 'COMPLETED') return { unit_id: unit.id, unit_name: unit.name, status: 'SKIPPED', reason: `Status is ${row.archive_status}` };

        const { start, end } = fyBounds(fy);
        const [vrRows] = await db.query(`SELECT id FROM visit_requests WHERE visit_date BETWEEN ? AND ?`, [start, end]);
        const vrIds = vrRows.map(r => r.id);
        let purgedCount = 0;

        if (vrIds.length > 0) {
          const ph = vrIds.map(() => '?').join(',');
          const [gpRows] = await db.query(`SELECT id FROM gate_passes WHERE visit_request_id IN (${ph})`, vrIds);
          const gpIds = gpRows.map(g => g.id);
          const conn = await db.getConnection();
          await conn.beginTransaction();
          try {
            if (gpIds.length > 0) {
              const gph = gpIds.map(() => '?').join(',');
              await conn.query(`DELETE FROM visit_logs   WHERE gate_pass_id     IN (${gph})`, gpIds);
              await conn.query(`DELETE FROM gate_passes  WHERE id               IN (${gph})`, gpIds);
            }
            await conn.query(`DELETE FROM approval_history  WHERE visit_request_id IN (${ph})`, vrIds);
            await conn.query(`DELETE FROM request_companions WHERE visit_request_id IN (${ph})`, vrIds);
            await conn.query(`DELETE FROM notifications      WHERE visit_request_id IN (${ph})`, vrIds);
            await conn.query(`DELETE FROM visit_requests     WHERE id               IN (${ph})`, vrIds);
            await conn.query(
              `UPDATE financial_year_archives SET archive_status='PURGED', purged_by=?, purged_at=NOW(), backup_data=NULL WHERE financial_year=?`,
              [req.user.id, fy]
            );
            purgedCount = vrIds.length;
            await conn.commit();
          } catch (txErr) { await conn.rollback(); conn.release(); throw txErr; }
          conn.release();
        } else {
          await db.query(
            `UPDATE financial_year_archives SET archive_status='PURGED', purged_by=?, purged_at=NOW() WHERE financial_year=?`,
            [req.user.id, fy]
          );
        }

        return { unit_id: unit.id, unit_name: unit.name, status: 'PURGED', purged_records: purgedCount };
      } catch (unitErr) {
        return { unit_id: unit.id, unit_name: unit.name, status: 'ERROR', reason: unitErr.message };
      }
    }));

    const purged = results.filter(r => r.status === 'PURGED').length;
    const skipped = results.filter(r => r.status === 'SKIPPED').length;
    const failed  = results.filter(r => r.status === 'ERROR').length;

    await logAudit({
      db: req.db, userId: req.user.id,
      action: 'GLOBAL_PURGE_FY', module: 'ARCHIVE',
      recordType: 'FINANCIAL_YEAR_ARCHIVE',
      newValues: { fy, purged, skipped, failed },
      ipAddress: req.ip, userAgent: req.headers['user-agent'],
    });

    return sendSuccess(res, { financial_year: fy, results, purged, skipped, failed },
      `Global purge complete: ${purged} units purged, ${skipped} skipped, ${failed} failed.`);
  } catch (err) {
    console.error('[ArchiveController] purgeGlobalArchive error:', err.message);
    return sendError(res, 'Global purge failed: ' + err.message, 500);
  }
}
