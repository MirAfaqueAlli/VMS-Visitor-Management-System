// frontend/src/pages/visitor/VisitorPortal.jsx
// /public-request — the visitor portal. Signed out: sign in / register (AuthLayout).
// Signed in: finish the account if needed (verify mobile, link + verify email,
// optional password), then the visitor's dashboard.
import { useCallback, useEffect, useState } from "react";
import toast from "react-hot-toast";
import PublicShell from "../../components/PublicShell";
import { Spinner } from "../../components/ui";
import VisitorSignIn from "./VisitorSignIn";
import VisitorComplete from "./VisitorComplete";
import VisitorDashboard from "./VisitorDashboard";
import {
  portalApi, getVisitorSession, setVisitorSession, clearVisitorSession, SESSION_ENDED_EVENT,
} from "../../lib/visitorPortal";

// The optional "set a password" step is offered once per browser session
const promptKey = (id) => `vms_portal_password_prompted:${id}`;
const wasPrompted = (id) => { try { return sessionStorage.getItem(promptKey(id)) === "1"; } catch { return true; } };
const markPrompted = (id) => { try { sessionStorage.setItem(promptKey(id), "1"); } catch { /* private mode */ } };

export default function VisitorPortal() {
  const [phase, setPhase] = useState(() => (getVisitorSession() ? "loading" : "signin"));
  const [account, setAccount] = useState(null);
  const [pending, setPending] = useState([]);
  const [prompted, setPrompted] = useState(false);

  const applyProfile = useCallback(({ account: a, pending: p }) => {
    setAccount(a);
    setPending(p || []);
    setPrompted(wasPrompted(a.id));
  }, []);

  // Restore a saved session
  useEffect(() => {
    if (phase !== "loading") return;
    portalApi.get("/me")
      .then((r) => { applyProfile(r.data.data); setPhase("ready"); })
      .catch(() => { clearVisitorSession(); setPhase("signin"); });
  }, [phase, applyProfile]);

  // Session expired / password changed elsewhere
  useEffect(() => {
    const onEnded = () => {
      setPhase("signin");
      setAccount(null);
      toast.error("Your session ended. Please sign in again.");
    };
    window.addEventListener(SESSION_ENDED_EVENT, onEnded);
    return () => window.removeEventListener(SESSION_ENDED_EVENT, onEnded);
  }, []);

  const onSignedIn = (data, message) => {
    setVisitorSession(data.session_token);
    applyProfile(data);
    setPhase("ready");
    if (message) toast.success(message);
  };
  /** A new session token (after a password change) plus the fresh profile. */
  const onSession = (data) => {
    setVisitorSession(data.session_token);
    applyProfile(data);
  };
  const signOut = () => {
    clearVisitorSession();
    setAccount(null);
    setPhase("signin");
  };
  const finishSetup = () => {
    markPrompted(account.id);
    setPrompted(true);
  };

  const needsSetup = account && (pending.length > 0 || (!account.has_password && !prompted));

  // Signed out: the sign-in / registration screens use the staff sign-in layout
  if (phase === "signin") return <VisitorSignIn onSignedIn={onSignedIn} />;

  return (
    <PublicShell account={phase === "ready" ? account : null} onSignOut={signOut}>
      {phase === "loading" && <Spinner label="Opening your account…" />}
      {phase === "ready" && account && (needsSetup ? (
        <VisitorComplete account={account} pending={pending} onUpdated={applyProfile} onSession={onSession} onDone={finishSetup} />
      ) : (
        <VisitorDashboard account={account} onAccount={applyProfile} onSession={onSession} />
      ))}
    </PublicShell>
  );
}
