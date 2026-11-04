// frontend/src/components/gate/GatePassCard.jsx
// The gate pass itself — one design for staff (Gate pass page) and visitors (portal):
// OHPC letterhead, the visitor's photo (or their initials), visitor / host, QR,
// purpose, validity, and a faint OHPC watermark. When printed only the pass prints:
// full A4 width inside the margins, half the page high.
import { QrCode } from "../icons";
import BrandLogo from "../BrandLogo";
import { fmtDate, fmtTime, orDash } from "../../lib/format";

/** Up to two initials for the photo placeholder ("Employ 2" → "E2"). */
const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join("").toUpperCase();

/**
 * @param {object} pass — pass_number, unit_name, unit_code, visitor_name, visitor_phone, company_name,
 *   visit_category, host_name, department_name, purpose, visit_date, visit_start_time, visit_end_time,
 *   visitor_photo_url, qr (an image URL: signed S3 link or data: URL)
 */
export default function GatePassCard({ pass }) {
  const isEmployee = pass.visit_category === "EMPLOYEE_VISIT";
  // A signed S3 link, or a QR the server drew from the pass data (no S3 on this server)
  const hasQr = /^(https?:\/\/|data:image\/)/.test(pass.qr ?? "");

  return (
    <>
      <article className="gate-pass card mx-auto w-full max-w-[780px] flex flex-col relative overflow-hidden">
        {/* Watermark: the OHPC emblem, faint, behind everything (as on official documents) */}
        <img src="/brand/ohpc-emblem.svg" alt="" aria-hidden="true" className="gate-pass-watermark" />
        {/* Letterhead */}
        <header className="flex items-center justify-between gap-4 px-6 py-4 border-b border-line">
          <div className="min-w-0">
            <BrandLogo height={34} />
            <p className="mt-1.5 text-[11px] font-medium uppercase tracking-[0.08em] text-muted">
              Government of Odisha{pass.unit_name ? <> · {pass.unit_name}</> : null}
              {pass.unit_code ? <span className="mono"> · {pass.unit_code}</span> : null}
            </p>
          </div>
          <div className="text-right shrink-0">
            <h2 className="text-[22px] font-bold tracking-[0.14em] uppercase text-ink leading-none">Gate pass</h2>
            <p className="mt-1.5 mono text-[13px] text-ink-2">{pass.pass_number}</p>
          </div>
        </header>

        {/* Photo · visitor details · QR */}
        <div className="gate-pass-body grid grid-cols-[auto_minmax(0,1fr)_auto] gap-5 px-6 pt-5 pb-4 items-start">
          <div className="gate-pass-photo w-[124px] h-[124px] rounded border border-line overflow-hidden bg-surface-alt flex items-center justify-center">
            {pass.visitor_photo_url ? (
              <img src={pass.visitor_photo_url} alt={`Photo of ${pass.visitor_name}`} className="w-full h-full object-cover" />
            ) : (
              <span className="text-[40px] font-semibold text-ink-2 tracking-wide" aria-label="No photo">{initials(pass.visitor_name)}</span>
            )}
          </div>

          <div className="min-w-0 space-y-3">
            <div>
              <p className="group-heading mb-0.5">Visitor{isEmployee ? " (Employee)" : ""}</p>
              <p className="gp-name text-[21px] font-semibold leading-tight text-ink break-words">{pass.visitor_name}</p>
              {pass.visitor_phone && <p className="mt-0.5 text-[12.5px] tabular text-ink-2">{pass.visitor_phone}</p>}
              {pass.company_name && <p className="text-[12px] text-muted">{pass.company_name}</p>}
            </div>
            <div className="gp-details grid grid-cols-[72px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[12.5px]">
              <span className="text-muted">Host</span>
              <span className="text-ink font-medium">{orDash(pass.host_name)}{pass.department_name ? <span className="text-muted font-normal"> · {pass.department_name}</span> : null}</span>
            </div>
          </div>

          {/* qr_code_path: a short-lived signed S3 link, or a data: image drawn by the API.
              No crossOrigin attribute: it would require a CORS rule on the private bucket. */}
          <div className="shrink-0 p-1.5 bg-white rounded border border-line">
            {hasQr ? (
              <img src={pass.qr} alt={`QR code for pass ${pass.pass_number}`} className="gate-pass-qr w-[136px] h-[136px] object-contain" />
            ) : (
              <div className="gate-pass-qr w-[136px] h-[136px] flex flex-col items-center justify-center gap-1 text-[11px] text-muted">
                <QrCode size={20} /> No QR
              </div>
            )}
          </div>
        </div>

        {/* Purpose: full width, takes the rest of the half page so a long purpose has room */}
        <section className="gp-purpose flex-1 mx-6 mb-3 px-4 py-2.5 rounded border border-line">
          <p className="group-heading mb-1">Purpose of visit</p>
          <p className="text-[13px] text-ink whitespace-pre-line break-words">{orDash(pass.purpose)}</p>
        </section>

        {/* Validity */}
        <dl className="gp-validity mx-6 grid grid-cols-4 gap-3 rounded bg-surface-alt px-4 py-2.5">
          <div>
            <dt className="group-heading mb-0.5">Visit date</dt>
            <dd className="text-[13px] font-medium tabular text-ink">{fmtDate(pass.visit_date)}</dd>
          </div>
          <div>
            <dt className="group-heading mb-0.5">From</dt>
            <dd className="text-[13px] font-medium tabular text-ink">{pass.visit_start_time ? fmtTime(pass.visit_start_time) : "Any time"}</dd>
          </div>
          <div>
            <dt className="group-heading mb-0.5">Until</dt>
            <dd className="text-[13px] font-medium tabular text-ink">{pass.visit_end_time ? fmtTime(pass.visit_end_time) : "—"}</dd>
          </div>
          <div>
            <dt className="group-heading mb-0.5">Valid</dt>
            <dd className="text-[13px] font-medium text-ink">On the visit date only</dd>
          </div>
        </dl>

        <p className="mx-6 mt-3 mb-4 pt-3 border-t border-line text-center text-[11px] text-muted">
          Wear this pass where it can be seen while on the premises · Carry a valid photo ID
        </p>
      </article>

      {/* Print only the pass: full A4 width (inside the margins), half its height */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
.gate-pass > :not(.gate-pass-watermark) { position: relative; z-index: 1; }
.gate-pass-watermark {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  height: 78%; width: auto; opacity: 0.035; filter: grayscale(1); pointer-events: none; user-select: none; z-index: 0;
}
[data-theme="dark"] .gate-pass-watermark { opacity: 0.05; }

@media print {
  @page { size: A4 portrait; margin: 10mm; }
  body * { visibility: hidden; }
  .gate-pass, .gate-pass * { visibility: visible; }
  .gate-pass {
    position: absolute; left: 0; top: 0;
    width: 190mm; max-width: none; height: 138.5mm; margin: 0;
    background: #fff; color: #000; border: 1px solid #777;
    page-break-inside: avoid; break-inside: avoid;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .gate-pass-watermark { opacity: 0.06 !important; filter: none !important; visibility: visible !important; }
  .gate-pass-photo { width: 38mm !important; height: 38mm !important; }
  .gate-pass-qr { width: 44mm !important; height: 44mm !important; }
}
`,
        }}
      />
    </>
  );
}
