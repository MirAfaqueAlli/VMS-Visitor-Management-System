// frontend/src/components/Layout/NotifyPermissionBar.jsx
// Asks to turn on system notifications (approval alerts, visitor arrivals) — on this
// computer and on phones, even when the app is minimised or closed.
//   allowed  → hidden (and this browser is subscribed for push)
//   not asked yet → "Enable notifications"
//   blocked in the browser → how to allow them (the button can't help any more)
// Closing the bar hides it for 7 days on this browser.
import { useState } from 'react';
import toast from 'react-hot-toast';
import useWebNotification from '../../hooks/useWebNotification';
import { subscribePush } from '../../lib/push';
import { BellOff, X } from '../icons';

const SNOOZE_KEY = 'vms-notif-bar-snoozed-until';
const SNOOZE_DAYS = 7;

const snoozed = () => {
  try { return Number(localStorage.getItem(SNOOZE_KEY) || 0) > Date.now(); } catch { return false; }
};

export default function NotifyPermissionBar() {
  const { permission, requestPermission } = useWebNotification();
  const [hidden, setHidden] = useState(snoozed);
  const [busy, setBusy] = useState(false);

  // Read the browser directly too: it is the source of truth after a reload
  const current = 'Notification' in window ? Notification.permission : 'unsupported';
  if (hidden || current === 'granted' || permission === 'granted' || current === 'unsupported') return null;

  const snooze = () => {
    try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + SNOOZE_DAYS * 24 * 60 * 60 * 1000)); } catch { /* storage blocked */ }
    setHidden(true);
  };

  const enable = async () => {
    setBusy(true);
    try {
      const result = await requestPermission();
      if (result === 'granted') {
        const push = await subscribePush();
        toast.success(push
          ? 'Notifications are on — you will get them even when VMS is minimised or closed.'
          : 'Notifications are on while VMS is open in a tab.');
        setHidden(true);
      } else if (result === 'denied') {
        toast.error('Notifications are blocked. Allow them from the lock icon in the address bar.', { duration: 8000 });
      }
      // 'default' = the prompt was closed without choosing: keep offering
    } finally { setBusy(false); }
  };

  const blocked = current === 'denied' || permission === 'denied';

  return (
    <div className="tile flex flex-wrap items-center gap-3 mb-5 !py-2.5">
      <BellOff size={15} className="text-ink-2 shrink-0" />
      <span className="flex-1 min-w-[220px] text-[12.5px] text-ink-2">
        {blocked
          ? <>Notifications are blocked for VMS in this browser. To get approval and visitor alerts, click the lock icon in the address bar, set <b>Notifications</b> to <b>Allow</b>, then reload.</>
          : 'Turn on notifications to get approval and visitor alerts on this device — even when VMS is minimised or closed.'}
      </span>
      {!blocked && (
        <button type="button" className="btn-primary btn-sm" onClick={enable} disabled={busy}>Enable notifications</button>
      )}
      <button type="button" className="btn-icon" onClick={snooze} aria-label="Hide for 7 days" title="Hide for 7 days">
        <X size={14} />
      </button>
    </div>
  );
}
