// Who can see and administer an eFile.
import {get, type Row} from './db';
import {check, fail} from './auth';
import {type Ctx, text} from './ctx';

// SQL condition (on alias e) for eFiles the user takes part in, with its parameters.
export function membership(c: Ctx): [string, any[]] {
 const u = c.user.id;
 return [`(e.created_by=?
  OR e.id IN (SELECT efile_id FROM efile_member WHERE user_id=?)
  OR e.id IN (SELECT eg.efile_id FROM efile_group eg JOIN user_group_member m ON m.group_id=eg.group_id WHERE m.user_id=? AND eg.kind='participant')
  OR e.id IN (SELECT efile_id FROM efile_step_user WHERE user_id=?)
  OR e.id IN (SELECT efile_id FROM process_stage WHERE executor_id=?)
  OR e.id IN (SELECT efile_id FROM efile_share WHERE user_id=?))`, [u, u, u, u, u, u]];
}
// eFiles the user can open: their own, plus every eFile of their company for system and Administrator-level users.
export function visible(c: Ctx): [string, any[]] {
 const [m, params] = membership(c);
 return [`((e.company_id=? AND (? OR ?)) OR ${m})`, [c.companyId, c.sys ? 1 : 0, c.user.level === 'Administrator' ? 1 : 0, ...params]];
}

export function role(c: Ctx, e: Row): 'admin' | 'member' | '' {
 if (e.created_by === c.user.id || (c.sys && e.company_id === c.companyId)) return 'admin';
 if (get("SELECT 1 FROM efile_member WHERE efile_id=? AND user_id=? AND kind='admin'", e.id, c.user.id)) return 'admin';
 const [cond, params] = visible(c);
 return get(`SELECT 1 FROM efile e WHERE e.id=? AND ${cond}`, e.id, ...params) ? 'member' : '';
}

export function efile(c: Ctx, id: any, need: 'member' | 'admin' = 'member') {
 const e = get('SELECT * FROM efile WHERE id=?', text(id, 64)); if (!e) fail('eFile is unavailable.');
 const r = role(c, e); check(r && (need === 'member' || r === 'admin'), need === 'admin' ? 'Only eFile administrators can do this.' : 'eFile is unavailable.');
 return {...e, role: r} as Row;
}
