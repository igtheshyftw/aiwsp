// Request context, input helpers, permission checks and the system log.
import {all, get, run, uid, now, type Row} from './db';
import {check, fail} from './auth';

export type Ctx = {user: Row, companyId: string, sys: boolean, perms: Set<string>};

export function context(user: Row): Ctx {
 const roles = all('SELECT r.perms FROM role r JOIN user_role ur ON ur.role_id=r.id WHERE ur.user_id=?', user.id);
 const perms = new Set<string>(roles.flatMap(r => JSON.parse(r.perms)));
 return {user, companyId: user.company_id, sys: !!user.system_admin, perms};
}
export const can = (c: Ctx, p: string) => c.sys || c.perms.has(p);
export const need = (c: Ctx, p: string) => check(can(c, p));

export const text = (v: any, max = 200) => String(v ?? '').trim().slice(0, max);
export function required(v: any, label = 'Name', max = 200) { const s = text(v, max); check(s, `${label} is required.`); return s; }
export const bool = (v: any) => v ? 1 : 0;
export const ids = (v: any): string[] => Array.isArray(v) ? [...new Set(v.filter((x: any) => typeof x === 'string' && x.length <= 64))] : [];
export function date(v: any, label = 'Date') {
 const s = text(v, 10); if (!s) return '';
 check(/^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s)), `${label} is not a valid date.`); return s;
}
// "1,234.5" -> 123450 cents
export function cents(v: any, label = 'Amount') {
 const s = String(v ?? '').replace(/,/g, '').trim(); if (!s) return 0;
 check(/^-?\d{1,13}(\.\d{1,2})?$/.test(s), `${label} must be a number with up to two decimal places.`);
 return Math.round(Number(s) * 100);
}

// Which company a request may act on: the user's own, or any for the system administrator.
export function companyScope(c: Ctx, requested?: any) {
 const id = text(requested, 64) || c.companyId;
 check(c.sys || id === c.companyId);
 check(get('SELECT id FROM company WHERE id=?', id), 'Company is unavailable.');
 return id;
}
export function sameCompany(c: Ctx, companyId: string) { check(c.sys || companyId === c.companyId); }
export function find(table: string, id: any, label = 'Record') {
 const r = get(`SELECT * FROM ${table} WHERE id=?`, text(id, 64)); if (!r) fail(`${label} is unavailable.`); return r;
}
export function companyUser(c: Ctx, id: any, companyId = c.companyId) {
 const u = find('user', id, 'User'); check(c.sys || u.company_id === companyId, 'User is unavailable.'); return u;
}
export const userLabel = (u: Row) => (u.name_cn && u.name_en && u.name_cn !== u.name_en) ? `${u.name_cn}:${u.name_en}` : (u.name_en || u.name_cn || u.username);

// System log, with IMS's original Chinese module and function labels.
export const MODULE = {login: '用户登录/注销', efile: 'eFile', item: 'Item', account: '账户管理', client: '客户管理', process: 'eFile Process'};
export const FUNC = {add: '新增', modify: '修改', view: '查看', remove: '删除'};
export function log(c: Ctx, module: keyof typeof MODULE, fn: keyof typeof FUNC, content: string) {
 run('INSERT INTO system_log(id,at,company_id,user_id,user_label,module,function,source,content) VALUES(?,?,?,?,?,?,?,?,?)',
  uid(), now(), c.companyId, c.user.id, userLabel(c.user), MODULE[module], FUNC[fn], 'Web', content.slice(0, 500));
}
export function notify(userIds: string[], kind: string, title: string, efileId?: string, itemId?: string) {
 for (const u of new Set(userIds)) run('INSERT INTO notification(id,user_id,kind,title,efile_id,item_id,at) VALUES(?,?,?,?,?,?,?)', uid(), u, kind, title.slice(0, 300), efileId ?? null, itemId ?? null, now());
}
export const fmt = (cents: number) => (cents / 100).toFixed(2);
