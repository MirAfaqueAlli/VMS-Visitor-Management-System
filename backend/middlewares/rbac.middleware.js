// backend/middlewares/rbac.middleware.js
'use strict';

const { sendError } = require('../utils/response.util');

/**
 * authorize(...roles)
 * Checks that req.user.role_type is in the allowed list.
 * Must run after protect().
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return sendError(res, 'Authentication required. Please log in.', 401);
    if (!allowedRoles.includes(req.user.role_type)) {
      return sendError(res, `Access forbidden. Required role(s): ${allowedRoles.join(', ')}.`, 403);
    }
    next();
  };
};

/**
 * requireSameUnit
 * Scopes requests by unit_id.
 * super_admin and global_auditor bypass (unitScope = null → see all).
 * All unit-level roles are scoped to their own unit_id.
 */
const requireSameUnit = (req, res, next) => {
  if (!req.user) return sendError(res, 'Authentication required.', 401);
  if (isSuperAdmin(req.user) || isGlobalAuditor(req.user)) {
    req.unitScope = null;
  } else {
    req.unitScope = req.user.unit_id;
  }
  next();
};

/**
 * requireSameDept (kept for backward compatibility)
 * Scopes by department_id for dept-level operations.
 */
const requireSameDept = (req, res, next) => {
  if (!req.user) return sendError(res, 'Authentication required.', 401);
  if (isSuperAdmin(req.user) || isUnitAdmin(req.user) || isGlobalAuditor(req.user)) {
    req.deptScope = null;
  } else {
    req.deptScope = req.user.department_id;
  }
  next();
};

// ── Role boolean helpers (usable in controllers) ──────────────────────────────
const isSuperAdmin    = (user) => user?.role_type === 'super_admin';
const isUnitAdmin     = (user) => user?.role_type === 'unit_admin';
const isEmployee      = (user) => user?.role_type === 'employee';
const isSecurity      = (user) => user?.role_type === 'security';
const isReceptionist  = (user) => user?.role_type === 'receptionist';
const isGlobalAuditor = (user) => user?.role_type === 'global_auditor';
const isUnitAuditor   = (user) => user?.role_type === 'unit_auditor';
const isAnyAuditor    = (user) => isGlobalAuditor(user) || isUnitAuditor(user);
const isAnyAdmin      = (user) => isSuperAdmin(user) || isUnitAdmin(user);

// Keep old helpers for backward compat during migration
const isOrgAdmin = isSuperAdmin; // temporary alias

module.exports = {
  authorize,
  requireSameUnit,
  requireSameDept,
  isSuperAdmin,
  isUnitAdmin,
  isEmployee,
  isSecurity,
  isReceptionist,
  isGlobalAuditor,
  isUnitAuditor,
  isAnyAuditor,
  isAnyAdmin,
  isOrgAdmin, // backward compat alias
};
