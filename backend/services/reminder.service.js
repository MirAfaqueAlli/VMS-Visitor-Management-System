// backend/services/reminder.service.js
'use strict';

/**
 * Daily reminders (tender 1.3: "SMS … reminders").
 *
 *  - Visitors with an APPROVED visit today get an SMS + email reminder (pass number,
 *    host, time). Each visit is claimed via visit_requests.reminder_sent_at before
 *    sending, so a visitor is never reminded twice.
 *  - Hosts with PENDING requests for today or tomorrow get one dashboard + email
 *    + SMS reminder per day.
 *  - Staff get one SMS + email listing today's approved visits: the host and the
 *    employee who raised each visit get theirs, unit admins get every visit in
 *    the unit.
 *
 * Runs once per day, the first time the scheduler ticks after REMINDER_HOUR (IST,
 * default 7). A row in vms_central.scheduled_job_runs claims the day, so with
 * several server processes (pm2 cluster) only one of them runs it.
 * Set REMINDERS_ENABLED=false to switch it off.
 */

const { centralPool, getPool } = require('./dbManager');
const { sendNotification }     = require('./notification.service');
const emailService             = require('./email.service');

const JOB_NAME       = 'daily_reminders';
const REMINDER_HOUR  = parseInt(process.env.REMINDER_HOUR || '7', 10);
const CHECK_EVERY_MS = 10 * 60 * 1000;

/** Current IST calendar date (YYYY-MM-DD) and hour (0–23). */
function istDateAndHour(d = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', hourCycle: 'h23',
    }).formatToParts(d).map(p => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: parseInt(parts.hour, 10) };
}

/**
 * One SMS + email per staff member listing today's approved visits: hosts and
 * requesters get their own, unit admins get all of the unit's. A visit where the
 * staff member is the visitor themself (employee visit) is left out of their list.
 * Returns the number of people reminded.
 */
