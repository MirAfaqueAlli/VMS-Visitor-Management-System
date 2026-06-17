// frontend/src/components/shared/StatusBadge.jsx

const STATUS_CLASSES = {
  PENDING:   'badge badge-pending',
  APPROVED:  'badge badge-approved',
  REJECTED:  'badge badge-rejected',
  CANCELLED: 'badge badge-cancelled',
  COMPLETED: 'badge badge-completed',
  ACTIVE:    'badge badge-active',
  VENDOR:    'badge badge-vendor',
  SPOT:      'badge badge-spot',
  // Gate pass:
  ISSUED:    'badge badge-issued',
  USED:      'badge badge-used',
  EXPIRED:   'badge badge-expired',
};

export default function StatusBadge({ status }) {
  const cls = STATUS_CLASSES[status?.toUpperCase()] ?? 'badge badge-completed';
  return <span className={cls}>{status}</span>;
}
