// Request context, input helpers, the AiWSP authority rules and the system log.
import {all, get, run, uid, now, type Row} from './db';
import {check, fail, live, PERMS} from './auth';

export type Ctx = {user: Row, companyId: string, sys: boolean, position: string, perms: Set<string>};

// Effective function rights: the company's level preset, adjusted per user.
export function userPerms(u: Row): Set<string> {
 const preset = get('SELECT perms FROM level WHERE company_id=? AND level=?', u.company_id, u.level);
 const set = new Set<string>(preset ? JSON.parse(preset.perms) : []);
 for (const [k, v] of Object.entries(JSON.parse(u.perms || '{}'))) if ((PERMS as readonly string[]).includes(k)) v ? set.add(k) : set.delete(k);
 return set;
}
export function context(user: Row): Ctx {
 return {user, companyId: user.company_id, sys: user.position === 'system', position: user.position, perms: userPerms(user)};
}
export const allowed = (c: Ctx, p: string) => c.perms.has(p);
export const needPerm = (c: Ctx, p: string, message?: string) => check(allowed(c, p), message);

// ---- Company authority (docs/aiwsp/urgent-functions.md, "Companies account")
const company = (id: string) => get('SELECT * FROM company WHERE id=?', id);
export function liveChief(companyId: string) {
 return all(`SELECT u.* FROM user u WHERE u.company_id=? AND u.position='chief'`, companyId).find(u => live(u)) ?? null;
}
// Chief Admin has all company-level authority; a System Admin manages a company with no Chief Admin.
export function companyAdmin(c: Ctx, companyId: string) {
 if (c.companyId === companyId && c.position === 'chief') return true;
 return c.sys && !liveChief(companyId);
}
// Users are managed by the Chief Admin and User Admins, or a System Admin when the company allows it (or has no Chief Admin).
export function managesUsers(c: Ctx, companyId: string) {
 if (c.companyId === companyId && ['chief', 'useradmin'].includes(c.position)) return true;
 return c.sys && (!!company(companyId)?.sys_manage_users || !liveChief(companyId));
}
export function managesConnections(c: Ctx, companyId: string) {
 if (c.companyId === companyId && ['chief', 'useradmin'].includes(c.position)) return true;
 return c.sys && (!!company(companyId)?.sys_manage_connections || !liveChief(companyId));
}
export const viewsLog = (c: Ctx, companyId: string) => c.sys || (c.companyId === companyId && ['chief', 'useradmin'].includes(c.position));
// The administrators to notify about a company's users: whoever manages users there.
export function userManagers(companyId: string) {
 const local = all(`SELECT * FROM user WHERE company_id=? AND position IN ('chief','useradmin')`, companyId).filter(u => live(u));
 const co = company(companyId);
 const sys = co?.sys_manage_users || !liveChief(companyId) ? all(`SELECT * FROM user WHERE position='system'`).filter(u => live(u)) : [];
 return [...local, ...sys].map(u => u.id);
}

export const text = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
export function required(v: any, label = 'Name', max = 200) { const s = text(v, max); check(s, `${label} is required.`); return s; }
export const bool = (v: any) => v ? 1 : 0;
export const ids = (v: any): string[] => Array.isArray(v) ? [...new Set(v.filter((x: any) => typeof x === 'string' && x.length <= 64))] as string[] : [];
export function date(v: any, label = 'Date') {
 const s = text(v, 10); if (!s) return '';
 check(/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)), `${label} is not a valid date.`); return s;
}
// "1,234.5" -> 123450 cents. Blank stays blank (null); "0" is an entered zero.
export function cents(v: any, label = 'Amount'): number | null {
 const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return null;
 check(/^-?\d{1,13}(\.\d{1,2})?$/.test(s), `${label} must be a number with up to two decimal places.`);
 return Math.round(Number(s) * 100);
}
export const fmt = (v: number | null | undefined) => v === null || v === undefined ? '' : (v / 100).toFixed(2);

