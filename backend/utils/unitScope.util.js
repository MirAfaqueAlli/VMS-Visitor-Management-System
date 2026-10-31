// backend/utils/unitScope.util.js
'use strict';

/**
 * Which unit a request is acting for, and whether the caller administers it.
 * Shared by controllers that let a unit see records stored in another unit's DB
 * (cross-unit EMPLOYEE_VISITs live in the host unit's database).
 */

const { centralPool } = require('../services/dbManager');
const { isSuperAdmin, isUnitAdmin } = require('../middlewares/rbac.middleware');

/**
 * The unit the caller works in: their own unit, or — for a super admin managing a
 * unit (X-Unit-Db / X-Unit-Id) — that unit. null for central users not managing one.
 */
const ownUnitId = async (req) => {
  if (req.user?.unit_id) return Number(req.user.unit_id);
  if (req.unitDbName) {
    const [rows] = await centralPool.query('SELECT id FROM units WHERE db_name = ? LIMIT 1', [req.unitDbName]);
    return rows.length ? Number(rows[0].id) : null;
  }
  return null;
};

/** Unit admins (and super admins managing a unit) see every request raised from their unit. */
const isUnitLevelAdmin = (req) => isUnitAdmin(req.user) || (isSuperAdmin(req.user) && !!req.unitDbName);

module.exports = { ownUnitId, isUnitLevelAdmin };
