// backend/validators/schemas.js
'use strict';

const { z } = require('zod');

// ── Reusable Field Primitives ─────────────────────────────────────────────────

/** Required email — trimmed, lowercased, must be valid format */
const emailField = z.string({ required_error: 'Email is required.' })
  .trim().toLowerCase()
  .email('Please provide a valid email address.');

/** Optional email — valid email, empty string, null, or undefined → null */
const emailFieldOpt = z.preprocess(
  (v) => (v === '' || v === undefined || v === null) ? null : v,
  z.string().trim().toLowerCase().email('Invalid email format.').nullable()
);

/** Flexible phone preprocessor — strips spaces, dashes, +, () before checking digit count */
const cleanPhone = (v) => {
  if (v === '' || v === undefined || v === null) return null;
  if (typeof v !== 'string') return v;
  const digitsOnly = v.replace(/[\s\-\+\(\)]/g, '');
  return digitsOnly === '' ? null : digitsOnly;
};

/** Required phone — digits only, 10-15 characters */
const phoneField = z.preprocess(
  cleanPhone,
  z.string({ required_error: 'Phone number is required.' })
    .nullable()
    .refine((val) => val !== null && /^\d{10,15}$/.test(val), {
      message: 'Phone number must contain 10-15 digits.',
    })
);

/** Optional phone — digits only when provided (10-15 digits), empty/null → null */
const phoneFieldOpt = z.preprocess(
  cleanPhone,
  z.string()
    .nullable()
    .refine((val) => val === null || /^\d{10,15}$/.test(val), {
      message: 'Phone number must contain 10-15 digits.',
    })
);

/** Required name — 2-100 chars */
const nameField = z.string({ required_error: 'Name is required.' })
  .trim().min(2, 'Name must be at least 2 characters.')
  .max(100, 'Name must be at most 100 characters.');

/** Required password — 8-128 chars */
const passwordField = z.string({ required_error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .max(128, 'Password must be at most 128 characters.');

/** Code field — uppercase alphanumeric + dash/underscore, 2-20 chars */
const codeField = z.string({ required_error: 'Code is required.' })
  .trim().toUpperCase()
  .regex(/^[A-Z0-9_-]{2,20}$/, 'Code must be 2-20 characters (letters, digits, dash, underscore).');

/** Coerce empty/null/undefined to null; otherwise parse as number */
const maybeNumber = z.preprocess(
  (v) => (v === '' || v === undefined || v === null) ? null : Number(v),
  z.number().nullable()
);

/** Optional trimmed string → null if empty */
const optString = z.preprocess(
  (v) => (v === '' || v === undefined || v === null) ? null : v,
  z.string().trim().nullable()
);

// ── User Schemas ──────────────────────────────────────────────────────────────

const UNIT_ROLES = ['unit_admin', 'unit_auditor', 'employee', 'security', 'receptionist'];

const createUserSchema = z.object({
  full_name:      nameField,
  email:          emailField,
  phone:          phoneFieldOpt.optional(),
  password:       passwordField,
  role_type:      z.enum(UNIT_ROLES, { required_error: 'role_type is required.' }),
  employee_code:  z.string({ required_error: 'Employee code is required.' }).trim().min(1, 'Employee code cannot be empty.'),
  department_id:  maybeNumber.optional(),
  designation:    optString.optional(),
  designation_id: maybeNumber.optional(),
  unit_id:        maybeNumber.optional(),
});

const updateUserSchema = z.object({
  full_name:      z.string().trim().min(2).max(100).optional(),
  email:          z.string().trim().toLowerCase().email('Invalid email.').optional(),
  phone:          phoneFieldOpt.optional(),
  designation:    optString.optional(),
  designation_id: maybeNumber.optional(),
  role_type:      z.enum(UNIT_ROLES).optional(),
  department_id:  maybeNumber.optional(),
}).refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'At least one field must be provided for update.' }
);

// ── Central User Schemas ──────────────────────────────────────────────────────

const CENTRAL_ROLES = ['super_admin', 'global_auditor'];

const createCentralUserSchema = z.object({
  full_name:      nameField,
  email:          emailField,
  phone:          phoneFieldOpt.optional(),
  employee_code:  z.string({ required_error: 'Employee code is required.' }).trim().min(1),
  password:       passwordField,
  role_type:      z.enum(CENTRAL_ROLES, { required_error: 'role_type is required.' }),
});

const updateCentralUserSchema = z.object({
  full_name:      z.string().trim().min(2).max(100).optional(),
  email:          z.string().trim().toLowerCase().email('Invalid email.').optional(),
  phone:          phoneFieldOpt.optional(),
  employee_code:  z.string().trim().min(1).optional(),
});

// ── Unit Schemas ──────────────────────────────────────────────────────────────

const createUnitSchema = z.object({
  name:    nameField,
  code:    codeField,
  type:    z.string().trim().optional().default('UNIT'),
  address: optString.optional(),
  city:    optString.optional(),
  state:   optString.optional(),
  phone:   phoneFieldOpt.optional(),
  email:   emailFieldOpt.optional(),
  unit_admin: z.object({
    full_name:      nameField,
    email:          emailField,
    password:       passwordField,
    employee_code:  z.string().trim().min(1).optional().default('UA-001'),
    phone:          phoneFieldOpt.optional(),
  }).optional(),
});