// Which company a request may act on: the user's own, or another one the check allows.
export function companyScope(c: Ctx, requested: any, allow: (companyId: string) => boolean) {
 const id = text(requested, 64) || c.companyId;
 check(company(id), 'Company is unavailable.');
 check(allow(id));
 return id;
}
export function find(table: string, id: any, label = 'Record') {
 const r = get(`SELECT * FROM ${table} WHERE id=?`, text(id, 64)); if (!r) fail(`${label} is unavailable.`); return r;
}
// A user whose account this user may change: someone they manage, never themselves, and never someone of equal or higher standing.
const RANK: Record<string, number> = {member: 0, useradmin: 1, chief: 2, system: 3};
export function manageableUser(c: Ctx, id: any) {
 const u = find('user', id, 'User');
 check(managesUsers(c, u.company_id), 'User is unavailable.');
 check(u.id !== c.user.id, 'Use My Profile for your own account.');
 check(c.sys || RANK[c.position] > RANK[u.position], 'You cannot change an administrator of equal or higher standing.');
 return u;
}
export const userLabel = (u: Row) => (u.name_cn && u.name_en && u.name_cn !== u.name_en) ? `${u.name_cn}:${u.name_en}` : (u.name_en || u.name_cn || u.username);

// ---- Connections: who may work with whom across companies.
// Users of another company this user may see and choose: designated staff of a connected company, when this user is designated
// on their own side or manages their company's connections.
export function connectedUserIds(c: Ctx): string[] {
 const rows = all(`SELECT cn.id, CASE WHEN cn.from_company=? THEN cn.to_company ELSE cn.from_company END AS other FROM connection cn
  WHERE cn.status='connected' AND (cn.from_company=? OR cn.to_company=?)`, c.companyId, c.companyId, c.companyId);
 const out: string[] = [];
 for (const r of rows) {
  const mine = managesConnections(c, c.companyId) || !!get('SELECT 1 FROM connection_user WHERE connection_id=? AND user_id=?', r.id, c.user.id);
  if (!mine) continue;
  for (const u of all('SELECT u.id FROM connection_user cu JOIN user u ON u.id=cu.user_id WHERE cu.connection_id=? AND u.company_id=?', r.id, r.other)) out.push(u.id);
 }
 return out;
}
// Users that may be added to a company's eFiles and groups: its own staff plus approved connection contacts.
export function eligibleContact(companyId: string, userId: string) {
 const u = get('SELECT * FROM user WHERE id=?', userId); if (!u || !live(u)) return false;
 if (u.company_id === companyId) return true;
 return !!get(`SELECT 1 FROM connection cn JOIN connection_user a ON a.connection_id=cn.id AND a.user_id=?
  WHERE cn.status='connected' AND ((cn.from_company=? AND cn.to_company=?) OR (cn.to_company=? AND cn.from_company=?))`, userId, companyId, u.company_id, companyId, u.company_id);
}

// ---- System log, with IMS's original Chinese module and function labels.
export const MODULE = {login: '用户登录/注销', efile: 'eFile', item: 'Item', account: '账户管理', client: '客户管理', process: 'eFile Process', approval: '审批'};
export const FUNC = {add: '新增', modify: '修改', view: '查看', remove: '删除', download: '下载', approve: '审批', override: '管理员覆盖'};
export function log(c: Ctx, module: keyof typeof MODULE, fn: keyof typeof FUNC, content: string, companyId = c.companyId) {
 run('INSERT INTO system_log(id,at,company_id,user_id,user_label,module,function,source,content) VALUES(?,?,?,?,?,?,?,?,?)',
  uid(), now(), companyId, c.user.id, userLabel(c.user), MODULE[module], FUNC[fn], 'Web', content.slice(0, 500));
}
export function notify(userIds: (string | null | undefined)[], kind: string, title: string, efileId?: string, itemId?: string) {
 for (const u of new Set(userIds.filter(Boolean) as string[])) run('INSERT INTO notification(id,user_id,kind,title,efile_id,item_id,at) VALUES(?,?,?,?,?,?,?)', uid(), u, kind, title.slice(0, 300), efileId ?? null, itemId ?? null, now());
}
