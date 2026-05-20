// backend/middlewares/validate.middleware.js
'use strict';

const { sendError } = require('../utils/response.util');

/**
 * Middleware factory — validate
 *
 * Accepts a Zod schema, validates req.body against it using .safeParse(), and:
 *   • On failure → 422 with a structured list of field-level errors.
 *   • On success → replaces req.body with the parsed/sanitized data and calls next().
 *
 * Compatible with Zod v3 and v4 (handles both .errors and .issues shapes).
 *
 * Usage:
 *   router.post('/login', validate(loginSchema), authController.login);
 *
 * @param {import('zod').ZodTypeAny} schema - A Zod schema to validate req.body against.
 * @returns {import('express').RequestHandler}
 */
const validate = (schema) => {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      // Zod v4 uses `.error.issues`; v3 uses `.error.errors` — support both.
      const issues = result.error.issues ?? result.error.errors ?? [];

      const errors = issues.map((issue) => ({
        field: issue.path.join('.') || 'body',
        message: issue.message,
      }));

      return sendError(res, 'Validation failed', 422, errors);
    }

    // Replace req.body with the Zod-parsed (coerced + stripped) data
    req.body = result.data;
    next();
  };
};

module.exports = { validate };
