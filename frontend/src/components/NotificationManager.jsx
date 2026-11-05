// frontend/src/components/NotificationManager.jsx
/**
 * NotificationManager
 *
 * Mounted once inside AppLayout. Invisible component that:
 *  1. Watches all relevant socket events
 *  2. Fires OS-level notifications (visible even when browser is minimised)
 *  3. Clicking the notification navigates to the correct page
 *
 * Events handled (must match backend socketManager emit names exactly):
 *  visit:request:new    → host/employee: new approval request waiting
 *  visit:approved       → requester: their visit/spot request was approved
 *  visit:rejected       → requester: their visit/spot request was rejected
 *  visit:checkin        → host & security/receptionist: visitor checked in
 *  visit:checkout       → security + host: visitor checked out
 *  visit:cancelled      → security: a visit expected today was cancelled
 *
 * The same events also arrive as server push (services/push.service) — shown by the
 * service worker when VMS isn't in view, so they reach a minimised app or a phone.
 */

import { useCallback, useEffect } from 'react';
import useSocketEvent from '../hooks/useSocketEvent';
import useWebNotification from '../hooks/useWebNotification';
import useAuth from '../hooks/useAuth';
import { subscribePush } from '../lib/push';

// Request detail link; cross_unit_id = the request lives in another unit's DB
const requestLink = (data) => {
  const base = `/requests/${data.visit_request_id ?? ''}`;
  return data.cross_unit_id ? `${base}?unit_id=${data.cross_unit_id}` : base;
};

export default function NotificationManager() {
  const { notify, permission } = useWebNotification();
  const { isSecurity, isReceptionist } = useAuth();

  // Notifications allowed (now, or later from the browser's site settings) → this browser also
  // gets push, so alerts arrive while VMS is minimised / closed and on phones
  useEffect(() => {
    if (permission === 'granted') subscribePush();
  }, [permission]);

  // ── Helper: build notification options with a click-URL ─────────────────
  const makeOpts = (tag, url) => ({
    tag,
    data: { url },
    requireInteraction: false,
  });

  // ── New visit request needs your approval ───────────────────────────────
  // Received by: the HOST employee when SPOT / PUBLIC / EMPLOYEE_VISIT arrives
  useSocketEvent('visit:request:new', useCallback((data) => {
    const isSpot   = data.visit_category === 'SPOT';
    const isPublic = ['PERSONAL_VISIT', 'VENDOR'].includes(data.visit_category);
    const title = isSpot
      ? 'Walk-in visitor waiting'
      : isPublic
        ? 'New public visit request'
        : 'New request to approve';
    const body = isSpot
      ? `${data.visitor_name ?? 'A visitor'} is at the gate/reception waiting for your approval.`
      : `${data.visitor_name ?? 'A visitor'} has requested a visit${data.visit_date ? ` on ${data.visit_date}` : ''}.`;
    notify(title, body, makeOpts('visit-request-new', '/approvals'));
  }, [notify]), [notify]);

  // ── Request approved or hosted ──────────────────────────────────────────
  // Received by: employee who initiated the visit (or employee who was hosted, or security for SPOT)
  useSocketEvent('visit:approved', useCallback((data) => {
    const isSpot   = data.visit_category === 'SPOT';
    const isHosted = data.is_hosted;
    const title  = isHosted ? 'You were hosted for a visit' : isSpot ? 'Spot visit approved' : 'Visit approved';
    const body   = isHosted
      ? `${data.approved_by || data.host_name || 'A colleague'} has hosted you as a visitor for a visit on ${data.visit_date ?? ''}${data.pass_number ? `. Gate Pass: ${data.pass_number}` : ''}.`
      : isSpot
        ? `The spot visit you initiated has been approved${data.approved_by ? ` by ${data.approved_by}` : ''}.`
        : `Your visit on ${data.visit_date ?? ''} has been approved${data.approved_by ? ` by ${data.approved_by}` : ''}${data.pass_number ? `. Gate Pass: ${data.pass_number}` : ''}.`;
    const targetUrl = data.pass_number ? `/passes/pass/${data.pass_number}` : requestLink(data);
    notify(title, body, makeOpts('visit-approved', targetUrl));
  }, [notify]), [notify]);

  // ── Request rejected ────────────────────────────────────────────────────
  // Received by: employee who initiated the visit (or security for SPOT)
  useSocketEvent('visit:rejected', useCallback((data) => {
    const isSpot = data.visit_category === 'SPOT';
    const title  = isSpot ? 'Spot visit rejected' : 'Visit request rejected';
    const body   = isSpot
      ? `The spot visit you initiated was rejected${data.remarks ? `: "${data.remarks}"` : '.'}`
      : `Your visit request was rejected${data.remarks ? `: "${data.remarks}"` : '.'}`;
    notify(title, body, {
      ...makeOpts('visit-rejected', requestLink(data)),
      requireInteraction: true,
    });
  }, [notify]), [notify]);

  // ── Visitor checked in ──────────────────────────────────────────────────
  // Received by: the host (their visitor arrived) + gate/security staff
  useSocketEvent('visit:checkin', useCallback((data) => {
    const isGateStaff = isSecurity || isReceptionist;
    notify(
      'Visitor arrived',
      `${data.visitor_name ?? 'A visitor'} has checked in${data.host_name ? ` to meet ${data.host_name}` : ''}.`,
      makeOpts('visit-checkin', isGateStaff ? '/gate' : '/dashboard')
    );
  }, [notify, isSecurity, isReceptionist]), [notify, isSecurity, isReceptionist]);

  // ── Visitor checked out ─────────────────────────────────────────────────
  // Received by: gate/security staff
  useSocketEvent('visit:checkout', useCallback((data) => {
    notify(
      'Visitor checked out',
      `${data.visitor_name ?? 'A visitor'} has checked out.`,
      makeOpts('visit-checkout', '/gate')
    );
  }, [notify]), [notify]);

  // ── A visit expected today was cancelled ─────────────────────────────────
  // Received by: gate/security staff
  useSocketEvent('visit:cancelled', useCallback((data) => {
    notify(
      'Visit cancelled',
      `The visit of ${data.visitor_name ?? 'a visitor'} today was cancelled.`,
      makeOpts(`cancel-${data.visit_request_id}`, '/dashboard')
    );
  }, [notify]), [notify]);

  return null;
}
