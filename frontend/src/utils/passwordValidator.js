// frontend/src/utils/passwordValidator.js

/**
 * Standard password policy — mirrors backend/utils/passwordValidator.util.js
 *
 * Rules:
 *   - Minimum 8 characters
 *   - At least 1 uppercase letter (A-Z)
 *   - At least 1 lowercase letter (a-z)
 *   - At least 1 digit (0-9)
 *   - At least 1 special character
 */

export const PASSWORD_RULES = [
  { key: 'length',    label: 'At least 8 characters',        test: (p) => p.length >= 8 },
  { key: 'uppercase', label: 'One uppercase letter (A-Z)',    test: (p) => /[A-Z]/.test(p) },
  { key: 'lowercase', label: 'One lowercase letter (a-z)',    test: (p) => /[a-z]/.test(p) },
  { key: 'digit',     label: 'One digit (0-9)',               test: (p) => /[0-9]/.test(p) },
  { key: 'special',   label: 'One special character (!@#$%)', test: (p) => /[^A-Za-z0-9]/.test(p) },
];

/**
 * @param {string} password
 * @returns {{ valid: boolean, results: { key: string, label: string, passed: boolean }[] }}
 */
export function validatePassword(password = '') {
  const results = PASSWORD_RULES.map((rule) => ({
    key:    rule.key,
    label:  rule.label,
    passed: rule.test(password),
  }));
  return { valid: results.every((r) => r.passed), results };
}

/**
 * Returns 0-5 strength score.
 */
export function getPasswordStrength(password = '') {
  return PASSWORD_RULES.filter((r) => r.test(password)).length;
}
