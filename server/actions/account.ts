// Account menu (Company, User, Role = authorization levels, User Group, Connection, System Log) and registration QR codes.
// IMS → Client Management is in client.ts. Rules follow docs/aiwsp/urgent-functions.md.
import QRCode from 'qrcode';
import {all, get, run, uid, now, tx, type Row} from '../db';
import {check, hashPassword, validPassword, digest, live, PERMS, seedLevels, publicOrigin} from '../auth';
import {type Ctx, allowed, needPerm, text, required, bool, ids, date, companyScope, find, manageableUser, userLabel, log, notify,
 companyAdmin, managesUsers, addsUsers, managesConnections, viewsLog, liveChief, userManagers, connectedUserIds, eligibleContact, userPerms} from '../ctx';
import {liveAdmins} from '../access';

const COMPANY_TYPES = ['Communicative', 'Operating', 'Client', 'Supplier', 'Partner'];
const POSITION_LABEL: Record<string, string> = {system: 'System Admin', chief: 'Chief Admin', useradmin: 'User Admin', member: 'User'};

function levelName(companyId: string, level: number) { return get('SELECT name FROM level WHERE company_id=? AND level=?', companyId, level)?.name ?? `Level ${level}`; }
function publicUser(u: Row) {
 return {id: u.id, company_id: u.company_id, username: u.username, name_cn: u.name_cn, name_en: u.name_en, sex: u.sex, dept: u.dept, email: u.email, mobile: u.mobile,
  position: u.position, level: u.level, perms: JSON.parse(u.perms || '{}'), effective: [...userPerms(u)], expires: u.expires, responsible_id: u.responsible_id,
  state: u.state, live: !!live(u), mfa: !!u.totp_secret,
  role_label: [POSITION_LABEL[u.position], levelName(u.company_id, u.level)].join(' - ') + (u.expires ? ` (until ${u.expires.slice(0, 10)})` : '')};
}
function userEfiles(userId: string): Row[] {
 const rows = all(`SELECT e.id, e.name, e.company_id,
   EXISTS(SELECT 1 FROM efile_member m WHERE m.efile_id=e.id AND m.user_id=? AND m.kind='participant') AS is_user,
   (SELECT rights FROM efile_member m WHERE m.efile_id=e.id AND m.user_id=? AND m.kind='participant') AS rights,
   EXISTS(SELECT 1 FROM efile_member m WHERE m.efile_id=e.id AND m.user_id=? AND m.kind='admin') AS is_admin,
   EXISTS(SELECT 1 FROM efile_step_user s WHERE s.efile_id=e.id AND s.user_id=?) AS is_approver
  FROM efile e WHERE e.id IN (SELECT efile_id FROM efile_member WHERE user_id=? UNION SELECT efile_id FROM efile_step_user WHERE user_id=?) ORDER BY e.name`, userId, userId, userId, userId, userId, userId);
 return rows.map(r => ({...r, pending: get(`SELECT COUNT(*) AS n FROM item i JOIN item_step s ON s.item_id=i.id AND s.round=i.round WHERE i.efile_id=? AND i.status='pending' AND s.decision IS NULL AND s.approvers LIKE ?`, r.id, `%"${userId}"%`)!.n}));
}
// Levels and function rights a manager may hand out: never better than their own (System Admins excepted).
function checkGrant(c: Ctx, companyId: string, level: number, perms: Record<string, boolean>) {
 check([1, 2, 3, 4].includes(level), 'Choose a level from 1 to 4.');
 if (c.sys) return;
 if (companyId === c.companyId) check(level >= c.user.level, 'You cannot grant a higher level than your own.');
 const target = new Set<string>(JSON.parse(get('SELECT perms FROM level WHERE company_id=? AND level=?', companyId, level)!.perms));
 for (const [k, v] of Object.entries(perms)) v ? target.add(k) : target.delete(k);
 for (const p of target) check(allowed(c, p), 'You cannot grant a function you do not hold yourself.');
}
// Move one user's service-team places to another user.
function moveTeam(from: string, to: string) {
 const n = Number(run(`INSERT OR IGNORE INTO client_team(client_id,kind,ref_id) SELECT client_id,'user',? FROM client_team WHERE kind='user' AND ref_id=?`, to, from).changes);
 run(`DELETE FROM client_team WHERE kind='user' AND ref_id=?`, from);
 return n;
}
async function newPassword(pw: any) { validPassword(pw); const salt = uid(); return {salt, pass: await hashPassword(pw, salt)}; }

