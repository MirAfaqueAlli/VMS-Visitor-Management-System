// frontend/src/pages/gate/GatePass.jsx
// Printable gate pass: a flat, hairline-bordered card with the OHPC letterhead,
// visitor, host, validity and QR. Only the pass itself prints.
import { useState, useEffect } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { Printer, QrCode } from "../../components/icons";
import apiClient from "../../api/axios";
import toast from "react-hot-toast";
import BrandLogo from '../../components/BrandLogo';
import { PageHeader, Spinner } from "../../components/ui";
import { fmtDate, fmtTime, orDash } from "../../lib/format";

export default function GatePass() {
  const { passNumber } = useParams();
  const navigate = useNavigate();
  // ?unit_id= when the pass belongs to another unit (an employee hosted there)
  const [searchParams] = useSearchParams();
  const unitId = searchParams.get("unit_id");
  const [passData, setPassData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPass = async () => {
      try {
        const response = await apiClient.get(`/passes/pass/${passNumber}`, { params: unitId ? { unit_id: unitId } : undefined });
        setPassData(response.data.data);
      } catch {
        toast.error("Failed to load gate pass");
        navigate("/dashboard");
      } finally {
        setLoading(false);
      }
    };
    fetchPass();
  }, [passNumber, unitId, navigate]);

  if (loading) return <><PageHeader title="Gate pass" /><Spinner label="Loading the pass…" /></>;
  if (!passData) return null;

  const hasQr = /^https?:\/\//.test(passData.qr_code_path ?? '');

  return (
    <div className="animate-fade-in">
      <div className="print:hidden">
        <PageHeader
          title="Gate pass"
          meta={<span className="mono">{passData.pass_number}</span>}
          actions={(
            <>
              <button type="button" onClick={() => navigate(-1)} className="btn-outline">Back</button>
              <button type="button" onClick={() => window.print()} className="btn-primary">
                <Printer size={14} /> Print pass
              </button>
            </>
          )}
        />
      </div>

      <article className="gate-pass card mx-auto w-full max-w-[460px] p-6 sm:p-7">
        {/* Letterhead */}
        <header className="text-center pb-5 mb-5 border-b border-line">
          <div className="flex justify-center mb-3"><BrandLogo height={32} /></div>
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted">Government of Odisha</p>
          <p className="text-[12.5px] font-semibold text-ink-2">Odisha Hydro Power Corporation Ltd.</p>
          <h2 className="mt-3 text-[22px] font-bold tracking-[0.12em] uppercase text-ink">Gate pass</h2>
          <p className="mt-1 mono text-[12.5px] text-ink-2">{passData.pass_number}</p>
        </header>

        {/* Visitor + QR */}
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <p className="group-heading mb-0.5">Visitor</p>
              <p className="text-[20px] font-semibold leading-tight text-ink break-words">{passData.visitor_name}</p>
              {passData.visitor_phone && <p className="mt-0.5 text-[12.5px] tabular text-ink-2">{passData.visitor_phone}</p>}
            </div>
            <div>
              <p className="group-heading mb-0.5">Host</p>
              <p className="text-[13px] font-medium text-ink">{orDash(passData.host_name)}</p>
              {passData.department_name && <p className="text-[12px] text-muted">{passData.department_name}</p>}
            </div>
          </div>

          {/* qr_code_path is a short-lived signed S3 link from the API (null for old pre-S3 passes).
              No crossOrigin attribute: it would require a CORS rule on the private bucket. */}
          <div className="shrink-0 p-1.5 bg-white rounded border border-line">
            {hasQr ? (
              <img src={passData.qr_code_path} alt={`QR code for pass ${passData.pass_number}`} className="w-24 h-24 object-contain" />
            ) : (
              <div className="w-24 h-24 flex flex-col items-center justify-center gap-1 text-[11px] text-muted">
                <QrCode size={20} /> No QR
              </div>
            )}
          </div>
        </div>

        {/* Validity */}
        <dl className="mt-5 grid grid-cols-3 gap-3 rounded-lg bg-surface-alt px-3 py-2.5">
          <div>
            <dt className="group-heading mb-0.5">Visit date</dt>
            <dd className="text-[13px] font-medium tabular text-ink">{fmtDate(passData.visit_date)}</dd>
          </div>
          <div>
            <dt className="group-heading mb-0.5">From</dt>
            <dd className="text-[13px] font-medium tabular text-ink">{passData.visit_start_time ? fmtTime(passData.visit_start_time) : '—'}</dd>
          </div>
          <div>
            <dt className="group-heading mb-0.5">Until</dt>
            <dd className="text-[13px] font-medium tabular text-ink">{passData.visit_end_time ? fmtTime(passData.visit_end_time) : '—'}</dd>
          </div>
        </dl>

        <p className="mt-5 pt-4 border-t border-line text-center text-[11px] text-muted">
          Wear this pass where it can be seen while on the premises.
        </p>
      </article>

      {/* Print only the pass */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
@media print {
  @page { margin: 15mm; }
  body * { visibility: hidden; }
  .gate-pass, .gate-pass * { visibility: visible; }
  .gate-pass {
    position: absolute; left: 0; top: 0;
    width: 100%; max-width: 400px; margin: 0;
    background: #fff; color: #000; border-color: #999;
    page-break-inside: avoid; break-inside: avoid;
  }
}
`,
        }}
      />
    </div>
  );
}
