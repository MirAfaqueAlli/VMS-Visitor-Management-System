// frontend/src/components/PushSetting.jsx
// "System notifications" on this device, with its one action (Turn on / Try again /
// How to allow) — just the status once they are on. Staff (every role, gate staff
// included) and, with `visitor`, visitors in the portal.
//   variant="row"     footer of the bell's notification panel
//   variant="tile"    My profile page / the portal's Profile tab
//   variant="banner"  the portal's visits page — only while notifications are off;
//                     "Not now" hides it for 14 days
import { useState } from 'react';
import { Bell, BellOff, Loader2, X } from './icons';
import usePushSetup, { PUSH_COPY, VISITOR_PUSH_COPY } from '../hooks/usePushSetup';

const SNOOZE_KEY = 'vms-visitor-push-prompt-until';
const snoozed = () => {
  try { return Number(localStorage.getItem(SNOOZE_KEY)) > Date.now(); } catch { return false; }
};

export default function PushSetting({ variant = 'row', visitor = false }) {
  const { state, busy, run } = usePushSetup({ visitor });
  const [hidden, setHidden] = useState(snoozed);
  if (state === 'unsupported') return null;
  const copy = (visitor ? VISITOR_PUSH_COPY : PUSH_COPY)[state];
  const on = state === 'on';
  const Icon = on ? Bell : BellOff;
  const tone = on ? 'tone-success' : state === 'blocked' ? 'tone-danger' : 'tone-warning';

  const button = copy.action && (
    <button type="button" onClick={run} disabled={busy}
      className="btn-primary btn-sm shrink-0">
      {busy && <Loader2 size={12} className="animate-spin" />}
      {copy.action}
    </button>
  );

  if (variant === 'banner') {
    if (state !== 'off' || hidden) return null;
    const notNow = () => {
      try { localStorage.setItem(SNOOZE_KEY, String(Date.now() + 14 * 86_400_000)); } catch { /* storage blocked */ }
      setHidden(true);
    };
    return (
      <div className="tile mb-5 flex flex-wrap sm:flex-nowrap items-center gap-3" role="region" aria-label="Notifications">
        <span className="head-chip"><Bell size={15} duo /></span>
        <div className="flex-1 min-w-[200px]">
          <p className="text-[13px] font-semibold text-ink">Get notified about your visits</p>
          <p className="text-[12px] text-ink-2 mt-0.5">
            An alert on this phone or computer when your visit is approved, declined or due today — even with the portal closed.
          </p>
        </div>
        <div className="flex items-center gap-1.5 ml-auto">
          {button}
          <button type="button" className="btn-icon" onClick={notNow} aria-label="Not now" title="Not now">
            <X size={14} />
          </button>
        </div>
      </div>
    );
  }

  if (variant === 'tile') {
    return (
      <div className="tile flex items-start gap-3">
        <span className={`head-chip ${tone}`}><Icon size={15} duo /></span>
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold text-ink">{copy.title}</p>
          <p className="text-[12px] text-ink-2 mt-0.5">{copy.text}</p>
          <p className="text-[11px] text-muted mt-1.5">Set separately on each browser and phone you use.</p>
        </div>
        {button}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-t border-line bg-surface-alt">
      <span className={`head-chip ${tone}`}><Icon size={14} duo /></span>
      <div className="flex-1 min-w-0">
        <p className="text-[12px] font-semibold text-ink">{copy.title}</p>
        <p className="text-[11px] text-muted leading-snug">{copy.text}</p>
      </div>
      {button}
    </div>
  );
}
