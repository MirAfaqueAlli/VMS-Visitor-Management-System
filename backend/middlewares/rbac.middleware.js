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
    if (!req.user) {
      return sendError(res, 'Authentication required. Please log in.', 401);
    }
    if (!allowedRoles.includes(req.user.role_type)) {
      return sendError(
        res,
        `Access forbidden. Required role(s): ${allowedRoles.join(', ')}.`,
        403
      );
    }
    next();
  };
};

/**
 * requireSameDept
 * Enforces department-level data isolation.
 * - org_admin → bypasses (no filter applied)
 * - all others → req.deptScope is set to req.user.department_id
 *
 * Controllers check req.deptScope to conditionally add WHERE department_id = ?
 */
const requireSameDept = (req, res, next) => {
  if (!req.user) {
    return sendError(res, 'Authentication required.', 401);
  }
  if (req.user.role_type === 'org_admin') {
    req.deptScope = null; // no filter — sees everything
  } else {
    req.deptScope = req.user.department_id;
  }
  next();
};

/**
 * isOrgAdmin — simple boolean helper usable in controllers
 */
const isOrgAdmin = (user) => user && user.role_type === 'org_admin';

/**
 * isDeptAdmin — simple boolean helper usable in controllers
 */
const isDeptAdmin = (user) => user && user.role_type === 'dept_admin';

module.exports = { authorize, requireSameDept, isOrgAdmin, isDeptAdmin };
