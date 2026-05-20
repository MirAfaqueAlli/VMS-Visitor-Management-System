
'use strict';

/**
 * Send a standardized success response.
 * @param {import('express').Response} res
 * @param {*} data - Payload to send in the `data` field.
 * @param {string} [message='Success'] - Human-readable success message.
 * @param {number} [statusCode=200] - HTTP status code.
 */
const sendSuccess = (res, data = null, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

/**
 * Send a standardized error response.
 * @param {import('express').Response} res
 * @param {string} [message='An unexpected error occurred'] - Human-readable error message.
 * @param {number} [statusCode=500] - HTTP status code.
 * @param {Array|null} [errors=null] - Optional array of granular error details.
 */
const sendError = (res, message = 'An unexpected error occurred', statusCode = 500, errors = null) => {
  const body = {
    success: false,
    message,
  };
  if (errors !== null) {
    body.errors = errors;
  }
  return res.status(statusCode).json(body);
};

module.exports = { sendSuccess, sendError };