export const accountActions: Record<string, (c: Ctx, b: any) => any> = {
 // ---------------- Company
 'company.list'(c) {
  const rows = c.sys ? all('SELECT * FROM company ORDER BY operator DESC, created_at') : all('SELECT * FROM company WHERE id=?', c.companyId);
  return rows.map(r => ({...r, chief: (u => u ? u.username : '')(liveChief(r.id)), can_edit: c.sys || companyAdmin(c, r.id), manages_users: managesUsers(c, r.id)}));
 },
 'company.get'(c, b) {
  const r = find('company', b.id, 'Company'); check(c.sys || r.id === c.companyId);
  return {company: r, types: COMPANY_TYPES, chief: liveChief(r.id)?.id ?? '', can_settings: companyAdmin(c, r.id) || (c.sys && false), is_chief: c.position === 'chief' && c.companyId === r.id,
   users: all(`SELECT id, username, name_en, position FROM user WHERE company_id=? AND state='normal' ORDER BY username`, r.id)};
 },
 'company.save'(c, b) {
  const f = {name_cn: required(b.name_cn, 'Name'), name_en: required(b.name_en, 'English Name'), type: text(b.type, 60), code: text(b.code, 40), city: text(b.city, 80),
   address: text(b.address, 300), contact: text(b.contact, 80), email: text(b.email, 120), phone: text(b.phone, 40)};
  check(!f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email), 'Email is not valid.');
  if (!b.id) {
   check(c.sys, 'Only a System Admin can add companies.');
   const id = uid();
   tx(() => {
    run('INSERT INTO company(id,name_cn,name_en,type,code,city,address,contact,email,phone,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, f.name_cn, f.name_en, f.type, f.code, f.city, f.address, f.contact, f.email, f.phone, now());
    seedLevels(id);
    log(c, 'account', 'add', `新增公司:${f.name_cn}`, id);
   });
   return {id};
  }
  const r = find('company', b.id, 'Company'); check(c.sys || companyAdmin(c, r.id));
  tx(() => {
   run('UPDATE company SET name_cn=?,name_en=?,type=?,code=?,city=?,address=?,contact=?,email=?,phone=? WHERE id=?', f.name_cn, f.name_en, f.type, f.code, f.city, f.address, f.contact, f.email, f.phone, r.id);
   // Only the Chief Admin (or a System Admin for a company without one) decides whether System Admins manage its users and connections.
   if (companyAdmin(c, r.id) && b.sys_manage_users !== undefined) run('UPDATE company SET sys_manage_users=?, sys_manage_connections=? WHERE id=?', bool(b.sys_manage_users), bool(b.sys_manage_connections), r.id);
   log(c, 'account', 'modify', `修改公司:${f.name_cn}`, r.id);
  });
  return {id: r.id};
 },
 'company.status'(c, b) {
  check(c.sys, 'Only a System Admin can suspend companies.'); const r = find('company', b.id, 'Company'); check(!r.operator, 'The operator company cannot be suspended.');
  const status = r.status === 'normal' ? 'suspended' : 'normal';
  tx(() => { run('UPDATE company SET status=? WHERE id=?', status, r.id); log(c, 'account', 'modify', `${status === 'normal' ? '恢复' : '暂停'}公司:${r.name_cn}`, r.id); });
  return {status};
 },
 // System Admin assigns or replaces a company's Chief Admin.
 'company.chief'(c, b) {
  check(c.sys, 'Only a System Admin assigns Chief Admins.'); const r = find('company', b.id, 'Company'); check(!r.operator, 'The operator company is run by its System Admins.');
  const u = b.userId ? find('user', b.userId, 'User') : null; if (u) check(u.company_id === r.id && live(u), 'Choose an active user of this company.');
  tx(() => {
   for (const old of all(`SELECT id FROM user WHERE company_id=? AND position='chief'`, r.id)) run(`UPDATE user SET position='member', revision=revision+1 WHERE id=?`, old.id);
   if (u) { run(`UPDATE user SET position='chief', level=1, revision=revision+1 WHERE id=?`, u.id); notify([u.id], 'access', `You are now Chief Admin of ${r.name_en || r.name_cn}.`); }
   log(c, 'account', 'modify', `指定首席管理员:${r.name_cn} → ${u?.username ?? '(none)'}`, r.id);
  });
  return {};
 },
 'company.types'() { return COMPANY_TYPES; },

 // ---------------- User
 'user.list'(c, b) {
  const companyId = companyScope(c, b.companyId, id => managesUsers(c, id));
  const state = ['normal', 'invalid'].includes(b.state) ? b.state : '';
  const rows = all(`SELECT * FROM user WHERE company_id=? AND state<>'deleted' ${state ? 'AND state=?' : ''} ORDER BY created_at`, ...(state ? [companyId, state] : [companyId]));
  return {company: get('SELECT * FROM company WHERE id=?', companyId), users: rows.map(publicUser), can_manage: managesUsers(c, companyId), can_invite: managesUsers(c, companyId)};
 },
 // Every account, grouped by company. System Admins see all companies; other managers see the companies they manage.
 // Seeing an account is not managing it: rows of companies this user does not manage are read-only,
 // except that System Admins may always add and delete accounts there (addsUsers).
 'user.all'(c, b) {
  const state = ['normal', 'invalid'].includes(b.state) ? b.state : '';
  const companies = (c.sys ? all('SELECT * FROM company ORDER BY operator DESC, name_cn') : all('SELECT * FROM company WHERE id=?', c.companyId)).filter(co => c.sys || managesUsers(c, co.id));
  check(companies.length, 'You do not manage any users.');
  return {groups: companies.map(co => ({
   company: {id: co.id, name_cn: co.name_cn, name_en: co.name_en, code: co.code, status: co.status, operator: !!co.operator, chief: liveChief(co.id)?.username ?? ''},
   can_manage: managesUsers(c, co.id), can_add: addsUsers(c, co.id),
   users: all(`SELECT * FROM user WHERE company_id=? AND state<>'deleted' ${state ? 'AND state=?' : ''} ORDER BY created_at`, ...(state ? [co.id, state] : [co.id])).map(publicUser),
  }))};
 },
 'user.form'(c, b) {
  const companyId = companyScope(c, b.companyId, id => addsUsers(c, id));
  return {levels: all('SELECT level, name, description, perms FROM level WHERE company_id=? ORDER BY level', companyId).map(l => ({...l, perms: JSON.parse(l.perms)})),
   perms: PERMS, admins: all(`SELECT id, username FROM user WHERE company_id=? AND position IN ('chief','useradmin') AND state='normal' ORDER BY username`, companyId),
   can_appoint_useradmin: companyAdmin(c, companyId), can_appoint_system: c.sys && !!get('SELECT operator FROM company WHERE id=?', companyId)?.operator, my_level: c.user.level, my_perms: [...c.perms], sys: c.sys};
 },
 'user.get'(c, b) {
  const u = find('user', b.id, 'User'); check(managesUsers(c, u.company_id) || u.id === c.user.id, 'User is unavailable.');
  return {user: publicUser(u), ...(accountActions['user.form'](c, {companyId: u.company_id}) as Row)};
 },
 async 'user.save'(c, b) {
  const existing = b.id ? manageableUser(c, b.id) : null;
  const companyId = existing ? existing.company_id : companyScope(c, b.companyId, id => addsUsers(c, id));
  const f = {username: required(b.username, 'Name', 40), name_cn: text(b.name_cn, 80), name_en: text(b.name_en, 80), sex: ['M', 'F'].includes(b.sex) ? b.sex : '',
   dept: text(b.dept, 200), email: text(b.email, 120), mobile: text(b.mobile, 40), level: Number(b.level ?? 3), expires: date(b.expires, 'Expiry date'), responsible_id: text(b.responsible_id, 64) || null};
  check(/^[A-Za-z0-9._-]{2,40}$/.test(f.username), 'Name may contain 2–40 letters, numbers, dots, hyphens or underscores.');
  check(!f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email), 'Email is not valid.');
  check(!get('SELECT id FROM user WHERE username=? AND id<>?', f.username, existing?.id ?? ''), 'This name is already used by another account.');
  const overrides: Record<string, boolean> = Object.fromEntries(PERMS.filter(k => typeof b.perms?.[k] === 'boolean').map(k => [k, b.perms[k]]));
  checkGrant(c, companyId, f.level, overrides);
  // Level 4 is temporary: it needs a future expiry date and a responsible administrator.
  if (f.level === 4 || f.expires) {
   check(f.expires && Date.parse(f.expires) > Date.now(), 'Temporary accounts need a future expiry date.');
   const resp = f.responsible_id ? get(`SELECT * FROM user WHERE id=? AND company_id=? AND position IN ('chief','useradmin')`, f.responsible_id, companyId) : null;
   check(resp || (c.sys && f.responsible_id === c.user.id), 'Temporary accounts need a responsible administrator.');
  } else f.responsible_id = null;
  let position = existing?.position ?? 'member';
  if (b.position !== undefined && b.position !== position) {
   const operator = !!get('SELECT operator FROM company WHERE id=?', companyId)?.operator;
   const choices = c.sys && operator ? ['member', 'useradmin', 'system'] : companyAdmin(c, companyId) ? ['member', 'useradmin'] : [];
   check(choices.includes(b.position) && choices.includes(position), b.position === 'chief' ? 'Chief Admins are assigned from the Company list.' : 'Only the Chief Admin appoints User Admins; only System Admins appoint System Admins.');
   if (position === 'system') check(all(`SELECT id FROM user WHERE position='system' AND state='normal' AND id<>?`, existing!.id).length, 'Keep at least one active System Admin.');
   position = b.position;
  }
  const pw = existing ? null : await newPassword(b.password);
  return tx(() => {
   const id = existing?.id ?? uid();
   if (existing) run('UPDATE user SET username=?,name_cn=?,name_en=?,sex=?,dept=?,email=?,mobile=?,level=?,perms=?,expires=?,responsible_id=?,position=?,revision=revision+? WHERE id=?',
    f.username, f.name_cn, f.name_en, f.sex, f.dept, f.email, f.mobile, f.level, JSON.stringify(overrides), f.expires, f.responsible_id, position, position !== existing.position || f.level !== existing.level ? 1 : 0, id);
   else run('INSERT INTO user(id,company_id,username,name_cn,name_en,sex,dept,email,mobile,level,perms,expires,responsible_id,position,salt,pass,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, companyId, f.username, f.name_cn, f.name_en, f.sex, f.dept, f.email, f.mobile, f.level, JSON.stringify(overrides), f.expires, f.responsible_id, position, pw!.salt, pw!.pass, now());
   if (existing && (existing.level !== f.level || existing.perms !== JSON.stringify(overrides) || existing.position !== position)) notify([id], 'access', 'Your account access has changed.');
   log(c, 'account', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}用户:${f.username} (${POSITION_LABEL[position]}, Level ${f.level})`, companyId);
   return {id};
  });
 },
 // Invalid = departed: sessions end at once, history stays, unfinished approvals must be reassigned.
 'user.state'(c, b) {
  const u = manageableUser(c, b.id); const state = u.state === 'normal' ? 'invalid' : 'normal';
  if (u.position === 'system' && state === 'invalid') check(all(`SELECT id FROM user WHERE position='system' AND state='normal' AND id<>?`, u.id).length, 'Keep at least one active System Admin.');
  tx(() => {
   run('UPDATE user SET state=?,revision=revision+1 WHERE id=?', state, u.id); run('DELETE FROM sessions WHERE user_id=?', u.id);
   log(c, 'account', 'modify', `${state === 'invalid' ? '停用' : '启用'}用户:${u.username}`, u.company_id);
   if (state === 'invalid') notify(all(`SELECT DISTINCT m.user_id FROM efile_member m JOIN efile_step_user s ON s.efile_id=m.efile_id AND s.user_id=? WHERE m.kind='admin'`, u.id).map(r => r.user_id), 'access', `${u.username} has left. Reassign their pending approvals.`);
  });
  return {state, pending: userEfiles(u.id).reduce((s, r) => s + r.pending, 0)};
 },
 // Delete an account: Chief/User Admins for users they manage, System Admins for any company. An account that never did anything
 // is removed outright. One with history is closed for good: sign-in, memberships and assignments go, and the record stays so past
 // actions keep their author (urgent-functions.md: departed users' historical actions are retained). Its approval steps pause for reassignment.
 'user.delete'(c, b) {
  const u = c.sys ? find('user', b.id, 'User') : manageableUser(c, b.id);
  check(u.state !== 'deleted' && addsUsers(c, u.company_id), 'User is unavailable.');
  check(u.id !== c.user.id, 'You cannot delete your own account.');
  if (u.position === 'system') check(all(`SELECT id FROM user WHERE position='system' AND state='normal' AND id<>?`, u.id).length, 'Keep at least one active System Admin.');
  const history = [
   'SELECT 1 FROM system_log WHERE user_id=?', 'SELECT 1 FROM item WHERE created_by=? OR submitted_by=?', 'SELECT 1 FROM item_event WHERE actor_id=?',
   'SELECT 1 FROM item_version WHERE by=?', 'SELECT 1 FROM item_step WHERE decided_by=?', 'SELECT 1 FROM item_comment WHERE user_id=?',
   'SELECT 1 FROM item_attachment WHERE uploaded_by=?', 'SELECT 1 FROM efile WHERE created_by=?', 'SELECT 1 FROM invite WHERE created_by=?',
   'SELECT 1 FROM chat_conversation WHERE user_id=? OR assigned_to=?', 'SELECT 1 FROM chat_message WHERE author_id=? OR reviewed_by=?',
   'SELECT 1 FROM process_stage WHERE executor_id=?', 'SELECT 1 FROM user WHERE responsible_id=?',
  ].some(sql => get(sql + ' LIMIT 1', ...Array((sql.match(/\?/g) ?? []).length).fill(u.id)));
  const admins = all(`SELECT DISTINCT m.user_id FROM efile_member m JOIN efile_step_user s ON s.efile_id=m.efile_id AND s.user_id=? WHERE m.kind='admin' AND m.user_id<>?`, u.id, u.id).map(r => r.user_id);
  tx(() => {
   run('DELETE FROM sessions WHERE user_id=?', u.id);
   if (!history) run('DELETE FROM user WHERE id=?', u.id);
   else {
    run(`DELETE FROM client_team WHERE kind='user' AND ref_id=?`, u.id);
    for (const t of ['efile_member', 'efile_step_user', 'user_group_member', 'connection_user', 'efile_share', 'user_efile', 'item_star', 'notification', 'chat_read']) run(`DELETE FROM ${t} WHERE user_id=?`, u.id);
    run('UPDATE chat_conversation SET assigned_to=NULL WHERE assigned_to=?', u.id);
    run(`UPDATE user SET state='deleted', pass='', totp_secret='', totp_pending='', reset_hash='', reset_expires='', revision=revision+1 WHERE id=?`, u.id);
    if (admins.length) notify(admins, 'access', `${u.username}'s account was deleted. Reassign their pending approvals.`);
   }
   log(c, 'account', 'remove', `删除用户:${u.username}${history ? ' (保留历史记录)' : ''}`, u.company_id);
  });
  return {removed: !history};
 },
 // Secure password reset: a one-time link, valid for one hour. Stored passwords are never shown.
 async 'user.reset'(c, b) {
  const u = manageableUser(c, b.id); const token = uid() + uid();
  run('UPDATE user SET reset_hash=?, reset_expires=? WHERE id=?', await digest(token), new Date(Date.now() + 3600000).toISOString(), u.id);
  log(c, 'account', 'modify', `创建重置密码链接:${u.username}`, u.company_id);
  return {link: `${publicOrigin}/#/reset?token=${token}`};
 },
 'user.mfa.reset'(c, b) {
  const u = manageableUser(c, b.id);
  tx(() => { run(`UPDATE user SET totp_secret='', totp_pending='', revision=revision+1 WHERE id=?`, u.id); log(c, 'account', 'modify', `重置双重验证:${u.username}`, u.company_id); });
  return {};
 },
 'user.efiles'(c, b) {
  const u = find('user', b.id, 'User'); check(managesUsers(c, u.company_id) || u.id === c.user.id, 'User is unavailable.');
  return {user: publicUser(u), efiles: userEfiles(u.id)};
 },
 // Remove or replace one user's role in one eFile. The replacement must be eligible (own staff or approved connection contact).
 'user.efile.change'(c, b) {
  const u = manageableUser(c, b.id); const e = find('efile', b.efileId, 'eFile');
  const to = b.to ? find('user', b.to, 'User') : null;
  tx(() => changeEfileRole(c, u, e, text(b.kind, 20), to));
  return {};
 },
 // Hand-over tools from the IMS user row menu.
 'user.transfer'(c, b) {
  const from = manageableUser(c, b.id); const kind = text(b.kind, 40);
  const to = kind === 'groupDelete' ? null : find('user', b.to, 'User');
  if (to) { check(to.id !== from.id && to.company_id === from.company_id && live(to), 'Choose another active user of the same company.'); }
  let count = 0;
  tx(() => {
   const efiles = userEfiles(from.id);
   const move = (k: string) => { for (const e of efiles) if (k === 'approver' ? e.is_approver : k === 'admin' ? e.is_admin : e.is_user) { changeEfileRole(c, from, find('efile', e.id), k, to); count++; } };
   if (kind === 'participants') move('participant');
   else if (kind === 'admins') move('admin');
   else if (kind === 'process') { move('approver'); count += Number(run('UPDATE process_stage SET executor_id=? WHERE executor_id=?', to!.id, from.id).changes); }
   else if (kind === 'groupDelete') count += Number(run('DELETE FROM user_group_member WHERE user_id=?', from.id).changes);
   // Service Team (IMS → Client Management): hand this user's clients over, or add the other user to the same clients.
   else if (kind === 'teamTransfer') { count += moveTeam(from.id, to!.id); }
   else if (kind === 'teamCopy') count += Number(run(`INSERT OR IGNORE INTO client_team(client_id,kind,ref_id) SELECT client_id,'user',? FROM client_team WHERE kind='user' AND ref_id=?`, to!.id, from.id).changes);
   else if (kind === 'copy' || kind === 'insert') {
    count += Number(run('INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id,rights) SELECT efile_id,kind,?,rights FROM efile_member WHERE user_id=?', to!.id, from.id).changes);
    if (kind === 'insert') { run('INSERT OR IGNORE INTO efile_step_user(efile_id,position,user_id) SELECT efile_id,position,? FROM efile_step_user WHERE user_id=?', to!.id, from.id); run('INSERT OR IGNORE INTO user_group_member(group_id,user_id) SELECT group_id,? FROM user_group_member WHERE user_id=?', to!.id, from.id); }
   } else if (kind === 'replace') {
    for (const k of ['participant', 'admin', 'approver']) move(k);
    run('UPDATE OR IGNORE user_group_member SET user_id=? WHERE user_id=?', to!.id, from.id); run('DELETE FROM user_group_member WHERE user_id=?', from.id);
    run('UPDATE process_stage SET executor_id=? WHERE executor_id=?', to!.id, from.id);
    moveTeam(from.id, to!.id);
    run(`UPDATE user SET state='invalid',revision=revision+1 WHERE id=?`, from.id); run('DELETE FROM sessions WHERE user_id=?', from.id);
   } else check(false, 'This function is not available.');
   log(c, 'account', 'modify', `用户移交(${kind}):${from.username}${to ? '→' + to.username : ''}`, from.company_id);
  });
  return {count};
 },
 'user.links.get'(c, b) {
  const u = manageableUser(c, b.id);
  return {efiles: userEfiles(u.id).map(e => ({id: e.id, name: e.name})), selected: all('SELECT efile_id FROM user_efile WHERE user_id=? AND link=1', u.id).map(r => r.efile_id)};
 },
 'user.links.save'(c, b) {
  const u = manageableUser(c, b.id); const allowedIds = new Set(userEfiles(u.id).map(e => e.id));
  tx(() => {
   run('UPDATE user_efile SET link=0 WHERE user_id=?', u.id);
   for (const e of ids(b.efileIds).filter(x => allowedIds.has(x))) run('INSERT INTO user_efile(user_id,efile_id,link) VALUES(?,?,1) ON CONFLICT(user_id,efile_id) DO UPDATE SET link=1', u.id, e);
   log(c, 'account', 'modify', `分配eFile链接:${u.username}`, u.company_id);
  });
  return {};
 },

 // ---------------- Registration QR codes
 async 'invite.list'(c, b) {
  const companyId = companyScope(c, b.companyId, id => managesUsers(c, id));
  const rows = all('SELECT * FROM invite WHERE company_id=? ORDER BY created_at DESC LIMIT 50', companyId);
  return Promise.all(rows.map(async r => {
   const url = `${publicOrigin}/#/register?token=${r.token}`, usable = r.active && Date.parse(r.expires) > Date.now();
   return {id: r.id, url, expires: r.expires, active: !!r.active, usable, qr: usable ? await QRCode.toDataURL(url, {margin: 1, width: 220}) : ''};
  }));
 },
 'invite.create'(c, b) {
  const companyId = companyScope(c, b.companyId, id => managesUsers(c, id));
  const days = Math.min(Math.max(Number(b.days) || 7, 1), 30);
  const id = uid(), token = (uid() + uid()).replace(/-/g, '');
  tx(() => { run('INSERT INTO invite(id,company_id,token,created_by,expires,created_at) VALUES(?,?,?,?,?,?)', id, companyId, token, c.user.id, new Date(Date.now() + days * 86400000).toISOString(), now()); log(c, 'account', 'add', `创建注册二维码 (${days}天)`, companyId); });
  return {id};
 },
 'invite.revoke'(c, b) {
  const r = find('invite', b.id, 'Invitation'); check(managesUsers(c, r.company_id));
  tx(() => { run('UPDATE invite SET active=0 WHERE id=?', r.id); log(c, 'account', 'remove', '撤销注册二维码', r.company_id); });
  return {};
 },

 // ---------------- Role = the company's four authorization levels
 'role.list'(c, b) {
  const companyId = companyScope(c, b.companyId, id => companyAdmin(c, id) || managesUsers(c, id));
  return {company: get('SELECT id,name_cn,name_en FROM company WHERE id=?', companyId), can_edit: companyAdmin(c, companyId), perms: PERMS,
   levels: all(`SELECT l.*, (SELECT COUNT(*) FROM user u WHERE u.company_id=l.company_id AND u.level=l.level AND u.state<>'deleted') AS users FROM level l WHERE company_id=? ORDER BY level`, companyId).map(l => ({...l, id: String(l.level), perms: JSON.parse(l.perms)}))};
 },
 'role.save'(c, b) {
  const companyId = companyScope(c, b.companyId, id => companyAdmin(c, id));
  const level = Number(b.level); check([1, 2, 3, 4].includes(level));
  const perms = (Array.isArray(b.perms) ? b.perms : []).filter((p: any) => (PERMS as readonly string[]).includes(p));
  if (level === 4) check(!perms.some((p: string) => ['efileAdmin', 'approve'].includes(p)), 'Temporary accounts (Level 4) cannot administer eFiles or approve.');
  tx(() => {
   run('UPDATE level SET name=?, description=?, perms=? WHERE company_id=? AND level=?', required(b.name, 'Name', 80), text(b.description, 300), JSON.stringify(perms), companyId, level);
   for (const u of all('SELECT id FROM user WHERE company_id=? AND level=?', companyId, level)) run('UPDATE user SET revision=revision+1 WHERE id=?', u.id);
   log(c, 'account', 'modify', `修改权限级别:Level ${level} (${perms.join(', ')})`, companyId);
  });
  return {};
 },
 'role.users'(c, b) {
  const companyId = companyScope(c, b.companyId, id => managesUsers(c, id));
  return {role: {name: levelName(companyId, Number(b.level))}, users: all(`SELECT * FROM user WHERE company_id=? AND level=? AND state<>'deleted' ORDER BY username`, companyId, Number(b.level)).map(publicUser)};
 },

 // ---------------- User Group (company groups; external members only from approved connections)
 'group.list'(c, b) {
  const companyId = companyScope(c, b.companyId, id => managesUsers(c, id));
  return all('SELECT g.*, (SELECT COUNT(*) FROM user_group_member m WHERE m.group_id=g.id) AS members FROM user_group g WHERE company_id=? ORDER BY name', companyId);
 },
 'group.get'(c, b) {
  const g = find('user_group', b.id, 'Group'); check(managesUsers(c, g.company_id));
  return {...g, members: all('SELECT u.id, u.username AS label FROM user u JOIN user_group_member m ON m.user_id=u.id WHERE m.group_id=? ORDER BY u.username', g.id), efiles: groupEfiles(g.id)};
 },
 'group.save'(c, b) {
  const g = b.id ? find('user_group', b.id, 'Group') : null;
  const companyId = g ? g.company_id : companyScope(c, b.companyId, id => managesUsers(c, id)); check(managesUsers(c, companyId));
  const name = required(b.name, 'Name', 80);
  const members = ids(b.members); for (const u of members) check(eligibleContact(companyId, u), 'External members must be approved connection contacts.');
  return tx(() => {
   const id = g?.id ?? uid();
   if (g) run('UPDATE user_group SET name=?,share=? WHERE id=?', name, bool(b.share), id); else run('INSERT INTO user_group(id,company_id,name,share) VALUES(?,?,?,?)', id, companyId, name, bool(b.share));
   const before = new Set(all('SELECT user_id FROM user_group_member WHERE group_id=?', id).map(r => r.user_id));
   run('DELETE FROM user_group_member WHERE group_id=?', id);
   for (const u of members) run('INSERT INTO user_group_member(group_id,user_id) VALUES(?,?)', id, u);
   const changed = [...members.filter(u => !before.has(u)), ...[...before].filter(u => !members.includes(u))];
   if (changed.length) notify(changed, 'access', `Your eFile access changed through group ${name}.`);
   log(c, 'account', g ? 'modify' : 'add', `${g ? '修改' : '新增'}用户组:${name} (${members.length}人)`, companyId);
   return {id};
  });
 },
 'group.delete'(c, b) {
  const g = find('user_group', b.id, 'Group'); check(managesUsers(c, g.company_id));
  tx(() => { run(`DELETE FROM client_team WHERE kind='group' AND ref_id=?`, g.id); run('DELETE FROM user_group WHERE id=?', g.id); log(c, 'account', 'remove', `删除用户组:${g.name}`, g.company_id); });
  return {};
 },
 'group.users'(c, b) {
  const g = find('user_group', b.id, 'Group'); check(managesUsers(c, g.company_id));
  return {group: g, users: all('SELECT u.* FROM user u JOIN user_group_member m ON m.user_id=u.id WHERE m.group_id=? ORDER BY u.username', g.id).map(publicUser)};
 },
 'group.efiles'(c, b) { const g = find('user_group', b.id, 'Group'); check(managesUsers(c, g.company_id)); return {group: g, efiles: groupEfiles(g.id)}; },

 // ---------------- Connection (client-to-client, both companies confirm)
 'connection.list'(c, b) {
  const companyId = companyScope(c, b.companyId, id => managesConnections(c, id));
  const rows = all(`SELECT cn.*, f.name_cn AS from_name, t.name_cn AS to_name FROM connection cn JOIN company f ON f.id=cn.from_company JOIN company t ON t.id=cn.to_company
   WHERE cn.from_company=? OR cn.to_company=? ORDER BY cn.updated_at DESC`, companyId, companyId);
  return {companyId, can_manage: managesConnections(c, companyId), connections: rows.map(r => ({...r, incoming: r.to_company === companyId,
   other: r.to_company === companyId ? r.from_name : r.to_name,
   mine: all('SELECT u.id, u.username AS label FROM connection_user cu JOIN user u ON u.id=cu.user_id WHERE cu.connection_id=? AND u.company_id=?', r.id, companyId),
   theirs: all('SELECT u.id, u.username AS label, u.name_en, u.dept FROM connection_user cu JOIN user u ON u.id=cu.user_id WHERE cu.connection_id=? AND u.company_id<>?', r.id, companyId)})),
   companies: all('SELECT id, name_cn, name_en, code FROM company WHERE id<>? AND status=? ORDER BY name_cn', companyId, 'normal')};
 },
 'connection.request'(c, b) {
  const from = companyScope(c, b.companyId, id => managesConnections(c, id)); const to = find('company', b.to, 'Company');
  check(to.id !== from, 'Choose another company.');
  check(!get(`SELECT 1 FROM connection WHERE status<>'revoked' AND ((from_company=? AND to_company=?) OR (from_company=? AND to_company=?))`, from, to.id, to.id, from), 'A connection with this company already exists.');
  const id = uid(), t = now();
  tx(() => {
   run('INSERT INTO connection(id,from_company,to_company,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?)', id, from, to.id, 'requested', text(b.note, 300), t, t);
   for (const u of ids(b.users).filter(u => get('SELECT 1 FROM user WHERE id=? AND company_id=?', u, from))) run('INSERT INTO connection_user(connection_id,user_id) VALUES(?,?)', id, u);
   notify(connectionManagers(to.id), 'connection', `Connection request from ${get('SELECT name_cn FROM company WHERE id=?', from)!.name_cn}`);
   log(c, 'account', 'add', `申请公司连接:${to.name_cn}`, from);
  });
  return {id};
 },
 // Accept (receiving company only), revoke (either side), and designate this side's staff.
 'connection.update'(c, b) {
  const cn = find('connection', b.id, 'Connection');
  const side = companyScope(c, b.companyId, id => managesConnections(c, id)); check([cn.from_company, cn.to_company].includes(side));
  tx(() => {
   if (b.status === 'connected') { check(cn.status === 'requested' && side === cn.to_company, 'Only the receiving company can accept.'); run(`UPDATE connection SET status='connected',updated_at=? WHERE id=?`, now(), cn.id); notify(connectionManagers(cn.from_company), 'connection', 'Your connection request was accepted.'); }
   else if (b.status === 'revoked') { run(`UPDATE connection SET status='revoked',updated_at=? WHERE id=?`, now(), cn.id); notify(connectionManagers(side === cn.from_company ? cn.to_company : cn.from_company), 'connection', 'A company connection was revoked.'); }
   if (Array.isArray(b.users)) {
    run('DELETE FROM connection_user WHERE connection_id=? AND user_id IN (SELECT id FROM user WHERE company_id=?)', cn.id, side);
    for (const u of ids(b.users).filter(u => get('SELECT 1 FROM user WHERE id=? AND company_id=?', u, side))) run('INSERT INTO connection_user(connection_id,user_id) VALUES(?,?)', cn.id, u);
   }
   log(c, 'account', 'modify', `更新公司连接:${b.status ?? '指定人员'}`, side);
  });
  return {};
 },

 // ---------------- System Log
 'log.list'(c, b) {
  const companyId = companyScope(c, b.companyId, id => viewsLog(c, id));
  const from = date(b.from, 'Time') || '0000-01-01', to = date(b.to, 'Time') || '9999-12-31';
  return all(`SELECT * FROM system_log WHERE company_id=? AND at>=? AND at<? AND user_label LIKE ? AND content LIKE ? ORDER BY at DESC LIMIT 5000`,
   companyId, from, to + 'T99', `%${text(b.user, 80)}%`, `%${text(b.content, 200)}%`);
 },

 // ---------------- People pickers: own company plus approved connection contacts (finding someone grants nothing else).
 'directory'(c, b) {
  const companyId = b.companyId ? companyScope(c, b.companyId, id => managesUsers(c, id)) : c.companyId;
  const own = all(`SELECT u.id,u.username,u.name_cn,u.name_en,u.dept,u.company_id,u.expires,u.state FROM user u WHERE u.company_id=? ORDER BY u.username`, companyId).filter(u => live(u));
  const external = companyId === c.companyId ? connectedUserIds(c).map(id => get('SELECT u.id,u.username,u.name_cn,u.name_en,u.dept,u.company_id,u.expires,u.state, c.name_cn AS company FROM user u JOIN company c ON c.id=u.company_id WHERE u.id=?', id)).filter(u => u && live(u)) as Row[] : [];
  return {users: [...own, ...external].map(u => ({id: u.id, username: u.username, label: userLabel(u), company: u.company ?? '', external: u.company_id !== companyId})),
   groups: all('SELECT id,name FROM user_group WHERE company_id=? ORDER BY name', companyId)};
 },
 'profile.get'(c) { return publicUser(c.user); },
};

