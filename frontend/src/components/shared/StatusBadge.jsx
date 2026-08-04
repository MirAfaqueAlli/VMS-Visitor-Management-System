// frontend/src/components/shared/StatusBadge.jsx

const STATUS_CLASSES = {
  PENDING:          'badge badge-pending',
  APPROVED:         'badge badge-approved',
  REJECTED:         'badge badge-rejected',
  CANCELLED:        'badge badge-cancelled',
  COMPLETED:        'badge badge-completed',
  ACTIVE:           'badge badge-active',
  VENDOR:           'badge badge-vendor',
  SPOT:             'badge badge-spot',
  EMPLOYEE_VISIT:   'badge badge-active',
  PERSONAL_VISIT:   'badge badge-pending',
  INTER_UNIT_VISIT: 'badge badge-issued',
  // Gate pass:
  ISSUED:           'badge badge-issued',
  USED:             'badge badge-used',
  EXPIRED:          'badge badge-expired',
};

const DISPLAY_LABELS = {
  EMPLOYEE_VISIT:    'Employee Visit',
  PERSONAL_VISIT:    'Personal Visit',
  INTER_UNIT_VISIT:  'Inter-Unit Visit',
  INTER_UNIT_INVITE: 'Inter-Unit Invite',
  SPOT:              'Walk-in',
  VENDOR:            'Vendor',
};

export default function StatusBadge({ status }) {
  if (!status) return <span className="badge badge-completed">—</span>;
  const key = String(status).toUpperCase();
  const cls = STATUS_CLASSES[key] ?? 'badge badge-completed';
  const label = DISPLAY_LABELS[key] ?? status;
  return <span className={cls}>{label}</span>;
}
