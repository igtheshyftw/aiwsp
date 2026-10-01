// Scheduled work, run once a day after REMINDER_HOUR (firm's time zone, APP_TIMEZONE):
// - items due within DUE_SOON_DAYS, and overdue items (first day, then weekly), are reminded to the people carrying them;
// - approval steps waiting longer than APPROVAL_REMIND_DAYS are reminded to their eligible approvers (and repeated at that interval);
// - temporary accounts are reminded to their responsible administrator a week before they expire, and their sessions end on expiry.
// Each reminder is sent once per key, so a restart or a second run on the same day sends nothing twice.
import {all, get, run, now, type Row} from './db';
import {notify, OPEN_ITEM, today} from './ctx';
import {stepState, adminsOf, itemPeople} from './actions/item';

const num = (v: string | undefined, d: number) => Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d;
const DUE_SOON_DAYS = num(process.env.DUE_SOON_DAYS, 2);
const APPROVAL_REMIND_DAYS = Math.max(1, num(process.env.APPROVAL_REMIND_DAYS, 3));
const REMINDER_HOUR = num(process.env.REMINDER_HOUR, 8);
const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86400000);
// Send a reminder once per key.
function once(key: string, send: () => void) {
 if (get('SELECT 1 FROM reminder WHERE key=?', key)) return 0;
 run('INSERT INTO reminder(key,at) VALUES(?,?)', key, now()); send(); return 1;
}

export function runDaily() {
 const t = today(); let sent = 0;
 const efile = (id: string) => get('SELECT * FROM efile WHERE id=?', id)!;
 // Deadlines.
 for (const i of all(`SELECT i.* FROM item i JOIN efile e ON e.id=i.efile_id WHERE e.archived=0 AND ${OPEN_ITEM} AND i.target_date<>'' AND i.target_date<=?`, today(DUE_SOON_DAYS))) {
  const e = efile(i.efile_id); const late = days(i.target_date, t);
  if (late > 0) sent += once(`overdue:${i.id}:${i.target_date}:${Math.floor((late - 1) / 7)}`, () =>
   notify(late === 1 ? [...itemPeople(i, e), ...adminsOf(e)] : itemPeople(i, e), 'deadline', `Overdue by ${late} day${late === 1 ? '' : 's'} (target ${i.target_date}): ${e.name} - ${i.name}`, e.id, i.id));
  else sent += once(`due:${i.id}:${i.target_date}`, () =>
   notify(itemPeople(i, e), 'deadline', `${late === 0 ? 'Due today' : `Due in ${-late} day${late === -1 ? '' : 's'}`} (${i.target_date}): ${e.name} - ${i.name}`, e.id, i.id));
 }
 // Approvals waiting too long at one step.
 for (const i of all(`SELECT * FROM item WHERE status='pending' AND archived=0`)) {
  const e = efile(i.efile_id); const st = stepState(i, e); if (!st) continue;
  const started = st.position === 1 ? get('SELECT at FROM item_version WHERE item_id=? AND version=?', i.id, i.round)?.at
   : get('SELECT decided_at FROM item_step WHERE item_id=? AND round=? AND position=?', i.id, i.round, st.position - 1)?.decided_at;
  if (!started) continue;
  const waiting = days(started.slice(0, 10), t);
  if (waiting < APPROVAL_REMIND_DAYS) continue;
  const to = st.paused ? adminsOf(e) : st.eligible;
  sent += once(`approval:${i.id}:${i.round}:${st.position}:${Math.floor(waiting / APPROVAL_REMIND_DAYS)}`, () =>
   notify(to, 'approval', `${st.paused ? 'Paused' : 'Waiting'} ${waiting} days at step ${st.position} (${st.title}): ${e.name} - ${i.name}`, e.id, i.id));
 }
 // Temporary accounts.
 for (const u of all(`SELECT * FROM user WHERE state='normal' AND expires<>''`)) {
  const left = days(t, u.expires.slice(0, 10));
  if (left <= 0) { run('DELETE FROM sessions WHERE user_id=?', u.id); sent += once(`expired:${u.id}:${u.expires}`, () => notify([u.responsible_id], 'access', `Temporary account ${u.username} has expired.`)); }
  else if (left <= 7) sent += once(`expiring:${u.id}:${u.expires}`, () => notify([u.responsible_id], 'access', `Temporary account ${u.username} expires on ${u.expires.slice(0, 10)}. Extend it or let it lapse.`));
 }
 run('INSERT INTO job_state(name,last) VALUES(?,?) ON CONFLICT(name) DO UPDATE SET last=excluded.last', 'daily', t);
 return {date: t, sent};
}

// Check every ten minutes whether today's run is due.
export function startJobs() {
 const tick = () => {
  try {
   const hour = Number(new Intl.DateTimeFormat('en-GB', {timeZone: process.env.APP_TIMEZONE || 'Asia/Shanghai', hour: '2-digit', hourCycle: 'h23'}).format(new Date()));
   if (hour >= REMINDER_HOUR && get(`SELECT last FROM job_state WHERE name='daily'`)?.last !== today()) runDaily();
  } catch (e) { console.error('Scheduled job failed:', e instanceof Error ? e.message : e); }
 };
 tick();
 return setInterval(tick, 10 * 60 * 1000).unref();
}
export const jobState = (): Row => ({last: get(`SELECT last FROM job_state WHERE name='daily'`)?.last ?? '', due_soon_days: DUE_SOON_DAYS, approval_remind_days: APPROVAL_REMIND_DAYS, reminder_hour: REMINDER_HOUR});
