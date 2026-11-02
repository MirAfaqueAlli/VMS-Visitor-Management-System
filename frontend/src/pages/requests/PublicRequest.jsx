// frontend/src/pages/requests/PublicRequest.jsx
// /public-request/new — a signed-in visitor asks to visit a unit. The visitor's
// identity comes from their portal account (verified mobile + email); this page
// only collects where, whom, when and why. Signed-out visitors go to the portal.
import useDocumentTitle from "../../lib/useDocumentTitle";
import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  ArrowLeft, ArrowRight, Briefcase, Building2, Calendar, CheckCircle2, FileText, Loader2, Lock, UserCircle,
} from "../../components/icons";
import Select from "../../components/Select";
import PublicShell from "../../components/PublicShell";
import { Field, KV, State, SectionTitle, ChoiceCards, Spinner } from "../../components/ui";
import { fmtDate } from "../../lib/format";
import {
  portalApi, publicApi, portalError, getVisitorSession, clearVisitorSession,
} from "../../lib/visitorPortal";

const getISTDateString = (d = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);

const VISIT_TYPES = [
  { id: "INDIVIDUAL", label: "Individual visit", desc: "A personal visitor meeting staff", icon: UserCircle },
  { id: "BUSINESS", label: "Official / business", desc: "Vendor, contractor, audit or corporate meeting", icon: Briefcase },
];

const EMPTY_FORM = {
  visit_type: "INDIVIDUAL", unit_id: "", department_id: "", host_user_id: "", purpose: "",
  visit_date: "", visit_start_time: "", visit_end_time: "", company_name: "",
};

