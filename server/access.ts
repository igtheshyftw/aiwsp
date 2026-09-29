// Who can see and administer an eFile. Access comes only from membership of that eFile:
// administrator or user-management rights never grant it by themselves (docs/aiwsp/urgent-functions.md).
import {all, get, type Row} from './db';
import {check, fail, live} from './auth';
import {type Ctx, text, allowed, companyAdmin} from './ctx';

// SQL condition (on alias e) for eFiles the user takes part in, with its parameters.
export function visible(c: Ctx): [string, any[]] {
 const u = c.user.id;
 return [`(e.id IN (SELECT efile_id FROM efile_member WHERE user_id=? AND kind IN ('participant','admin'))
  OR e.id IN (SELECT eg.efile_id FROM efile_group eg JOIN user_group_member m ON m.group_id=eg.group_id WHERE m.user_id=? AND eg.kind='participant')
  OR e.id IN (SELECT efile_id FROM efile_step_user WHERE user_id=?)
  OR e.id IN (SELECT efile_id FROM process_stage WHERE executor_id=?)
  OR e.id IN (SELECT efile_id FROM efile_share WHERE user_id=?))`, [u, u, u, u, u]];
}

// An eFile always keeps an administrator: its live eFile Admins, or else the company's Chief Admin / System Admin.
export function liveAdmins(efileId: string) {
 return all(`SELECT u.*, c.status AS company_status FROM user u JOIN efile_member m ON m.user_id=u.id AND m.kind='admin' JOIN company c ON c.id=u.company_id WHERE m.efile_id=?`, efileId).filter(u => live(u, u.company_status));
}

export type Right = 'admin' | 'edit' | 'view' | '';
export function role(c: Ctx, e: Row): Right {
 const u = c.user.id;
 if (get(`SELECT 1 FROM efile_member WHERE efile_id=? AND user_id=? AND kind='admin'`, e.id, u)) return 'admin';
 if (!liveAdmins(e.id).length && companyAdmin(c, e.company_id)) return 'admin';
 const rights = [
  ...all(`SELECT rights FROM efile_member WHERE efile_id=? AND user_id=? AND kind='participant'`, e.id, u).map(r => r.rights),
  ...all(`SELECT eg.rights FROM efile_group eg JOIN user_group_member m ON m.group_id=eg.group_id WHERE eg.efile_id=? AND eg.kind='participant' AND m.user_id=?`, e.id, u).map(r => r.rights),
 ];
 if (rights.includes('edit')) return 'edit';
 if (rights.length || get('SELECT 1 FROM efile_step_user WHERE efile_id=? AND user_id=?', e.id, u) || get('SELECT 1 FROM process_stage WHERE efile_id=? AND executor_id=?', e.id, u)
  || get('SELECT 1 FROM efile_share WHERE efile_id=? AND user_id=?', e.id, u)) return 'view';
 return '';
}

export function efile(c: Ctx, id: any, need: 'view' | 'edit' | 'admin' = 'view') {
 const e = get('SELECT * FROM efile WHERE id=?', text(id, 64)); if (!e) fail('eFile is unavailable.');
 const r = role(c, e);
 const rank = {'': 0, view: 1, edit: 2, admin: 3};
 check(rank[r] >= rank[need], need === 'admin' ? 'Only eFile administrators can do this.' : need === 'edit' ? 'You can view this eFile but not change it.' : 'eFile is unavailable.');
 return {...e, role: r} as Row;
}
// Function rights inside an eFile: the eFile role and the user's level must both allow it.
export function may(c: Ctx, e: Row, action: 'createItem' | 'edit' | 'download' | 'export' | 'submit' | 'approve') {
 if (!e.role) return false;
 if (action === 'download' || action === 'export' || action === 'approve') return allowed(c, action);
 return ['admin', 'edit'].includes(e.role) && allowed(c, action);
}
