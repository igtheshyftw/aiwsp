// IMS → Reports: workload and progress across the eFiles this user takes part in (access comes only from membership,
// so a report never shows work the viewer could not open). Period filters "completed" figures and approval times.
import {all, get, type Row} from '../db';
import {type Ctx, date, text, userLabel, today} from '../ctx';
import {visible} from '../access';

const isOpen = (i: Row) => !i.archived && !i.done && !['approved', 'rejected'].includes(i.status);
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / 86400000;

export const reportActions: Record<string, (c: Ctx, b: any) => any> = {
 'report.work'(c, b) {
  const to = date(b.to, 'To') || today(), from = date(b.from, 'From') || today(-90);
  const clientId = text(b.clientId, 64);
  const [cond, args] = visible(c); const t = today(), soon = today(7);
  const items = all(`SELECT i.*, e.name AS efile, e.client_id, cl.code AS client_code, cl.name_cn AS client_name,
    (SELECT MAX(s.decided_at) FROM item_step s WHERE s.item_id=i.id AND s.round=i.round) AS approved_at,
    (SELECT v.at FROM item_version v WHERE v.item_id=i.id AND v.version=i.round) AS submitted_at
   FROM item i JOIN efile e ON e.id=i.efile_id LEFT JOIN client cl ON cl.id=e.client_id
   WHERE e.archived=0 AND i.archived=0 AND ${cond} ${clientId ? 'AND e.client_id=?' : ''} LIMIT 50000`, ...args, ...(clientId ? [clientId] : []));
  const inPeriod = (at: string | null) => !!at && at.slice(0, 10) >= from && at.slice(0, 10) <= to;
  const finishedAt = (i: Row) => i.completed_at ?? (i.status === 'approved' ? i.approved_at : null);
  const overdue = (i: Row) => isOpen(i) && !!i.target_date && i.target_date < t;
  const approvals = items.filter(i => i.status === 'approved' && inPeriod(i.approved_at) && i.submitted_at).map(i => days(i.submitted_at, i.approved_at));
  const finished = items.filter(i => inPeriod(finishedAt(i)));
  const onTime = finished.filter(i => i.target_date).filter(i => finishedAt(i)!.slice(0, 10) <= i.target_date);
  const group = (key: (i: Row) => string, label: (k: string) => string) => {
   const m = new Map<string, Row>();
   for (const i of items) {
    const k = key(i); if (!m.has(k)) m.set(k, {key: k, label: label(k), open: 0, overdue: 0, due_soon: 0, pending: 0, finished: 0});
    const r = m.get(k)!;
    if (isOpen(i)) { r.open++; if (overdue(i)) r.overdue++; else if (i.target_date && i.target_date <= soon) r.due_soon++; }
    if (i.status === 'pending') r.pending++;
    if (inPeriod(finishedAt(i))) r.finished++;
   }
   return [...m.values()].filter(r => r.open || r.finished || r.pending).sort((a, z) => z.overdue - a.overdue || z.open - a.open || a.label.localeCompare(z.label));
  };
  const names = new Map<string, string>();
  const person = (id: string) => { if (!id) return 'Not assigned'; if (!names.has(id)) { const u = get('SELECT * FROM user WHERE id=?', id); names.set(id, u ? userLabel(u) : '—'); } return names.get(id)!; };
  const waiting = items.filter(i => i.status === 'pending').map(i => {
   const s = get('SELECT position, title FROM item_step WHERE item_id=? AND round=? AND decision IS NULL ORDER BY position LIMIT 1', i.id, i.round);
   const since = s && s.position > 1 ? get('SELECT decided_at FROM item_step WHERE item_id=? AND round=? AND position=?', i.id, i.round, s.position - 1)?.decided_at : i.submitted_at;
   return {id: i.id, efile_id: i.efile_id, seq: i.seq, name: `${i.efile} - ${i.name}`, step: s ? `${s.position}: ${s.title}` : '', days: since ? Math.floor(days(since, new Date().toISOString())) : 0};
  }).sort((a, z) => z.days - a.days).slice(0, 15);
  return {from, to,
   summary: {open: items.filter(isOpen).length, overdue: items.filter(overdue).length, pending: items.filter(i => i.status === 'pending').length,
    finished: finished.length, on_time: finished.filter(i => i.target_date).length ? Math.round(100 * onTime.length / finished.filter(i => i.target_date).length) : null,
    avg_approval_days: approvals.length ? Math.round(10 * approvals.reduce((s, d) => s + d, 0) / approvals.length) / 10 : null, approvals: approvals.length},
   by_person: group(i => i.responsible_id ?? '', person),
   by_client: clientId ? [] : group(i => i.client_id ?? '', k => k ? (items.find(i => i.client_id === k)!.client_code + ' ' + items.find(i => i.client_id === k)!.client_name) : 'No client'),
   by_efile: group(i => i.efile_id, k => items.find(i => i.efile_id === k)!.efile),
   waiting,
   clients: all('SELECT id, code, name_cn FROM client WHERE company_id=? ORDER BY code', c.companyId)};
 },
};
