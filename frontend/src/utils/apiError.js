// frontend/src/utils/apiError.js
'use strict';

/**
 * Extract detailed human-readable error message(s) from an Axios API error object.
 *
 * If the backend returned granular Zod field validation errors in `err.response.data.errors`,
 * formats them cleanly with field names (e.g. "Email: Invalid email address format.").
 *
 * @param {object} err - Axios error object
 * @param {string} [fallbackMsg='An unexpected error occurred.'] - Fallback error message
 * @returns {string} Formatted error string for toast notification
 */
export function getApiErrorMessage(err, fallbackMsg = 'An unexpected error occurred.') {
  if (!err?.response?.data) {
    return err?.message || fallbackMsg;
  }

  const { message, errors } = err.response.data;

  // Handle structured Zod validation errors array
  if (Array.isArray(errors) && errors.length > 0) {
    const details = errors.map((e) => {
      if (e.field && e.field !== 'body') {
        const formattedField = e.field
          .split('.')
          .map((part) => part.replace(/_/g, ' '))
          .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
          .join(' ');
        return `${formattedField}: ${e.message}`;
      }
      return e.message;
    });

    if (details.length === 1) {
      return details[0];
    }
    return `Validation Errors:\n• ${details.join('\n• ')}`;
  }

  // Return specific backend message (e.g. "User with this email already exists.")
  return message || fallbackMsg;
}
