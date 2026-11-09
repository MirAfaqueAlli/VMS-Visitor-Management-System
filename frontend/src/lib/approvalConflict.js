// frontend/src/lib/approvalConflict.js
// Approving a visit can answer 409 "schedule conflict": the host already has an
// approved visit at that time. Every approve button shows the same choice then —
// keep it pending, or approve anyway (force_approve) — see ScheduleConflictModal.
import { fmtTime } from "./format";

/** The host's clashing visit from an approve error ({ visitor_name, time_window }), or null. */
export function hostConflictOf(err) {
  const data = err?.response?.data;
  return err?.response?.status === 409 && data?.conflict && data?.host_conflict ? data.host_conflict : null;
}

/** "13:37:00 – 14:07:00" → "13:37 – 14:07" (as times show everywhere else). */
export const conflictWindow = (window) =>
  String(window || "").split(/\s*[–-]\s*/).filter(Boolean).map(fmtTime).join(" – ");