function changeEfileRole(c: Ctx, u: Row, e: Row, kind: string, to: Row | null) {
 check(['participant', 'admin', 'approver'].includes(kind));
 if (to) check(eligibleContact(e.company_id, to.id), 'The replacement is not an approved contact for this eFile.');
 if (to && kind === 'approver') check(userPerms(to).has('approve'), `${to.username} does not hold the approval function.`);
 if (to && kind === 'admin') check(userPerms(to).has('efileAdmin'), `${to.username} does not hold the eFile administration function.`);
 if (kind === 'approver') {
  for (const s of all('SELECT position FROM efile_step_user WHERE efile_id=? AND user_id=?', e.id, u.id)) {
   run('DELETE FROM efile_step_user WHERE efile_id=? AND position=? AND user_id=?', e.id, s.position, u.id);
   if (to) run('INSERT OR IGNORE INTO efile_step_user(efile_id,position,user_id) VALUES(?,?,?)', e.id, s.position, to.id);
  }
  // Unfinished approvals move to the replacement; without one they pause until an administrator assigns someone.
  for (const s of all(`SELECT s.* FROM item_step s JOIN item i ON i.id=s.item_id AND i.round=s.round WHERE i.efile_id=? AND i.status='pending' AND s.decision IS NULL`, e.id)) {
   const list: string[] = JSON.parse(s.approvers); if (!list.includes(u.id)) continue;
   const next = list.filter(x => x !== u.id); if (to && !next.includes(to.id)) next.push(to.id);
   run('UPDATE item_step SET approvers=? WHERE item_id=? AND round=? AND position=?', JSON.stringify(next), s.item_id, s.round, s.position);
  }
 } else {
  const rights = get('SELECT rights FROM efile_member WHERE efile_id=? AND kind=? AND user_id=?', e.id, kind, u.id)?.rights ?? 'edit';
  run('DELETE FROM efile_member WHERE efile_id=? AND kind=? AND user_id=?', e.id, kind, u.id);
  if (to) run('INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id,rights) VALUES(?,?,?,?)', e.id, kind, to.id, rights);
  if (kind === 'admin') check(liveAdmins(e.id).length || liveChief(e.company_id) || all(`SELECT 1 FROM user WHERE position='system' AND state='normal'`).length, 'An eFile must keep an administrator.');
 }
 notify([u.id, to?.id], 'access', `eFile access changed: ${e.name}`, e.id);
 log(c, 'account', 'modify', `${to ? '替换' : '移除'}eFile角色(${kind}):${e.name} ${u.username}${to ? '→' + to.username : ''}`, u.company_id);
}
function groupEfiles(groupId: string) {
 return all(`SELECT DISTINCT e.id,e.name,e.color,e.highlight,eg.rights FROM efile e JOIN efile_group eg ON eg.efile_id=e.id WHERE eg.group_id=? AND eg.kind='participant' ORDER BY e.name`, groupId);
}
function connectionManagers(companyId: string) {
 const local = all(`SELECT id FROM user WHERE company_id=? AND position IN ('chief','useradmin') AND state='normal'`, companyId).map(u => u.id);
 const co = get('SELECT * FROM company WHERE id=?', companyId)!;
 return co.sys_manage_connections || !liveChief(companyId) ? [...local, ...all(`SELECT id FROM user WHERE position='system' AND state='normal'`).map(u => u.id)] : local;
}
export {userManagers};
