// backend/services/adminProfile.service.js
// A super admin is a central user. When they join a unit they get a non-login
// employee profile inside that unit. These helpers map the central login to that
// unit profile so the super admin can act exactly like an employee there.
'use strict';

const { queryAllUnits } = require('./dbManager');

/** The super admin's active unit employee profile (one at a time), or null. */
async function findSuperAdminProfile(centralUserId) {
  if (!centralUserId) return null;
  const results = await queryAllUnits(
    `SELECT id, unit_id, department_id
     FROM users
     WHERE admin_central_user_id = ? AND is_admin_profile = 1
       AND deleted_at IS NULL AND is_active = 1
     LIMIT 1`,
    [centralUserId]
  );
  const hit = results.find(r => r.rows.length > 0);
  if (!hit) return null;
  return { ...hit.rows[0], unit_db: hit.unit_db, unit_name: hit.unit_name };
}

/**
 * The id a controller should use when acting inside a unit DB.
 * Unit users act as themselves; a super admin acts as their unit employee profile
 * (null when they have not joined this unit).
 */
async function unitActorId(db, user) {
  if (!user) return null;
  if (user.role_type !== 'super_admin') return user.id;
  try {
    const [rows] = await db.query(
      `SELECT id FROM users
       WHERE admin_central_user_id = ? AND is_admin_profile = 1
         AND deleted_at IS NULL AND is_active = 1
       LIMIT 1`,
      [user.id]
    );
    return rows[0]?.id || null;
  } catch {
    return null;
  }
}

module.exports = { findSuperAdminProfile, unitActorId };
