// frontend/src/components/Layout/NotifyPermissionBar.jsx
// Asks once per session to enable desktop notifications (until the user enables them).
import { useState } from 'react';
import toast from 'react-hot-toast';
import useWebNotification from '../../hooks/useWebNotification';
import { BellOff, X } from '../icons';

export default function NotifyPermissionBar() {
  const { permission, requestPermission } = useWebNotification();
  // 'vms-notif-granted' is set permanently when the user grants; a dismiss lasts
  // only for this session, so the bar comes back on the next sign-in
  const alreadyGranted = (() => { try { return localStorage.getItem('vms-notif-granted') === '1'; } catch { return false; } })();
  const [dismissed, setDismissed] = useState(false);

  if (alreadyGranted || permission === 'granted' || dismissed) return null;

  const enable = async () => {
    const result = await requestPermission();
    if (result === 'granted') {
      try { localStorage.setItem('vms-notif-granted', '1'); } catch { /* storage blocked */ }
      toast.success('Desktop notifications enabled.');
    }
    setDismissed(true);
  };

  return (
    <div className="tile flex flex-wrap items-center gap-3 mb-5 !py-2.5">
      <BellOff size={15} className="text-ink-2 shrink-0" />
      <span className="flex-1 min-w-[220px] text-[12.5px] text-ink-2">
        Turn on desktop notifications to get approval alerts while this tab is in the background.
      </span>
      <button type="button" className="btn-primary btn-sm" onClick={enable}>Enable notifications</button>
      <button type="button" className="btn-icon" onClick={() => setDismissed(true)} aria-label="Dismiss" title="Dismiss">
        <X size={14} />
      </button>
    </div>
  );
}
