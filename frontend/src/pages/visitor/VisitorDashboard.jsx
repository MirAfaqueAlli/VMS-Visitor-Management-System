// frontend/src/pages/visitor/VisitorDashboard.jsx
// The signed-in visitor's home: every visit request they have in any unit (made
// by them, by a host, or at the gate), its status, gate pass and gate times, and
// their profile / email / password.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import toast from "react-hot-toast";
import {
  AlertCircle, Calendar, Check, Loader2, Plus, QrCode, RefreshCw, User, Mail, Lock, Clock,
} from "../../components/icons";
import Select from "../../components/Select";
import PasswordStrength from "../../components/PasswordStrength";
import { OtpField } from "../../components/PublicShell";
import {
  PageHeader, Tabs, StatStrip, Stat, Toolbar, SearchInput, Th, SkeletonRows, Status, State, Empty, KV,
  Field, Drawer, Note, SectionTitle,
} from "../../components/ui";
import useSort from "../../lib/useSort";
import usePaged from "../../lib/usePaged";
import Pagination from "../../components/shared/Pagination";
import useCountdown from "../../hooks/useCountdown";
import { fmtDate, fmtDateTime, fmtClock, fmtTime, orDash } from "../../lib/format";
import { validatePassword } from "../../utils/passwordValidator";
import { portalApi, portalError, isUpcoming, localDay } from "../../lib/visitorPortal";

const STATUS_FILTERS = [
  { value: "", label: "All statuses" },
  { value: "PENDING", label: "Waiting for approval" },
  { value: "APPROVED", label: "Approved" },
  { value: "COMPLETED", label: "Completed" },
  { value: "REJECTED", label: "Rejected" },
  { value: "CANCELLED", label: "Cancelled" },
];

const timeRange = (v) =>
  v.visit_start_time ? `${fmtTime(v.visit_start_time)}${v.visit_end_time ? `–${fmtTime(v.visit_end_time)}` : ""}` : "";

function GateCell({ v }) {
  if (v.gate_status === "ACTIVE") return <State tone="info">On premises since {fmtClock(v.check_in_at)}</State>;
  if (v.check_in_at) {
    return (
      <span className="tabular whitespace-nowrap">
        {fmtClock(v.check_in_at)}{v.check_out_at ? ` – ${fmtClock(v.check_out_at)}` : ""}
        <span className="cell-sub">{v.gate_status === "GATE_REJECTED" ? "Refused at gate" : "In – out"}</span>
      </span>
    );
  }
  return <span className="text-muted">—</span>;
}