export default function PublicRequest() {
  useDocumentTitle("Request a visit");
  const navigate = useNavigate();
  const [account, setAccount] = useState(null);
  const [formData, setFormData] = useState(EMPTY_FORM);
  const [units, setUnits] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [hosts, setHosts] = useState([]);
  const [loadingDepts, setLoadingDepts] = useState(false);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(null);   // the request just sent (confirmation view)

  const toPortal = useCallback(() => navigate("/public-request", { replace: true }), [navigate]);

  // Signed-in, complete accounts only
  useEffect(() => {
    if (!getVisitorSession()) { toPortal(); return; }
    portalApi.get("/me")
      .then((r) => {
        if (r.data.data.pending?.length) { toPortal(); return; }   // finish the account first
        setAccount(r.data.data.account);
      })
      .catch(() => { clearVisitorSession(); toPortal(); });
  }, [toPortal]);

  useEffect(() => {
    publicApi.get("/units/public")
      .then((res) => setUnits(res.data?.data ?? []))
      .catch(() => toast.error("Could not load units."));
  }, []);

  useEffect(() => {
    if (!formData.unit_id) {
      setDepartments([]);
      setHosts([]);
      setFormData((p) => ({ ...p, department_id: "", host_user_id: "" }));
      return;
    }
    setLoadingDepts(true);
    setDepartments([]);
    setHosts([]);
    setFormData((p) => ({ ...p, department_id: "", host_user_id: "" }));
    publicApi.get("/departments/public", { params: { unit_id: formData.unit_id } })
      .then((res) => setDepartments(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load departments."))
      .finally(() => setLoadingDepts(false));
  }, [formData.unit_id]);

  useEffect(() => {
    if (!formData.department_id) {
      setHosts([]);
      setFormData((p) => ({ ...p, host_user_id: "" }));
      return;
    }
    setLoadingHosts(true);
    setHosts([]);
    setFormData((p) => ({ ...p, host_user_id: "" }));
    publicApi.get("/users/hosts", { params: { department_id: formData.department_id, unit_id: formData.unit_id } })
      .then((res) => setHosts(res.data?.data ?? []))
      .catch(() => toast.error("Failed to load hosts."))
      .finally(() => setLoadingHosts(false));
  }, [formData.department_id, formData.unit_id]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.unit_id) { toast.error("Please select a unit or office."); return; }
    if (!formData.department_id) { toast.error("Please select a department."); return; }
    if (!formData.host_user_id) { toast.error("Please select a host contact person."); return; }
    if (formData.visit_type === "BUSINESS" && !formData.company_name.trim()) {
      toast.error("Company name is required for business visits."); return;
    }

    setSubmitting(true);
    try {
      // A fresh short-lived token for this submission (the account is already verified)
      const tok = await portalApi.post("/me/visitor-token");
      await publicApi.post(
        "/visit-requests/public",
        {
          unit_id: parseInt(formData.unit_id),
          department_id: parseInt(formData.department_id),
          host_user_id: parseInt(formData.host_user_id),
          visit_category: formData.visit_type,
          purpose: formData.purpose.trim(),
          visit_date: formData.visit_date,
          visit_start_time: formData.visit_start_time || undefined,
          visit_end_time: formData.visit_end_time || undefined,
          company_name: formData.company_name.trim() || undefined,
        },
        { headers: { "X-Visitor-Token": tok.data.data.visitor_token } },
      );
      setSent({
        unit: units.find((u) => String(u.id) === String(formData.unit_id)),
        host: hosts.find((h) => String(h.id) === String(formData.host_user_id)),
        date: formData.visit_date,
        time: formData.visit_start_time,
      });
    } catch (err) {
      toast.error(portalError(err, "Failed to submit request."));
    } finally {
      setSubmitting(false);
    }
  };

  const signOut = () => { clearVisitorSession(); toPortal(); };

  /* ── Confirmation ── */
  if (sent) {
    return (
      <PublicShell account={account} onSignOut={signOut}>
        <div className="card w-full max-w-lg mx-auto p-6 sm:p-8 animate-fade-in">
          <span className="head-chip tone-success !w-10 !h-10 mb-4"><CheckCircle2 size={22} duo /></span>
          <h2 className="text-[18px] font-semibold text-ink">Visit request sent</h2>
          <p className="text-[12.5px] text-ink-2 mt-1 mb-5">
            The host officer will review it. Once approved, your gate pass appears in My visits and is sent to you by SMS and email.
          </p>
          <div className="tile mb-5">
            <KV items={[
              ["Visitor", account?.full_name],
              ["Host officer", sent.host ? sent.host.full_name : "Assigned staff"],
              ["Unit", sent.unit ? sent.unit.name : "OHPC office"],
              ["Date", <span key="d" className="tabular">{fmtDate(sent.date)}{sent.time ? `, ${sent.time}` : ""}</span>],
            ]} className="!grid-cols-[110px_minmax(0,1fr)]" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={toPortal} className="btn-primary">Go to my visits</button>
            <button type="button" onClick={() => { setSent(null); setFormData(EMPTY_FORM); }} className="btn-outline">
              Send another request
            </button>
          </div>
        </div>
      </PublicShell>
    );
  }

  if (!account) {
    return <PublicShell><Spinner label="Opening your account…" /></PublicShell>;
  }

  /* ── Visit details ── */
  return (
    <PublicShell account={account} onSignOut={signOut}>
      <button type="button" onClick={toPortal} className="btn-ghost btn-sm !px-0 mb-3">
        <ArrowLeft size={13} /> My visits
      </button>
      <h1 className="page-title mb-5">New visit request</h1>

      <form onSubmit={handleSubmit} className="w-full animate-fade-in">
        <div className="grid grid-cols-1 lg:grid-cols-[300px_minmax(0,1fr)] gap-6 items-start">
          {/* LEFT: the verified visitor */}
          <aside className="card p-5 lg:sticky lg:top-20">
            <State tone="success">Verified visitor</State>
            <p className="mt-3 text-[14px] font-semibold text-ink break-words">{account.full_name}</p>
            <KV items={[
              ["Mobile", <span key="m" className="tabular">+91 {account.phone}</span>],
              ["Email", account.email],
              account.address && ["Address", account.address],
            ]} className="!grid-cols-[64px_minmax(0,1fr)] mt-3" />
            <p className="mt-4 pt-3 border-t border-line text-[11.5px] text-muted flex items-start gap-1.5">
              <Lock size={12} className="shrink-0 mt-0.5" />
              These come from your account; the gate checks them. Change them under Profile and security.
            </p>
          </aside>

          {/* RIGHT: visit details */}
          <div className="card p-5 sm:p-6">
            <section>
              <SectionTitle icon={FileText} title="Visit type" />
              <ChoiceCards
                cols={2}
                label="Visit type"
                options={VISIT_TYPES}
                value={formData.visit_type}
                onPick={(id) => setFormData((p) => ({ ...p, visit_type: id, company_name: "" }))}
              />
            </section>

            <section className="section">
              <SectionTitle icon={Building2} title="Where and whom" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Unit / office" required className="sm:col-span-2">
                  <Select searchable name="unit_id" required value={formData.unit_id}
                    onChange={(e) => setFormData((p) => ({ ...p, unit_id: e.target.value }))} aria-label="Unit">
                    <option value="">Select the unit you are visiting</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.city ? ` (${u.city})` : ""}</option>)}
                  </Select>
                </Field>
                <Field label="Department" required>
                  <Select searchable name="department_id" required value={formData.department_id}
                    onChange={(e) => setFormData((p) => ({ ...p, department_id: e.target.value }))}
                    disabled={!formData.unit_id || loadingDepts} aria-label="Department">
                    <option value="">
                      {!formData.unit_id ? "Select a unit first" : loadingDepts ? "Loading departments…" : "Select department"}
                    </option>
                    {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </Select>
                </Field>
                <Field label="Host officer" required>
                  <Select searchable name="host_user_id" required value={formData.host_user_id}
                    onChange={(e) => setFormData((p) => ({ ...p, host_user_id: e.target.value }))}
                    disabled={!formData.department_id || loadingHosts} aria-label="Host officer">
                    <option value="">
                      {!formData.department_id ? "Select a department first" : loadingHosts ? "Loading officers…" : "Select host officer"}
                    </option>
                    {hosts.map((h) => (
                      <option key={h.id} value={h.id}>{h.full_name}{h.designation_name ? ` (${h.designation_name})` : ""}</option>
                    ))}
                  </Select>
                </Field>
              </div>
            </section>

            <section className="section">
              <SectionTitle icon={Calendar} title="When and why" />
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
                <Field label="Date of visit" htmlFor="pr-date" required>
                  <input id="pr-date" type="date" required value={formData.visit_date} min={getISTDateString()}
                    onChange={(e) => setFormData((p) => ({ ...p, visit_date: e.target.value }))} className="control tabular" />
                </Field>
                <Field label="Expected time" hint="Optional">
                  <div className="flex items-center gap-2">
                    <input
                      type="time"
                      aria-label="From"
                      value={formData.visit_start_time}
                      onChange={(e) => {
                        const val = e.target.value;
                        setFormData((p) => {
                          const next = { ...p, visit_start_time: val };
                          if (val) {
                            const [h, m] = val.split(":").map(Number);
                            const total = h * 60 + m + 30;
                            const auto30 = `${String(Math.floor(total / 60) % 24).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
                            if (!p.visit_end_time || p.visit_end_time <= val) next.visit_end_time = auto30;
                          }
                          return next;
                        });
                      }}
                      className="control tabular"
                    />
                    <span className="text-muted text-[12px] shrink-0">to</span>
                    <input type="time" aria-label="Until" value={formData.visit_end_time}
                      onChange={(e) => setFormData((p) => ({ ...p, visit_end_time: e.target.value }))} className="control tabular" />
                  </div>
                </Field>
                {formData.visit_type === "BUSINESS" && (
                  <Field label="Company / organisation" htmlFor="pr-company" required className="sm:col-span-2 animate-fade-in">
                    <input id="pr-company" type="text" required value={formData.company_name}
                      onChange={(e) => setFormData((p) => ({ ...p, company_name: e.target.value }))}
                      placeholder="e.g. Bharat Heavy Electricals Ltd." className="control" />
                  </Field>
                )}
                <Field label="Purpose of visit" htmlFor="pr-purpose" required className="sm:col-span-2">
                  <textarea id="pr-purpose" required rows={2} minLength={5} value={formData.purpose}
                    onChange={(e) => setFormData((p) => ({ ...p, purpose: e.target.value }))}
                    placeholder="e.g. Technical review meeting, equipment inspection" className="control resize-none" />
                </Field>
              </div>
            </section>

            <div className="mt-6 pt-4 border-t border-line flex flex-wrap gap-2">
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? <Loader2 size={14} className="animate-spin" /> : null}
                {submitting ? "Sending the request…" : <>Send visit request <ArrowRight size={14} /></>}
              </button>
              <button type="button" onClick={toPortal} className="btn-outline">Cancel</button>
            </div>
          </div>
        </div>
      </form>
    </PublicShell>
  );
}
