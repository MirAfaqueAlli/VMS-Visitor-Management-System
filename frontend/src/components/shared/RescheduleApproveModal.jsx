// frontend/src/components/shared/RescheduleApproveModal.jsx
// "Reschedule & accept": approve a pending request with a new date/time.
// The visitor is notified through the normal approval pipeline (email, SMS,
// WhatsApp, push, gate pass).
import { useEffect, useState } from "react";
import { Calendar, Check, Loader2 } from "../icons";
import { Field, Modal, Note } from "../ui";
import ScheduleConflictModal from "./ScheduleConflictModal";

const dateInput = (v) => {
  if (!v) return "";
  // If it's already a plain YYYY-MM-DD string (from DB), use it directly.
  // Avoid passing through new Date() — UTC midnight shifts to the previous
  // day in IST (+5:30), which is why yesterday's date was showing.
  if (typeof v === "string") return v.slice(0, 10);
  // For actual Date objects, format in IST to avoid the same UTC offset issue.
  const p = (n) => String(n).padStart(2, "0");
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(v));
};
const timeInput = (v) => (v ? String(v).slice(0, 5) : "");
const todayInput = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export default function RescheduleApproveModal({
  open,
  request,
  busy = false,
  conflict = null,
  onClose,
  onSubmit,
  onResolveConflict,
}) {
  const [date, setDate] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [remarks, setRemarks] = useState("");
  const [error, setError] = useState("");
  const requestId = request?.id ?? request?.visit_request_id;

  useEffect(() => {
    if (!open) return;
    setDate(dateInput(request?.visit_date));
    setStart(timeInput(request?.visit_start_time));
    setEnd(timeInput(request?.visit_end_time));
    setRemarks("");
    setError("");
  }, [open, requestId, request?.visit_date, request?.visit_start_time, request?.visit_end_time]);

  const values = () => ({
    date,
    start: start || null,
    end: end || null,
    remarks: remarks.trim(),
  });

  const submit = (force = false) => {
    if (!date) { setError("Choose the new visit date."); return; }
    if (start && end && end <= start) { setError("The end time must be after the start time."); return; }
    setError("");
    onSubmit?.(values(), force);
  };

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        busy={busy}
        width={500}
        title={`Reschedule & accept request${requestId ? ` #${requestId}` : ""}`}
        footer={(
          <>
            <button type="button" className="btn-outline" onClick={onClose} disabled={busy}>Cancel</button>
            <button type="button" className="btn-primary" onClick={() => submit(false)} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {busy ? "Saving…" : "Reschedule & accept"}
            </button>
          </>
        )}
      >
        <div className="space-y-3">
          {request?.visitor_name && (
            <p className="text-[12.5px] text-ink-2">
              Visitor: <b className="text-ink">{request.visitor_name}</b>
            </p>
          )}

          <Field label="New visit date" htmlFor="reschedule-date" required error={error}>
            <input
              id="reschedule-date"
              type="date"
              className={`control tabular${error ? " is-invalid" : ""}`}
              value={date}
              min={todayInput()}
              onChange={(e) => { setDate(e.target.value); setError(""); }}
              required
            />
          </Field>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="From" htmlFor="reschedule-start">
              <input
                id="reschedule-start"
                type="time"
                className="control tabular"
                value={start}
                onChange={(e) => { setStart(e.target.value); setError(""); }}
              />
            </Field>
            <Field label="Until" htmlFor="reschedule-end">
              <input
                id="reschedule-end"
                type="time"
                className="control tabular"
                value={end}
                onChange={(e) => { setEnd(e.target.value); setError(""); }}
              />
            </Field>
          </div>

          <Field label="Remarks for the visitor (optional)" htmlFor="reschedule-remarks">
            <textarea
              id="reschedule-remarks"
              rows={3}
              className="control resize-none"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. The original time is not available; please come at the new time."
            />
          </Field>
        </div>
      </Modal>

      <ScheduleConflictModal
        conflict={conflict}
        busy={busy}
        onApproveAnyway={() => submit(true)}
        onKeepPending={onResolveConflict}
      />
    </>
  );
}
