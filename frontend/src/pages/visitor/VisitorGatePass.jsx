// frontend/src/pages/visitor/VisitorGatePass.jsx
import { useState, useEffect } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import {
  Printer,
  ArrowLeft,
  ShieldCheck,
  Building,
  User,
  Calendar,
  Clock,
  Phone,
  QrCode,
  Share2,
  CheckCircle,
} from "lucide-react";
import apiClient from "../../api/axios";
import BrandLogo from "../../components/BrandLogo";
import StatusBadge from "../../components/shared/StatusBadge";
import toast from "react-hot-toast";

export default function VisitorGatePass() {
  const { unitId, passNumber } = useParams();
  const navigate = useNavigate();

  const [passData, setPassData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchPass = async () => {
      try {
        const res = await apiClient.get(
          `/public-auth/pass/${unitId}/${passNumber}`
        );
        setPassData(res.data?.data?.pass);
      } catch (err) {
        console.error("Failed to load pass:", err);
        toast.error("Could not load gate pass.");
        navigate("/visitor/history");
      } finally {
        setLoading(false);
      }
    };
    fetchPass();
  }, [unitId, passNumber, navigate]);

  const handlePrint = () => {
    window.print();
  };

  const handleShare = async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: `OHPC Gate Pass #${passNumber}`,
          text: `Digital Gate Pass for ${passData?.visitor_name} to visit ${passData?.unit_name}`,
          url: window.location.href,
        });
      } catch {}
    } else {
      navigator.clipboard.writeText(window.location.href);
      toast.success("Pass link copied to clipboard!");
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] space-y-3">
        <div className="w-8 h-8 rounded-full border-2 border-accent border-t-transparent animate-spin" />
        <p className="text-xs text-faint">Loading digital gate pass...</p>
      </div>
    );
  }

  if (!passData) return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6 animate-fade-in pb-12">
      {/* ── Top Controls (Hidden during print) ───────────────────────────────── */}
      <div className="flex items-center justify-between gap-4 print:hidden">
        <Link
          to="/visitor/history"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-accent transition-colors"
        >
          <ArrowLeft size={14} /> Back to My Passes
        </Link>

        <div className="flex items-center gap-2">
          <button
            onClick={handleShare}
            className="btn-secondary py-2 px-3 text-xs font-semibold flex items-center gap-1.5"
            title="Share pass"
          >
            <Share2 size={14} />
            <span>Share</span>
          </button>
          <button
            onClick={handlePrint}
            className="btn-primary py-2 px-4 text-xs font-bold flex items-center gap-1.5 shadow-md shadow-accent/20"
          >
            <Printer size={14} />
            <span>Print Pass</span>
          </button>
        </div>
      </div>

      {/* ── Official Gate Pass Document Card ─────────────────────────────────── */}
      <div className="vms-card border-2 border-border shadow-lg bg-bg-secondary p-6 sm:p-8 space-y-6 relative overflow-hidden print:border-black print:shadow-none">
        {/* Tricolor top header strip */}
        <div className="absolute top-0 left-0 right-0 h-1.5 flex">
          <span className="flex-1 bg-[#FF9933]" />
          <span className="flex-1 bg-white" />
          <span className="flex-1 bg-[#138808]" />
        </div>

        {/* Header: OHPC Brand + Pass Title */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-border">
          <div className="flex items-center gap-3">
            <BrandLogo height={38} />
            <div>
              <h2 className="text-sm font-black text-loud tracking-tight uppercase">
                Odisha Hydro Power Corporation
              </h2>
              <p className="text-[11px] text-faint font-medium">
                {passData.unit_name || "Headquarters & Generating Stations"}
              </p>
            </div>
          </div>

          <div className="text-left sm:text-right">
            <span className="inline-block text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded bg-mixed-bg text-accent font-bold">
              Official Digital Pass
            </span>
            <p className="text-base font-black font-mono text-loud mt-0.5">
              #{passData.pass_number}
            </p>
          </div>
        </div>

        {/* QR Code & Status Banner */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-6 p-5 rounded-xl bg-bg-primary border border-border">
          <div className="flex items-center gap-4">
            {passData.qr_code_url ? (
              <img
                src={passData.qr_code_url}
                alt={`QR code for pass #${passData.pass_number}`}
                className="w-28 h-28 object-contain bg-white p-1 rounded-lg border border-border shadow-xs"
              />
            ) : (
              <div className="w-28 h-28 bg-white rounded-lg border border-border flex flex-col items-center justify-center text-muted">
                <QrCode size={36} />
                <span className="text-[10px] font-mono mt-1">Ready</span>
              </div>
            )}

            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <StatusBadge status={passData.request_status || passData.status} />
                <span className="text-[11px] font-semibold text-success flex items-center gap-1">
                  <ShieldCheck size={13} /> Verified
                </span>
              </div>
              <p className="text-xs font-bold text-loud">
                Scan at Security Checkpost
              </p>
              <p className="text-[11px] text-faint max-w-xs leading-tight">
                Present this QR code on your mobile or show printed copy to the on-duty security guard.
              </p>
            </div>
          </div>

          <div className="text-center sm:text-right w-full sm:w-auto pt-3 sm:pt-0 border-t sm:border-t-0 border-border">
            <span className="text-[10px] uppercase font-bold text-faint">
              Validity Schedule
            </span>
            <p className="text-xs font-black text-loud mt-0.5 flex items-center sm:justify-end gap-1">
              <Calendar size={13} className="text-accent" />
              {passData.visit_date}
            </p>
            {passData.visit_start_time && (
              <p className="text-[11px] font-medium text-muted mt-0.5 flex items-center sm:justify-end gap-1">
                <Clock size={12} className="text-accent" />
                {passData.visit_start_time} - {passData.visit_end_time || "End of day"}
              </p>
            )}
          </div>
        </div>

        {/* Visitor & Host Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
          {/* Visitor Details */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5 pb-1 border-b border-border">
              <User size={13} className="text-accent" />
              <span>Visitor Information</span>
            </h3>
            <div className="space-y-1.5 text-xs">
              <p className="text-base font-bold text-loud">{passData.visitor_name}</p>
              <p className="text-muted flex items-center gap-1">
                <Phone size={12} className="text-faint" />
                {passData.visitor_phone}
              </p>
              {passData.visitor_email && (
                <p className="text-faint text-[11px]">{passData.visitor_email}</p>
              )}
              {passData.company_name && (
                <p className="text-muted text-[11px]">
                  Organization: <strong className="text-loud">{passData.company_name}</strong>
                </p>
              )}
              {passData.accompanying_count > 0 && (
                <p className="text-accent text-[11px] font-semibold">
                  Accompanying: +{passData.accompanying_count} Persons
                </p>
              )}
            </div>
          </div>

          {/* Host Details */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-muted flex items-center gap-1.5 pb-1 border-b border-border">
              <Building size={13} className="text-accent" />
              <span>Host Officer & Department</span>
            </h3>
            <div className="space-y-1.5 text-xs">
              <p className="text-base font-bold text-loud">{passData.host_name}</p>
              <p className="text-muted">{passData.department_name}</p>
              <p className="text-faint text-[11px]">{passData.unit_name}</p>
              {passData.host_phone && (
                <p className="text-faint text-[11px] flex items-center gap-1">
                  <Phone size={12} className="text-faint" /> Intercom / Contact: {passData.host_phone}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Purpose */}
        <div className="p-3.5 rounded-lg bg-bg-primary border border-border text-xs space-y-1">
          <span className="text-[10px] uppercase font-bold text-faint">
            Purpose of Visit
          </span>
          <p className="text-loud font-medium leading-relaxed">
            {passData.purpose}
          </p>
        </div>

        {/* Security Footer Notice */}
        <div className="pt-4 border-t border-border flex flex-col sm:flex-row items-center justify-between text-[11px] text-faint gap-2">
          <span>Carry original photo ID proof at all times inside premises.</span>
          <span className="font-mono text-[10px]">OHPC-SEC-PROTOCOL</span>
        </div>
      </div>
    </div>
  );
}

