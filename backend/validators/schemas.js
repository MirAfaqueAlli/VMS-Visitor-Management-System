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

/**
 * Required Indian mobile number (verified by SMS OTP) — accepts a +91 or 0 prefix,
 * spaces and dashes; yields the bare 10 digits.
 */
const indianMobileField = z.preprocess(
  (v) => {
    const d = String(v ?? '').replace(/\D/g, '');
    if (d.length === 12 && d.startsWith('91')) return d.slice(2);
    if (d.length === 11 && d.startsWith('0'))  return d.slice(1);
    return d;
  },
  z.string().regex(/^[6-9]\d{9}$/, 'Enter a valid 10-digit Indian mobile number.')
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
  admin_phone:         indianMobileField,
  admin_password:      passwordField,
  admin_employee_code: z.string().trim().min(1).optional().default('SA-001'),
  // Proofs from the email / mobile OTP checks below (checked in setup.controller)
  email_token:         z.string().optional(),
  phone_token:         z.string().optional(),
});

// The super administrator's email and mobile are confirmed by OTP before setup runs
const setupSendEmailOtpSchema = z.object({
  email: emailField,
});

const setupVerifyEmailOtpSchema = z.object({
  email: emailField,
  otp:   z.string({ error: 'Enter the 6-digit code.' }).regex(/^\d{6}$/, 'Enter the 6-digit code.'),
});

const setupSendPhoneOtpSchema = z.object({
  phone: indianMobileField,
});

// idToken from Firebase, or (development only) a code from send-phone-otp
const setupVerifyPhoneSchema = z.object({
  phone:   indianMobileField,
  idToken: z.string().min(1).optional(),
  otp:     z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.').optional(),
}).refine((d) => d.idToken || d.otp, { message: 'Firebase idToken or otp is required.' });

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
  // Tender 1.1.1: outside visitors provide name, address, email and mobile
  visitor_address: z.string({ error: 'Address is required.' }).trim()
    .min(5, 'Please enter your full address.').max(255, 'Address is too long (max 255 characters).'),
  // From verify-phone-otp — proves the visitor owns visitor_phone
  phone_token:    z.string({ error: 'Please verify your mobile number first.' }).min(1, 'Please verify your mobile number first.'),
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
  setupSendEmailOtpSchema,
  setupVerifyEmailOtpSchema,
  setupSendPhoneOtpSchema,
  setupVerifyPhoneSchema,
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
