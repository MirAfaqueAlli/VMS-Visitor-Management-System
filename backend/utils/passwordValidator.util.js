// backend/utils/passwordValidator.util.js
'use strict';

/**
 * Standard password policy enforced across the entire VMS system.
 *
 * Rules:
 *   - Minimum 8 characters
 *   - At least 1 uppercase letter (A-Z)
 *   - At least 1 lowercase letter (a-z)
 *   - At least 1 digit (0-9)
 *   - At least 1 special character (!@#$%^&*()_+-=[]{}|;:'",.<>?/`~)
 */

const PASSWORD_RULES = [
  { test: (p) => p.length >= 8,        message: 'Password must be at least 8 characters long.' },
  { test: (p) => /[A-Z]/.test(p),      message: 'Password must contain at least one uppercase letter.' },
  { test: (p) => /[a-z]/.test(p),      message: 'Password must contain at least one lowercase letter.' },
  { test: (p) => /[0-9]/.test(p),      message: 'Password must contain at least one digit.' },
  { test: (p) => /[^A-Za-z0-9]/.test(p), message: 'Password must contain at least one special character (e.g. @#$%!&*).' },
];

/**
 * Validate a password against all rules.
 * @param {string} password
 * @returns {{ valid: boolean, errors: string[] }}
 */
function validatePassword(password) {
  if (!password) return { valid: false, errors: ['Password is required.'] };

  const errors = PASSWORD_RULES
    .filter((rule) => !rule.test(password))
    .map((rule) => rule.message);

  return { valid: errors.length === 0, errors };
}

module.exports = { validatePassword, PASSWORD_RULES };
