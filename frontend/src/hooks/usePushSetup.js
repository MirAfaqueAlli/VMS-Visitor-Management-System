// frontend/src/hooks/usePushSetup.js
// System notifications on this device (every staff role, and visitors in the portal
// with { visitor: true }): where they stand and the one action that moves them on —
// turn on, or try again (none once they are on).
//   state: 'unsupported' | 'blocked' | 'off' | 'on' | 'tab-only'
//   'tab-only' = permission given, but this browser can't receive push while VMS is
//   closed (e.g. Brave without Google push services) — alerts only while a tab is open.
import { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import useWebNotification from './useWebNotification';
import { pushActive, subscribePush, visitorPushActive, subscribeVisitorPush, PUSH_CHANGE_EVENT } from '../lib/push';

export default function usePushSetup({ visitor = false } = {}) {
  const isActive  = visitor ? visitorPushActive : pushActive;
  const subscribe = visitor ? subscribeVisitorPush : subscribePush;
  const { permission, requestPermission } = useWebNotification();
  const [active, setActive] = useState(isActive);
  const [busy, setBusy] = useState(false);

  // Follow subscribe / sign-out elsewhere in the app (and other tabs)
  useEffect(() => {
    const sync = () => setActive(isActive());
    window.addEventListener(PUSH_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PUSH_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, [isActive]);

  const state =
    permission === 'unsupported' ? 'unsupported'
    : permission === 'denied'    ? 'blocked'
    : permission !== 'granted'   ? 'off'
    : active                     ? 'on'
    : 'tab-only';

  const run = async () => {
    if (busy || state === 'unsupported' || state === 'on') return;
    if (state === 'blocked') {
      toast.error('Notifications are blocked for VMS in this browser. Click the lock icon in the address bar, set Notifications to Allow, then reload.', { duration: 9000 });
      return;
    }
    setBusy(true);
    try {
      if (state === 'off' && (await requestPermission()) !== 'granted') {
        toast.error('Notifications were not allowed. You can allow them later from the lock icon in the address bar.', { duration: 7000 });
        return;
      }
      const ok = await subscribe();
      setActive(ok);
      if (!ok) {
        toast(visitor
          ? `This browser can't receive notifications. Try Chrome, Edge or Firefox (in Brave: turn on "Use Google services for push messaging").`
          : `Alerts show while VMS is open in a tab. This browser can't receive them when VMS is closed (in Brave: turn on "Use Google services for push messaging").`,
        { duration: 9000 });
        return;
      }
      toast.success('Notifications are on for this device.');
    } catch {
      toast.error('Could not turn on notifications for this device.');
    } finally {
      setBusy(false);
    }
  };

  return { state, busy, run };
}

/** Wording for each state — shared by the bell panel, account menu and profile. */
export const PUSH_COPY = {
  on:         { title: 'System notifications are on',  text: 'Alerts reach this device even when VMS is minimised or closed.', action: null },
  off:        { title: 'System notifications are off', text: 'Turn on to get alerts on this computer or phone when VMS is minimised.', action: 'Turn on' },
  'tab-only': { title: 'Only while VMS is open',        text: "This browser can't receive alerts when VMS is closed.", action: 'Try again' },
  blocked:    { title: 'Blocked in this browser',       text: 'Click the lock icon in the address bar → Notifications → Allow, then reload.', action: 'How to allow' },
};

/** The same for visitors in the portal (they have no other live alert). */
export const VISITOR_PUSH_COPY = {
  ...PUSH_COPY,
  on:         { title: 'Notifications are on',  text: 'You get an alert on this device when a visit is approved, declined, cancelled or due today — even with the portal closed.', action: null },
  off:        { title: 'Notifications are off', text: 'Turn on to get an alert on this phone or computer when your visit is approved, declined or due today.', action: 'Turn on' },
  'tab-only': { title: 'Not available in this browser', text: "This browser can't receive notifications. Try Chrome, Edge or Firefox.", action: 'Try again' },
};
