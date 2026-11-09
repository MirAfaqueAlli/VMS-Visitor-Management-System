// frontend/src/components/shared/ScheduleConflictModal.jsx
// "Schedule conflict" — shown when approving a visit while the host already has an
// approved visit at that time. Keep it pending, or approve anyway (both visits are
// then booked for the same time). Used by Approvals, the dashboards and the bell panel.
import { Check, Loader2, AlertTriangle } from "../icons";
import { Modal, Note } from "../ui";
import { conflictWindow } from "../../lib/approvalConflict";

/**
 * @param {object}   props
 * @param {{visitor_name: string, time_window: string}|null} props.conflict — open while set
 * @param {boolean}  props.busy
 * @param {Function} props.onApproveAnyway
 * @param {Function} props.onKeepPending
 */
export default function ScheduleConflictModal({ conflict, busy = false, onApproveAnyway, onKeepPending }) {
  return (
    <Modal
      open={!!conflict}
      onClose={onKeepPending}
      busy={busy}
      width={440}
      title="Schedule conflict"
      footer={(
        <>
          <button type="button" className="btn-outline" onClick={onKeepPending} disabled={busy}>
            Keep it pending
          </button>
          <button type="button" className="btn-primary" onClick={onApproveAnyway} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Approve anyway
          </button>
        </>
      )}
    >
      {conflict && (
        <Note tone="warning" icon={AlertTriangle}>
          <b>{conflict.visitor_name || "Another visitor"}</b> is already visiting the host during{" "}
          <b className="tabular">{conflictWindow(conflict.time_window)}</b>. Approving anyway books both visits at the same time.
        </Note>
      )}
    </Modal>
  );
}
