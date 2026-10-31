// frontend/src/components/shared/StatusBadge.jsx
// Kept for older call sites: shows any status / type the design-rules way
// (stage tracker, ring dot or hairline tag — see lib/status.js). No pills.
import { Status } from '../ui';

export default function StatusBadge({ status }) {
  return <Status value={status} />;
}
