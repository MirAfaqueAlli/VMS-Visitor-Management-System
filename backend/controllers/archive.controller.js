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

    // For each FY, count live records (only if not yet purged)
    const result = await Promise.all(fys.map(async (fy) => {
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
        archive_id:      archive ? (existing.findIndex(e => e.financial_year === fy) >= 0
          ? existing.find(e => e.financial_year === fy) : null) : null,
      };
    }));

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

module.exports = { getStatus, runArchive, downloadArchive, purgeArchive };
