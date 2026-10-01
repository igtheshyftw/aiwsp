// Search across everything this user takes part in: eFiles (name, tag), items (name, comments, attachment names) and
// client records. Items of password-protected eFiles are not searched, so the eFile password still guards them.
import {all, type Row} from '../db';
import {check} from '../auth';
import {type Ctx, text, allowed} from '../ctx';
import {visible} from '../access';
import {STATUS_LABEL} from './item';
import {myClientIds} from './client';

const like = (q: string) => `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;

export const searchActions: Record<string, (c: Ctx, b: any) => any> = {
 'search'(c, b) {
  const q = text(b.q, 100); check(q.length >= 2, 'Type at least 2 characters.');
  const p = like(q); const [cond, args] = visible(c);
  const efiles = all(`SELECT e.id, e.name, e.tag, e.archived, e.password<>'' AS locked FROM efile e
   WHERE ${cond} AND (e.name LIKE ? ESCAPE '\\' OR e.tag LIKE ? ESCAPE '\\') ORDER BY e.archived, e.name LIMIT 50`, ...args, p, p);
  const items = all(`SELECT i.id, i.seq, i.name, i.status, i.target_date, i.archived, i.done, i.completed_at, i.efile_id, e.name AS efile,
    CASE WHEN i.name LIKE ? ESCAPE '\\' THEN 'name' WHEN EXISTS(SELECT 1 FROM item_comment m WHERE m.item_id=i.id AND m.body LIKE ? ESCAPE '\\') THEN 'comment' ELSE 'attachment' END AS matched
   FROM item i JOIN efile e ON e.id=i.efile_id
   WHERE ${cond} AND e.password='' AND (i.name LIKE ? ESCAPE '\\' OR CAST(i.seq AS TEXT)=?
    OR EXISTS(SELECT 1 FROM item_comment m WHERE m.item_id=i.id AND m.body LIKE ? ESCAPE '\\')
    OR EXISTS(SELECT 1 FROM item_attachment a WHERE a.item_id=i.id AND a.filename LIKE ? ESCAPE '\\'))
   ORDER BY i.archived, i.updated_at DESC LIMIT 100`, p, p, ...args, p, q.replace(/^#/, ''), p, p)
   .map((r: Row) => ({...r, status_label: r.completed_at ? 'Completed' : STATUS_LABEL[r.status]}));
  const mine = new Set(myClientIds(c.user.id));
  const clients = all(`SELECT id, code, name_cn, name_en FROM client WHERE company_id=? AND (code LIKE ? ESCAPE '\\' OR name_cn LIKE ? ESCAPE '\\' OR name_en LIKE ? ESCAPE '\\') ORDER BY code LIMIT 50`, c.companyId, p, p, p)
   .filter(r => allowed(c, 'client') || mine.has(r.id));
  return {q, efiles, items, clients};
 },
};