async function remindStaffOfTodaysVisits(db, unit) {
  const [visits] = await db.query(
    `SELECT vr.id, vr.host_user_id, vr.requester_user_id, vr.visitor_email,
            COALESCE(vr.visitor_name, vr.company_name, 'Visitor') AS visitor,
            vr.visit_start_time, h.full_name AS host_name, gp.pass_number
     FROM visit_requests vr
     JOIN users h ON h.id = vr.host_user_id
     LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
     WHERE vr.status = 'APPROVED' AND vr.visit_date = CURDATE()
     ORDER BY vr.visit_start_time IS NULL, vr.visit_start_time`
  );
  if (!visits.length) return 0;

  const ids = [...new Set(visits.flatMap(v => [v.host_user_id, v.requester_user_id]).filter(Boolean))];
  const [staff] = await db.query(
    `SELECT id, full_name, email, phone, role_type FROM users
     WHERE is_active = 1 AND deleted_at IS NULL AND (role_type = 'unit_admin' OR id IN (?))`,
    [ids]
  );

  let reminded = 0;
  for (const s of staff) {
    const isAdmin = s.role_type === 'unit_admin';
    const mine = visits.filter(v =>
      (isAdmin || v.host_user_id === s.id || v.requester_user_id === s.id)
      && !(s.email && v.visitor_email && s.email.toLowerCase() === v.visitor_email.toLowerCase()));
    if (!mine.length || (!s.email && !s.phone)) continue;

    const list = mine.map(v => ({
      visitor: v.visitor,
      time:    v.visit_start_time ? String(v.visit_start_time).slice(0, 5) : null,
      host:    v.host_name,
      pass:    v.pass_number,
    }));
    const first = list[0];
    const sms = list.length === 1
      ? `VMS reminder: You have a visit today - ${first.visitor}${first.time ? ` at ${first.time}` : ''}${first.pass ? `. Gate Pass: ${first.pass}` : ''}.`
      : isAdmin
        ? `VMS reminder: ${list.length} approved visits are scheduled today at ${unit.name}. See VMS for details.`
        : `VMS reminder: You have ${list.length} visits today: ${list.slice(0, 3).map(v => v.visitor).join(', ')}${list.length > 3 ? ' and more' : ''}. See VMS for details.`;

    if (s.phone) {
      await sendNotification({ db, recipientUserId: s.id, recipientPhone: s.phone, type: 'SMS', message: sms });
    }
    if (s.email) {
      const tmpl = emailService.staffVisitsTodayTemplate(s.full_name, unit.name, list, isAdmin);
      await sendNotification({ db, recipientUserId: s.id, recipientEmail: s.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
    }
    reminded++;
  }
  return reminded;
}

/** Sends today's reminders for every active unit. Returns counts. */
async function runDailyReminders() {
  const [units] = await centralPool.query(
    "SELECT id, name, db_name FROM units WHERE is_active = 1 AND db_status = 'ACTIVE'"
  );
  let visitorReminders = 0;
  let hostReminders    = 0;
  let staffReminders   = 0;

  for (const unit of units) {
    const db = getPool(unit.db_name);
    try {
      // ── 1. Visitors with an approved visit today ──────────────────────────
      const [visits] = await db.query(
        `SELECT vr.id, vr.visitor_name, vr.company_name, vr.visitor_phone, vr.visitor_email, vr.vendor_email,
                vr.visit_date, vr.visit_start_time, h.full_name AS host_name, gp.pass_number
         FROM visit_requests vr
         JOIN users h ON h.id = vr.host_user_id
         LEFT JOIN gate_passes gp ON gp.visit_request_id = vr.id
         WHERE vr.status = 'APPROVED' AND vr.visit_date = CURDATE() AND vr.reminder_sent_at IS NULL`
      );
      for (const v of visits) {
        // Claim first: a crash or a second process can never send it twice
        const [claim] = await db.query(
          'UPDATE visit_requests SET reminder_sent_at = NOW() WHERE id = ? AND reminder_sent_at IS NULL', [v.id]
        );
        if (claim.affectedRows === 0) continue;

        const name = v.visitor_name || v.company_name || 'Visitor';
        const time = v.visit_start_time ? ` at ${String(v.visit_start_time).slice(0, 5)}` : '';
        const pass = v.pass_number ? ` Gate pass: ${v.pass_number}.` : '';
        if (v.visitor_phone) {
          await sendNotification({
            db, visitRequestId: v.id, recipientPhone: v.visitor_phone, type: 'SMS',
            message: `VMS reminder: your visit to ${unit.name} is today${time} (host: ${v.host_name}).${pass} Please carry a photo ID.`,
          });
        }
        const email = v.visitor_email || v.vendor_email;
        if (email) {
          const tmpl = emailService.visitReminderTemplate(name, v.host_name, unit.name, v.visit_date, v.visit_start_time, v.pass_number);
          await sendNotification({ db, visitRequestId: v.id, recipientEmail: email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
        }
        visitorReminders++;
      }

      // ── 2. Hosts with requests for today/tomorrow still awaiting approval ──
      const [pending] = await db.query(
        `SELECT vr.host_user_id, h.full_name, h.email, h.phone, COUNT(*) AS pending_count
         FROM visit_requests vr
         JOIN users h ON h.id = vr.host_user_id
         WHERE vr.status = 'PENDING'
           AND vr.visit_date BETWEEN CURDATE() AND CURDATE() + INTERVAL 1 DAY
           AND h.is_active = 1 AND h.deleted_at IS NULL
         GROUP BY vr.host_user_id, h.full_name, h.email, h.phone`
      );
      for (const p of pending) {
        const count = Number(p.pending_count);
        await sendNotification({
          db, recipientUserId: p.host_user_id, type: 'DASHBOARD',
          message: `Reminder: ${count} visit request(s) for today/tomorrow are awaiting your approval.`,
        });
        if (p.email) {
          const tmpl = emailService.pendingApprovalsReminderTemplate(p.full_name, count);
          await sendNotification({ db, recipientUserId: p.host_user_id, recipientEmail: p.email, type: 'EMAIL', subject: tmpl.subject, message: tmpl.html });
        }
        if (p.phone) {
          await sendNotification({ db, recipientUserId: p.host_user_id, recipientPhone: p.phone, type: 'SMS',
            message: `VMS reminder: ${count} visit request(s) for today/tomorrow are awaiting your approval. Please approve or reject in VMS.` });
        }
        hostReminders++;
      }

      // ── 3. Staff: today's approved visits (one message per person) ─────────
      staffReminders += await remindStaffOfTodaysVisits(db, unit);
    } catch (err) {
      console.error(`[Reminders] Unit ${unit.db_name} failed:`, err.message);
    }
  }

  return { visitorReminders, hostReminders, staffReminders };
}

/** Claims today's run (once per day across all processes) and runs it. */
async function tick() {
  try {
    const { date, hour } = istDateAndHour();
    if (hour < REMINDER_HOUR) return;

    const [claim] = await centralPool.query(
      'INSERT IGNORE INTO scheduled_job_runs (job_name, run_date) VALUES (?, ?)', [JOB_NAME, date]
    );
    if (claim.affectedRows !== 1) return; // already run today (here or by another process)

    const summary = await runDailyReminders();
    await centralPool.query(
      'UPDATE scheduled_job_runs SET finished_at = NOW(), summary = ? WHERE job_name = ? AND run_date = ?',
      [JSON.stringify(summary), JOB_NAME, date]
    );
    console.log(`[Reminders] ${date}: ${summary.visitorReminders} visitor, ${summary.hostReminders} pending-approval and ${summary.staffReminders} staff visit-day reminder(s) sent.`);
  } catch (err) {
    console.error('[Reminders] Run failed:', err.message);
  }
}

/** Call once after the server starts. */
function startReminderScheduler() {
  if (process.env.REMINDERS_ENABLED === 'false') {
    console.log('[Reminders] Disabled (REMINDERS_ENABLED=false).');
    return;
  }
  setTimeout(tick, 30 * 1000).unref();          // first check shortly after startup
  setInterval(tick, CHECK_EVERY_MS).unref();
}

module.exports = { startReminderScheduler, runDailyReminders };
