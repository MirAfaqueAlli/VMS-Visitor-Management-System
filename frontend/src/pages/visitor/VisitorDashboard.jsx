// frontend/src/pages/visitor/VisitorDashboard.jsx
import { useState, useEffect } from "react";
import { Link, useNavigate, useOutletContext } from "react-router-dom";
import {
  PlusCircle,
  Calendar,
  Clock,
  ShieldCheck,
  Building,
  User,
  ArrowRight,
  QrCode,
  FileText,
  AlertTriangle,
  RotateCcw,
  CheckCircle2,
  Hourglass,
  ExternalLink,
} from "lucide-react";
import apiClient from "../../api/axios";
import StatusBadge from "../../components/shared/StatusBadge";
import toast from "react-hot-toast";

export default function VisitorDashboard() {
  const { visitor } = useOutletContext();
  const navigate = useNavigate();

  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchRequests = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/public-auth/my-requests");
      setRequests(res.data?.data?.requests || []);
    } catch (err) {
      console.error("Failed to fetch visitor requests:", err);
      toast.error("Could not load your visits.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchRequests();
  }, []);

  // Compute metrics
  const pendingCount = requests.filter((r) => String(r.status || "").toUpperCase() === "PENDING").length;
  const approvedCount = requests.filter((r) => String(r.status || "").toUpperCase() === "APPROVED").length;
  const completedCount = requests.filter((r) => String(r.status || "").toUpperCase() === "COMPLETED").length;

  // Find active / today pass (approved or checked-in)
  const todayStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());

  const activePass = requests.find(
    (r) =>
      (r.status === "APPROVED" || r.status === "CHECKED_IN") &&
      (r.visit_date === todayStr || new Date(r.visit_date) >= new Date(todayStr))
  );

  // 1-Click Revisit handler
  const handleRevisit = (r) => {
    const params = new URLSearchParams({
      revisit_unit: r.unit_id || "",
      revisit_dept: r.department_id || "",
      revisit_host: r.host_user_id || "",
      revisit_category: r.visit_category || "INDIVIDUAL",
      revisit_purpose: r.purpose || "",
      revisit_company: r.company_name || "",
    });
    navigate(`/visitor/new-request?${params.toString()}`);
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* ── Welcome Banner ─────────────────────────────────────────────────── */}
      <div className="vms-card p-6 sm:p-8 bg-gradient-to-r from-bg-secondary via-bg-secondary to-accent/5 relative overflow-hidden border border-border">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 relative z-10">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-mixed-bg text-accent text-xs font-semibold">
              <ShieldCheck size={13} />
              <span>Verified Public Visitor</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-loud tracking-tight">
              Welcome, {visitor?.full_name || "Visitor"}
            </h1>
            
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              to="/visitor/new-request"
              className="btn-primary py-2.5 px-4 text-xs sm:text-sm font-bold shadow-md shadow-accent/20"
            >
              <PlusCircle size={16} />
              <span>Schedule New Visit</span>
            </Link>
            <Link
              to="/visitor/history"
              className="btn-secondary py-2.5 px-4 text-xs sm:text-sm font-semibold"
            >
              <FileText size={16} />
              <span>All Passes</span>
            </Link>
          </div>
        </div>
      </div>

      {/* ── Active Gate Pass Highlight (If available) ─────────────────────── */}
      {activePass && (
        <div className="vms-card p-5 sm:p-6 border-2 border-accent/40 bg-accent/[0.03] shadow-card">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
            <div className="space-y-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-success animate-pulse" />
                <span className="text-xs font-bold uppercase tracking-wider text-accent">
                  Active Gate Pass Ready
                </span>
                <StatusBadge status={activePass.status} />
              </div>

              <div>
                <h3 className="text-lg font-bold text-loud">
                  Visit to {activePass.unit_name || "OHPC Facility"}
                </h3>
                <p className="text-xs text-muted mt-0.5">
                  Host: <span className="font-semibold text-loud">{activePass.host_name}</span> ({activePass.department_name})
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-faint">
                <span className="flex items-center gap-1.5">
                  <Calendar size={14} className="text-accent" />
                  {activePass.visit_date}
                </span>
                {activePass.visit_start_time && (
                  <span className="flex items-center gap-1.5">
                    <Clock size={14} className="text-accent" />
                    {activePass.visit_start_time} - {activePass.visit_end_time || "End of day"}
                  </span>
                )}
                {activePass.pass_number && (
                  <span className="font-mono bg-bg-secondary px-2 py-0.5 rounded border border-border text-[11px] font-semibold text-loud">
                    Pass: #{activePass.pass_number}
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-3 shrink-0">
              {activePass.pass_number ? (
                <Link
                  to={`/visitor/pass/${activePass.unit_id}/${activePass.pass_number}`}
                  className="btn-primary py-3 px-5 text-xs sm:text-sm font-bold flex items-center gap-2 shadow-md shadow-accent/20"
                >
                  <QrCode size={18} />
                  <span>View Digital Pass & QR</span>
                </Link>
              ) : (
                <button
                  onClick={() => handleRevisit(activePass)}
                  className="btn-secondary py-2.5 px-4 text-xs font-semibold"
                >
                  <RotateCcw size={14} />
                  <span>Revisit Same Host</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Summary Metrics ────────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="vms-card p-5 border border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Pending Approval
            </span>
            <div className="w-8 h-8 rounded-lg bg-warning/10 text-warning flex items-center justify-center">
              <Hourglass size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-loud mt-3">{pendingCount}</p>
          
        </div>

        <div className="vms-card p-5 border border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Approved Passes
            </span>
            <div className="w-8 h-8 rounded-lg bg-success/10 text-success flex items-center justify-center">
              <CheckCircle2 size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-loud mt-3">{approvedCount}</p>
          
        </div>

        <div className="vms-card p-5 border border-border">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted uppercase tracking-wider">
              Total Completed
            </span>
            <div className="w-8 h-8 rounded-lg bg-accent/10 text-accent flex items-center justify-center">
              <Building size={16} />
            </div>
          </div>
          <p className="text-2xl font-black text-loud mt-3">{completedCount}</p>
          
        </div>
      </div>

      {/* ── Recent Visits & Security Info Grid ──────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Recent Visits List */}
        <div className="lg:col-span-2 vms-card p-5 sm:p-6 border border-border space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div>
              <h2 className="text-sm font-bold text-loud">Recent Visit Requests</h2>
        
            </div>
            <Link
              to="/visitor/history"
              className="text-xs font-semibold text-accent hover:underline flex items-center gap-1"
            >
              <span>View all</span>
              <ArrowRight size={13} />
            </Link>
          </div>

          {loading ? (
            <div className="py-12 text-center text-xs text-faint">
              Loading your visits...
            </div>
          ) : requests.length === 0 ? (
            <div className="py-12 text-center space-y-3">
              <div className="w-12 h-12 rounded-full bg-mixed-bg mx-auto flex items-center justify-center text-accent">
                <FileText size={22} />
              </div>
              <p className="text-xs font-semibold text-muted">No visit requests scheduled yet</p>
              <Link to="/visitor/new-request" className="btn-primary py-2 px-4 text-xs font-bold inline-flex">
                <PlusCircle size={14} /> Schedule Your First Visit
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {requests.slice(0, 4).map((r) => (
                <div
                  key={`${r.unit_id}-${r.id}`}
                  className="p-4 rounded-xl border border-border bg-bg-secondary hover:border-accent/30 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-loud">
                        {r.unit_name || "OHPC Unit"}
                      </span>
                      <StatusBadge status={r.status} />
                    </div>
                    <p className="text-xs text-muted">
                      Host: <span className="font-semibold text-loud">{r.host_name}</span> ({r.department_name})
                    </p>
                    <p className="text-[11px] text-faint line-clamp-1">
                      Purpose: {r.purpose}
                    </p>
                    <p className="text-[11px] text-accent flex items-center gap-1">
                      <Calendar size={12} /> {r.visit_date} {r.visit_start_time ? `• ${r.visit_start_time}` : ""}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0 pt-2 sm:pt-0 border-t sm:border-t-0 border-border">
                    {r.pass_number ? (
                      <Link
                        to={`/visitor/pass/${r.unit_id}/${r.pass_number}`}
                        className="btn-secondary py-1.5 px-3 text-xs font-semibold text-accent border-accent/30 flex items-center gap-1.5"
                      >
                        <QrCode size={13} /> Pass
                      </Link>
                    ) : null}

                    <button
                      onClick={() => handleRevisit(r)}
                      className="btn-secondary py-1.5 px-3 text-xs font-semibold flex items-center gap-1"
                      title="Schedule another visit with this same host"
                    >
                      <RotateCcw size={12} /> Revisit
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Right 1 Col: OHPC Security & Safety Advisory */}
        <div className="vms-card p-5 sm:p-6 border border-border space-y-4">
          <div className="flex items-center gap-2 pb-3 border-b border-border">
            <AlertTriangle size={18} className="text-warning shrink-0" />
            <div>
              <h2 className="text-sm font-bold text-loud">Gate & Safety Rules</h2>
              <p className="text-xs text-faint">Mandatory entry protocols</p>
            </div>
          </div>

          <div className="space-y-3.5 text-xs text-muted leading-relaxed">
            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-accent/10 text-accent font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                1
              </span>
              <p>
                <strong className="text-loud">Government Photo ID:</strong> You must present the physical original ID card (Aadhaar, Voter ID, Driving License, Passport) at the security checkpost.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-accent/10 text-accent font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                2
              </span>
              <p>
                <strong className="text-loud">Digital Gate Pass:</strong> Keep your digital QR pass ready on your phone or carry a printed copy for fast gate scanning.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-accent/10 text-accent font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                3
              </span>
              <p>
                <strong className="text-loud">Plant Site Safety:</strong> Hard hats and safety shoes are required when visiting power houses or switchyards. Photography is strictly prohibited.
              </p>
            </div>

            <div className="flex items-start gap-2.5">
              <span className="w-5 h-5 rounded-full bg-accent/10 text-accent font-bold text-[10px] flex items-center justify-center shrink-0 mt-0.5">
                4
              </span>
              <p>
                <strong className="text-loud">Vehicle Pass:</strong> If entering with a vehicle, ensure your vehicle plate is correctly noted on your gate pass.
              </p>
            </div>
          </div>

          <div className="p-3 bg-mixed-bg/60 rounded-xl border border-mixed/20 text-center">
            <p className="text-[11px] font-semibold text-accent">
              Assistance or Gate Inquiries?
            </p>
            <p className="text-[10px] text-faint mt-0.5">
              Contact reception or security control room at your destination OHPC unit.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