/* ── Visit detail drawer, with the gate pass QR ─────────────────────────────── */
function VisitDrawer({ visit, onClose }) {
  const [pass, setPass] = useState(null);
  const [passError, setPassError] = useState("");
  const [loadingPass, setLoadingPass] = useState(false);

  useEffect(() => {
    if (!visit?.pass_number) return undefined;
    let cancelled = false;
    setLoadingPass(true);
    setPass(null);
    setPassError("");
    portalApi.get(`/me/visits/${visit.unit_id}/${visit.id}/pass`)
      .then((r) => { if (!cancelled) setPass(r.data.data); })
      .catch((err) => { if (!cancelled) setPassError(portalError(err, "Could not load the gate pass.")); })
      .finally(() => { if (!cancelled) setLoadingPass(false); });
    return () => { cancelled = true; };
  }, [visit]);

  if (!visit) return null;
  const decided = ["REJECTED", "CANCELLED"].includes(visit.status) && visit.decision_remarks;

  return (
    <Drawer open onClose={onClose} width={560} icon={Calendar}
      title={`${fmtDate(visit.visit_date)}${timeRange(visit) ? ` · ${timeRange(visit)}` : ""}`}
      subtitle={`${visit.unit_name}${visit.unit_city ? `, ${visit.unit_city}` : ""}`}>
      <div className="tile">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <Status value={visit.status} />
          <Status value={visit.visit_category} />
        </div>
        <KV items={[
          ["Host", orDash(visit.host_name)],
          ["Department", orDash(visit.department_name)],
          ["Purpose", orDash(visit.purpose)],
          visit.company_name && ["Company", visit.company_name],
          ["Requested", fmtDateTime(visit.created_at)],
          decided && [visit.status === "REJECTED" ? "Reason" : "Note", visit.decision_remarks],
          visit.check_in_at && ["Checked in", fmtDateTime(visit.check_in_at)],
          visit.check_out_at && ["Checked out", fmtDateTime(visit.check_out_at)],
        ]} className="!grid-cols-[100px_minmax(0,1fr)]" />
      </div>

      <div className="mt-4">
        <SectionTitle icon={QrCode} title="Gate pass" />
        {!visit.pass_number ? (
          <p className="text-[12.5px] text-muted">
            {visit.status === "PENDING"
              ? "Your gate pass is issued once the host approves the visit. You'll get it by SMS and email too."
              : "No gate pass for this visit."}
          </p>
        ) : loadingPass ? (
          <p className="text-[12.5px] text-muted flex items-center gap-1.5"><Loader2 size={13} className="animate-spin" /> Loading the pass…</p>
        ) : passError ? (
          <Note tone="danger" icon={AlertCircle}>{passError}</Note>
        ) : pass && (
          <div className="card p-4 flex flex-col sm:flex-row gap-4 items-center sm:items-start">
            {pass.qr ? (
              <img src={pass.qr} alt={`QR code for gate pass ${pass.pass_number}`} className="w-40 h-40 rounded border border-line bg-white p-1.5" />
            ) : (
              <div className="w-40 h-40 rounded border border-dashed border-line-strong flex flex-col items-center justify-center text-center text-[11.5px] text-muted px-3">
                <QrCode size={22} className="mb-1" /> The QR is shown only while the pass is valid.
              </div>
            )}
            <div className="min-w-0 space-y-1.5 text-center sm:text-left">
              <p className="group-heading">Pass number</p>
              <p className="mono text-[15px] font-semibold text-ink">{pass.pass_number}</p>
              <Status value={pass.pass_status} />
              {pass.qr && <p className="text-[12px] text-muted pt-1">Show this QR code, or tell the pass number, at the gate.</p>}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  );
}

/* ── Visits tab ──────────────────────────────────────────────────────────────── */
function VisitsTab({ onNew }) {
  const [visits, setVisits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [incomplete, setIncomplete] = useState(false);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await portalApi.get("/me/visits");
      setVisits(data.data.visits || []);
      setIncomplete(!!data.data.incomplete);
    } catch (err) {
      toast.error(portalError(err, "Could not load your visits."));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const upcoming = useMemo(
    () => visits.filter(isUpcoming).sort((a, b) => localDay(a.visit_date).localeCompare(localDay(b.visit_date))),
    [visits],
  );
  const next = upcoming.find((v) => v.status !== "PENDING") || upcoming[0];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return visits.filter((v) => {
      if (status === "APPROVED" ? !["APPROVED", "SCHEDULED"].includes(v.status) : status && v.status !== status) return false;
      if (!q) return true;
      return [v.unit_name, v.host_name, v.department_name, v.purpose, v.pass_number]
        .some((x) => String(x || "").toLowerCase().includes(q));
    });
  }, [visits, search, status]);

  const { rows: sortedRows, sort, onSort } = useSort(filtered, {
    date: (v) => `${localDay(v.visit_date)} ${v.visit_start_time || ""}`,
    unit: (v) => v.unit_name,
    host: (v) => v.host_name,
    status: (v) => v.status,
  });
  const paged = usePaged(sortedRows, 15);
  const rows = paged.rows;

  return (
    <>
      <StatStrip cols={4}>
        <Stat label="Upcoming" value={upcoming.length} loading={loading} />
        <Stat label="Waiting for approval" value={visits.filter((v) => v.status === "PENDING").length}
          tone={visits.some((v) => v.status === "PENDING") ? "warning" : undefined} loading={loading} />
        <Stat label="Completed" value={visits.filter((v) => v.status === "COMPLETED").length} loading={loading} />
        <Stat label="All visits" value={visits.length} loading={loading} />
      </StatStrip>

      {!loading && next && (
        <section className="tile mb-6 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="group-heading mb-1">Next visit</p>
            <p className="text-[16px] font-semibold text-ink">
              {fmtDate(next.visit_date)}{timeRange(next) && <span className="font-normal text-ink-2"> · {timeRange(next)}</span>}
            </p>
            <p className="text-[12.5px] text-ink-2 mt-0.5">
              {orDash(next.host_name)}{next.department_name ? `, ${next.department_name}` : ""} · {next.unit_name}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Status value={next.status} />
              {next.pass_number && <span className="mono text-[12px] text-ink-2">{next.pass_number}</span>}
            </div>
          </div>
          <button type="button" className={next.pass_number ? "btn-primary" : "btn-outline"} onClick={() => setOpen(next)}>
            {next.pass_number ? <><QrCode size={14} /> Show gate pass</> : "View details"}
          </button>
        </section>
      )}

      {incomplete && (
        <Note tone="warning" icon={AlertCircle} className="mb-3">
          Some units could not be reached just now, so this list may be missing visits. Refresh in a moment.
        </Note>
      )}

      <Toolbar count={loading ? null : filtered.length} noun={filtered.length === 1 ? "visit" : "visits"}>
        <SearchInput value={search} onChange={setSearch} placeholder="Search unit, host, purpose or pass" width={260} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ width: 190 }}>
          {STATUS_FILTERS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </Select>
        {(search || status) && <button type="button" className="btn-ghost" onClick={() => { setSearch(""); setStatus(""); }}>Clear</button>}
        <button type="button" className="btn-icon" onClick={load} disabled={loading} title="Refresh" aria-label="Refresh">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </Toolbar>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th sortKey="date" sort={sort} onSort={onSort}>Visit</Th>
              <Th sortKey="unit" sort={sort} onSort={onSort}>Unit</Th>
              <Th sortKey="host" sort={sort} onSort={onSort}>Host</Th>
              <th>Purpose</th>
              <Th sortKey="status" sort={sort} onSort={onSort}>Status</Th>
              <th>Gate</th>
              <th>Pass</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <SkeletonRows rows={5} cols={7} />
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="!p-0">
                  <Empty
                    icon={Calendar}
                    title={visits.length ? "No visits match these filters" : "No visits yet"}
                    hint={visits.length ? "Try another search or status." : "Your visit requests, gate passes and gate times will appear here."}
                    action={!visits.length && <button type="button" className="btn-primary" onClick={onNew}><Plus size={14} /> New visit request</button>}
                  />
                </td>
              </tr>
            ) : rows.map((v) => (
              <tr key={`${v.unit_id}-${v.id}`} className="is-clickable" onClick={() => setOpen(v)}>
                <td className="tabular whitespace-nowrap">
                  {fmtDate(v.visit_date)}
                  <span className="cell-sub">{timeRange(v) || "Any time"}</span>
                </td>
                <td>
                  {v.unit_name}
                  {v.unit_city && <span className="cell-sub">{v.unit_city}</span>}
                </td>
                <td>
                  {orDash(v.host_name)}
                  {v.department_name && <span className="cell-sub">{v.department_name}</span>}
                </td>
                <td className="max-w-[220px] truncate text-ink-2">{orDash(v.purpose)}</td>
                <td><Status value={v.status} /></td>
                <td><GateCell v={v} /></td>
                <td className="mono whitespace-nowrap">{v.pass_number || <span className="text-muted">—</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && <Pagination page={paged.page} totalPages={paged.totalPages} totalCount={paged.total} onPageChange={paged.setPage} />}

      {open && <VisitDrawer visit={open} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ── Profile tab ─────────────────────────────────────────────────────────────── */
function ProfileTab({ account, onAccount, onSession }) {
  const [details, setDetails] = useState({ full_name: account.full_name, address: account.address || "" });
  const [savingDetails, setSavingDetails] = useState(false);

  const [newEmail, setNewEmail] = useState("");
  const [emailSentTo, setEmailSentTo] = useState(null);
  const [emailCode, setEmailCode] = useState("");
  const [devEmailOtp, setDevEmailOtp] = useState(null);
  const [emailBusy, setEmailBusy] = useState(false);
  const emailTimer = useCountdown();

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [pwBusy, setPwBusy] = useState(false);

  const saveDetails = async (e) => {
    e.preventDefault();
    setSavingDetails(true);
    try {
      const { data } = await portalApi.put("/me", { full_name: details.full_name.trim(), address: details.address.trim() });
      onAccount(data.data);
      toast.success(data.message);
    } catch (err) {
      toast.error(portalError(err, "Could not save your details."));
    } finally {
      setSavingDetails(false);
    }
  };

  const sendEmailCode = async (e) => {
    e?.preventDefault();
    setEmailBusy(true);
    try {
      const { data } = await portalApi.post("/me/email/send", { email: newEmail.trim() });
      setEmailSentTo(newEmail.trim().toLowerCase());
      setDevEmailOtp(data.data?.dev_otp || null);
      emailTimer.start();
      toast.success(data.message);
    } catch (err) {
      toast.error(portalError(err, "Could not send the code."));
    } finally {
      setEmailBusy(false);
    }
  };
  const verifyEmail = async (e) => {
    e.preventDefault();
    setEmailBusy(true);
    try {
      const { data } = await portalApi.post("/me/email/verify", { email: emailSentTo, otp: emailCode });
      onAccount(data.data);
      setEmailSentTo(null);
      setNewEmail("");
      setEmailCode("");
      toast.success(data.message);
    } catch (err) {
      toast.error(portalError(err, "Could not verify the email."));
    } finally {
      setEmailBusy(false);
    }
  };

  const savePassword = async (e) => {
    e.preventDefault();
    if (!validatePassword(pw.next).valid) { toast.error("The new password doesn't meet the requirements yet."); return; }
    if (pw.next !== pw.confirm) { toast.error("The passwords don't match."); return; }
    setPwBusy(true);
    try {
      const { data } = await portalApi.post("/me/password", {
        current_password: account.has_password ? pw.current : undefined, new_password: pw.next,
      });
      onSession(data.data);
      setPw({ current: "", next: "", confirm: "" });
      toast.success(data.message);
    } catch (err) {
      toast.error(portalError(err, "Could not save the password."));
    } finally {
      setPwBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8 max-w-[1000px]">
      <section>
        <SectionTitle icon={User} title="Your details" />
        <form onSubmit={saveDetails} className="space-y-3">
          <Field label="Full name" htmlFor="pf-name" required>
            <input id="pf-name" className="control" value={details.full_name} required
              onChange={(e) => setDetails((d) => ({ ...d, full_name: e.target.value }))} />
          </Field>
          <Field label="Address" htmlFor="pf-address">
            <textarea id="pf-address" rows={2} maxLength={255} className="control resize-none" value={details.address}
              onChange={(e) => setDetails((d) => ({ ...d, address: e.target.value }))} />
          </Field>
          <div className="pt-1">
            <button type="submit" disabled={savingDetails} className="btn-primary">
              {savingDetails && <Loader2 size={14} className="animate-spin" />} Save details
            </button>
          </div>
        </form>
      </section>

      <section>
        <SectionTitle icon={Mail} title="Mobile and email" />
        <div className="tile">
          <KV items={[
            ["Mobile", <span key="m" className="flex flex-wrap items-center gap-2"><span className="tabular">+91 {account.phone}</span>
              {account.phone_verified ? <State tone="success">Verified</State> : <State tone="warning">Not verified</State>}</span>],
            ["Email", <span key="e" className="flex flex-wrap items-center gap-2"><span className="break-all">{orDash(account.email)}</span>
              {account.email_verified ? <State tone="success">Verified</State> : <State tone="warning">Not verified</State>}</span>],
          ]} className="!grid-cols-[64px_minmax(0,1fr)]" />
        </div>
        <p className="field-hint">Your mobile number is your account. To use a different number, register a new account.</p>

        <div className="mt-4">
          {emailSentTo ? (
            <form onSubmit={verifyEmail} className="space-y-2">
              <Field label={`Code sent to ${emailSentTo}`}>
                <OtpField value={emailCode} onChange={setEmailCode} disabled={emailBusy} autoFocus />
                {devEmailOtp && <p className="field-hint">Dev OTP: <span className="mono text-ink">{devEmailOtp}</span></p>}
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <button type="submit" disabled={emailBusy || emailCode.length !== 6} className="btn-primary">
                  {emailBusy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Verify email
                </button>
                <button type="button" className="btn-ghost" onClick={() => { setEmailSentTo(null); setEmailCode(""); }}>Cancel</button>
                {emailTimer.count > 0 ? <span className="text-[12px] text-muted tabular">Resend in {emailTimer.count}s</span>
                  : <button type="button" className="text-link text-[12px] font-medium" onClick={sendEmailCode}>Resend</button>}
              </div>
            </form>
          ) : (
            <form onSubmit={sendEmailCode} className="space-y-2">
              <Field label={account.email ? "Change email" : "Add an email"} htmlFor="pf-email">
                <div className="flex gap-2">
                  <input id="pf-email" type="email" className="control flex-1" value={newEmail} required
                    onChange={(e) => setNewEmail(e.target.value)} placeholder="name@example.com" />
                  <button type="submit" disabled={emailBusy || !newEmail.trim()} className="btn-outline">
                    {emailBusy && <Loader2 size={14} className="animate-spin" />} Send code
                  </button>
                </div>
              </Field>
            </form>
          )}
        </div>
      </section>

      <section>
        <SectionTitle icon={Lock} title={account.has_password ? "Change password" : "Set a password"} />
        {!account.has_password && (
          <p className="text-[12.5px] text-muted mb-3">With a password you can sign in with your mobile number or email, without waiting for an SMS.</p>
        )}
        <form onSubmit={savePassword} className="space-y-3 max-w-[420px]">
          {account.has_password && (
            <Field label="Current password" htmlFor="pf-cur">
              <input id="pf-cur" type="password" autoComplete="current-password" className="control" required value={pw.current}
                onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} />
            </Field>
          )}
          <div>
            <Field label="New password" htmlFor="pf-new">
              <input id="pf-new" type="password" autoComplete="new-password" className="control" required value={pw.next}
                onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} />
            </Field>
            <PasswordStrength password={pw.next} hideWhenValid />
          </div>
          <Field label="Confirm new password" htmlFor="pf-conf"
            error={pw.confirm && pw.confirm !== pw.next ? "The passwords don't match." : ""}>
            <input id="pf-conf" type="password" autoComplete="new-password" className="control" required value={pw.confirm}
              onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} />
          </Field>
          <div className="pt-1">
            <button type="submit" disabled={pwBusy || !pw.next} className="btn-primary">
              {pwBusy && <Loader2 size={14} className="animate-spin" />} {account.has_password ? "Change password" : "Set password"}
            </button>
          </div>
        </form>
        {account.has_password && <p className="field-hint mt-2">Changing it signs you out on other devices.</p>}
      </section>
    </div>
  );
}

/* ── Page ────────────────────────────────────────────────────────────────────── */
export default function VisitorDashboard({ account, onAccount, onSession }) {
  const navigate = useNavigate();
  const [tab, setTab] = useState("visits");
  const onNew = () => navigate("/public-request/new");

  return (
    <div className="animate-fade-in">
      <PageHeader
        title="My visits"
        meta={<span className="inline-flex items-center gap-1"><Clock size={12} /> Every unit, in one place</span>}
        actions={<button type="button" className="btn-primary" onClick={onNew}><Plus size={14} /> New visit request</button>}
      />
      <Tabs
        className="mb-5"
        value={tab}
        onChange={setTab}
        tabs={[{ id: "visits", label: "Visits", icon: Calendar }, { id: "profile", label: "Profile and security", icon: User }]}
      />
      {tab === "visits"
        ? <VisitsTab onNew={onNew} />
        : <ProfileTab key={account.id} account={account} onAccount={onAccount} onSession={onSession} />}
    </div>
  );
}
