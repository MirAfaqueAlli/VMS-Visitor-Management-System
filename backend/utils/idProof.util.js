// backend/utils/idProof.util.js
'use strict';

/**
 * Visitor ID proof — the one set of rules used wherever an ID is taken: the staff
 * request form, the visitor's portal profile and the gate. Numbers are stored
 * without spaces, in capitals (Aadhaar without dashes), and encrypted at rest.
 */

const ID_PROOF_TYPES = ['AADHAAR', 'PAN', 'DRIVING_LICENSE', 'PASSPORT', 'VOTER_ID', 'OTHER'];

const ID_PROOF_FORMAT = {
  AADHAAR:         [/^\d{12}$/, 'Aadhaar number must be exactly 12 digits'],
  PAN:             [/^[A-Z]{5}\d{4}[A-Z]$/, 'PAN must look like ABCDE1234F'],
  DRIVING_LICENSE: [/^[A-Z0-9-]{8,20}$/, 'Enter the driving licence number as printed'],
  PASSPORT:        [/^[A-Z][0-9]{7}$/, 'Passport number must look like A1234567'],
  VOTER_ID:        [/^[A-Z]{3}\d{7}$/, 'Voter ID must look like ABC1234567'],
  OTHER:           [/^[A-Z0-9/-]{4,30}$/, 'Enter the ID number (4–30 letters or digits)'],
};

/** The number as stored: no spaces, upper case; Aadhaar also without dashes. */
const cleanIdNumber = (type, number) => {
  const n = String(number || '').replace(/\s/g, '').toUpperCase();
  return type === 'AADHAAR' ? n.replace(/-/g, '') : n;
};

/** What's wrong with an ID proof, or null when it's valid. */
const idProofError = (type, number) => {
  if (!ID_PROOF_TYPES.includes(type)) return 'Choose the ID type';
  const n = cleanIdNumber(type, number);
  if (!n) return 'Enter the ID number';
  const [re, message] = ID_PROOF_FORMAT[type];
  return re.test(n) ? null : message;
};

module.exports = { ID_PROOF_TYPES, ID_PROOF_FORMAT, cleanIdNumber, idProofError };
