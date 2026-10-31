// frontend/src/lib/status.js
// How each status / type value is shown (DESIGN_RULES §9 — no pills):
//   workflow → stage tracker  ▬▬▭▭ Approved
//   state    → ring dot       ◉ Issued
//   tag      → hairline tag   EMPLOYEE VISIT

// Visit request workflow: Pending → Approved → On premises → Completed
const WORKFLOW_STEPS = 4;
const WORKFLOW = {
  PENDING:       { label: 'Pending review',  tone: 'warning', step: 1 },
  APPROVED:      { label: 'Approved',        tone: 'brand',   step: 2 },
  SCHEDULED:     { label: 'Scheduled',       tone: 'brand',   step: 2 },
  CHECKED_IN:    { label: 'Inside premises', tone: 'brand',   step: 3 },
  COMPLETED:     { label: 'Completed',       tone: 'success', step: 4 },
  REJECTED:      { label: 'Rejected',        tone: 'danger',  step: 1 },
  CANCELLED:     { label: 'Cancelled',       tone: 'neutral', step: 1 },
  GATE_REJECTED: { label: 'Refused at gate', tone: 'danger',  step: 3 },
  NOT_ALLOWED:   { label: 'Not allowed',     tone: 'danger',  step: 3 },
};

// Conditions / locations (gate passes, visit logs, deliveries, accounts)
const STATES = {
  ISSUED:   { label: 'Issued',      tone: 'brand' },
  EXPECTED: { label: 'Expected',    tone: 'brand' },
  USED:     { label: 'Used',        tone: 'success' },
  EXPIRED:  { label: 'Expired',     tone: 'neutral' },
  ACTIVE:   { label: 'Inside premises', tone: 'info' },
  SENT:     { label: 'Sent',        tone: 'success' },
  FAILED:   { label: 'Failed',      tone: 'danger' },
  DEBARRED: { label: 'Debarred',    tone: 'danger' },
  LIFTED:   { label: 'Lifted',      tone: 'neutral' },
  INACTIVE: { label: 'Inactive',    tone: 'neutral' },
  SUSPENDED:{ label: 'Deactivated', tone: 'danger' },
  PROVISIONING: { label: 'Provisioning', tone: 'warning' },
};

// Types / flags
const TAGS = {
  EMPLOYEE_VISIT:    { label: 'Employee visit',  tone: 'info' },
  INTER_UNIT_VISIT:  { label: 'Inter-unit',      tone: 'info' },
  INTER_UNIT_INVITE: { label: 'Inter-unit',      tone: 'info' },
  VENDOR:            { label: 'Vendor',          tone: 'info' },
  SPOT:              { label: 'Walk-in',         tone: 'warning' },
  PERSONAL_VISIT:    { label: 'Personal visit',  tone: 'neutral' },
  PUBLIC:            { label: 'Public request',  tone: 'neutral' },
  INDIVIDUAL:        { label: 'Individual',      tone: 'neutral' },
  BUSINESS:          { label: 'Business',        tone: 'info' },
};

const titleCase = (s) => String(s).toLowerCase().replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/**
 * @returns {{ kind: 'workflow'|'state'|'tag', label: string, tone: string, step?: number, steps?: number }}
 */
export function describe(value) {
  const key = String(value || '').toUpperCase();
  if (WORKFLOW[key]) return { kind: 'workflow', steps: WORKFLOW_STEPS, ...WORKFLOW[key] };
  if (STATES[key]) return { kind: 'state', ...STATES[key] };
  if (TAGS[key]) return { kind: 'tag', ...TAGS[key] };
  return { kind: 'tag', label: titleCase(value || '—'), tone: 'neutral' };
}

/** Label only (for selects, exports) */
export const statusLabel = (value) => describe(value).label;