const updateUnitSchema = z.object({
  name:    z.string().trim().min(2).max(100).optional(),
  type:    z.string().trim().optional(),
  address: optString.optional(),
  city:    optString.optional(),
  state:   optString.optional(),
  phone:   phoneFieldOpt.optional(),
  email:   emailFieldOpt.optional(),
});

// ── Department Schemas ────────────────────────────────────────────────────────

const createDepartmentSchema = z.object({
  name:         z.string({ required_error: 'Department name is required.' }).trim().min(1, 'Name cannot be empty.').max(100),
  code:         z.string().trim().toUpperCase().max(20).optional().nullable(),
  description:  optString.optional(),
  unit_id:      maybeNumber.optional(),
  designations: z.array(z.string().trim().min(1)).optional().default([]),
});

const updateDepartmentSchema = z.object({
  name:        z.string().trim().min(1).max(100).optional(),
  code:        z.string().trim().toUpperCase().max(20).optional().nullable(),
  description: optString.optional(),
});

// ── Designation Schemas ───────────────────────────────────────────────────────

const bulkCreateDesignationSchema = z.object({
  department_id: z.number({ required_error: 'department_id is required.' }),
  names:         z.array(z.string().trim().min(1, 'Designation name cannot be empty.')).min(1, 'At least one name is required.'),
});

const updateDesignationSchema = z.object({
  name: z.string({ required_error: 'Name is required.' }).trim().min(1, 'Name cannot be empty.').max(100),
});

// ── Setup Schema ──────────────────────────────────────────────────────────────

const setupInitSchema = z.object({
  org_name:            z.string({ required_error: 'Organization name is required.' }).trim().min(2).max(100),
  org_code:            codeField,
  org_city:            optString.optional(),
  org_state:           optString.optional(),
  org_phone:           phoneFieldOpt.optional(),
  org_email:           emailFieldOpt.optional(),
  admin_name:          nameField,
  admin_email:         emailField,
  admin_phone:         phoneFieldOpt.optional(),
  admin_password:      passwordField,
  admin_employee_code: z.string().trim().min(1).optional().default('SA-001'),
});

// ── Gate Schemas ──────────────────────────────────────────────────────────────

const checkinSchema = z.object({
  pass_number:        z.string({ required_error: 'Pass number is required.' }).trim().min(1),
  id_verified_type:   optString.optional(),
  id_verified_number: optString.optional(),
  remarks:            optString.optional(),
}).passthrough(); // allow extra fields like photo uploads

const checkoutSchema = z.object({
  pass_number:   z.string().trim().min(1).optional(),
  visit_log_id:  maybeNumber.optional(),
}).refine(
  (data) => data.pass_number || data.visit_log_id,
  { message: 'Either pass_number or visit_log_id is required.' }
);

const checkoutQRSchema = z.object({
  pass_number: z.string({ required_error: 'Pass number is required for QR checkout.' }).trim().min(1),
});

const rejectAtGateSchema = z.object({
  visit_request_id: z.number({ required_error: 'visit_request_id is required.' }),
  visitor_id:       maybeNumber.optional(),
  rejection_reason: z.string({ required_error: 'Rejection reason is required.' }).trim().min(3, 'Reason must be at least 3 characters.'),
});

// ── Approval Schemas ──────────────────────────────────────────────────────────

const approveSchema = z.object({
  remarks:       optString.optional(),
  force_approve: z.boolean().optional().default(false),
});

const rejectSchema = z.object({
  remarks: z.string({ required_error: 'Remarks are required for rejection.' }).trim().min(1, 'Rejection reason cannot be empty.'),
});

// ── Public Auth Schemas ───────────────────────────────────────────────────────

const publicSendPhoneOtpSchema = z.object({
  phone: phoneField,
});

const publicVerifyPhoneOtpSchema = z.object({
  phone: phoneField,
  otp:   z.string({ required_error: 'OTP is required.' }).regex(/^\d{6}$/, 'OTP must be exactly 6 digits.'),
});

const publicSendEmailOtpSchema = z.object({
  email: emailField,
});

const publicVerifyEmailOtpSchema = z.object({
  email:          emailField,
  otp:            z.string({ required_error: 'OTP is required.' }).regex(/^\d{6}$/, 'OTP must be exactly 6 digits.'),
  visitor_name:   z.string().trim().min(2, 'Name must be at least 2 characters.').optional(),
  visitor_phone:  phoneFieldOpt.optional(),
  aadhaar_number: z.preprocess(
    (v) => (v === '' || v === undefined || v === null) ? null : v,
    z.string().trim().regex(/^\d{12}$/, 'Aadhaar must be exactly 12 digits.').nullable()
  ).optional(),
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  // User
  createUserSchema,
  updateUserSchema,
  // Central User
  createCentralUserSchema,
  updateCentralUserSchema,
  // Unit
  createUnitSchema,
  updateUnitSchema,
  // Department
  createDepartmentSchema,
  updateDepartmentSchema,
  // Designation
  bulkCreateDesignationSchema,
  updateDesignationSchema,
  // Setup
  setupInitSchema,
  // Gate
  checkinSchema,
  checkoutSchema,
  checkoutQRSchema,
  rejectAtGateSchema,
  // Approval
  approveSchema,
  rejectSchema,
  // Public Auth
  publicSendPhoneOtpSchema,
  publicVerifyPhoneOtpSchema,
  publicSendEmailOtpSchema,
  publicVerifyEmailOtpSchema,
};
