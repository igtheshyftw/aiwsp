// Account menu: Company, User, Role, User Group, System Log; plus IMS → Client Management.
import {all, get, run, uid, now, tx} from '../db';
import {check, hashPassword, validPassword, ALL_PERMS} from '../auth';
import {type Ctx, need, text, required, bool, ids, date, companyScope, sameCompany, find, companyUser, userLabel, log} from '../ctx';

const COMPANY_TYPES = ['Communicative', 'Operating', 'Client', 'Supplier', 'Partner'];
const LEVELS = ['Normal User', 'Administrator'];

function publicUser(u: any) {
 const roles = all('SELECT r.name FROM role r JOIN user_role ur ON ur.role_id=r.id WHERE ur.user_id=? ORDER BY r.name', u.id).map(r => r.name);
 return {id: u.id, company_id: u.company_id, username: u.username, name_cn: u.name_cn, name_en: u.name_en, sex: u.sex, dept: u.dept,
  email: u.email, mobile: u.mobile, account_type: u.account_type, level: u.level, state: u.state, system_admin: !!u.system_admin,
  roles, role_ids: all('SELECT role_id FROM user_role WHERE user_id=?', u.id).map(r => r.role_id),
  role_label: [...roles, `${u.account_type} - ${u.level}`].join(',')};
}

export const accountActions: Record<string, (c: Ctx, b: any) => any> = {
 // ---- Company
 'company.list'(c) {
  need(c, 'company');
  return c.sys ? all('SELECT * FROM company ORDER BY created_at') : all('SELECT * FROM company WHERE id=?', c.companyId);
 },
 'company.get'(c, b) { need(c, 'company'); const r = find('company', b.id, 'Company'); sameCompany(c, r.id); return {company: r, types: COMPANY_TYPES}; },
 'company.save'(c, b) {
  need(c, 'company');
  const f = {name_cn: required(b.name_cn, 'Name'), name_en: text(b.name_en), type: text(b.type, 60), code: text(b.code, 40), city: text(b.city, 80),
   status: b.status === 'suspended' ? 'suspended' : 'normal'};
  if (!b.id) {
   check(c.sys, 'Only the system administrator can add companies.');
   const id = uid(), acAdmin = uid(), standard = uid();
   tx(() => {
    run('INSERT INTO company(id,name_cn,name_en,type,code,city,status,created_at) VALUES(?,?,?,?,?,?,?,?)', id, f.name_cn, f.name_en, f.type, f.code, f.city, f.status, now());
    run('INSERT INTO role(id,company_id,name,description,perms) VALUES(?,?,?,?,?)', acAdmin, id, 'A/C Administrator', 'Company account administrator - with all authorisation', JSON.stringify(ALL_PERMS));
    run('INSERT INTO role(id,company_id,name,description,perms) VALUES(?,?,?,?,?)', standard, id, 'Standard users', 'Without authorisation to set up company account, user, role, user group and view system log', JSON.stringify(['client', 'efile']));
    log(c, 'account', 'add', `新增公司:${f.name_cn}`);
   });
   return {id};
  }
  const r = find('company', b.id, 'Company'); sameCompany(c, r.id);
  if (!c.sys) f.status = r.status;
  check(!(r.id === c.companyId && f.status === 'suspended'), 'You cannot suspend your own company.');
  tx(() => { run('UPDATE company SET name_cn=?,name_en=?,type=?,code=?,city=?,status=? WHERE id=?', f.name_cn, f.name_en, f.type, f.code, f.city, f.status, r.id); log(c, 'account', 'modify', `修改公司:${f.name_cn}`); });
  return {id: r.id};
 },
 'company.types'() { return COMPANY_TYPES; },

 // ---- User
 'user.list'(c, b) {
  need(c, 'user'); const companyId = companyScope(c, b.companyId);
  const state = ['normal', 'invalid'].includes(b.state) ? b.state : '';
  const rows = all(`SELECT * FROM user WHERE company_id=? ${state ? 'AND state=?' : ''} ORDER BY created_at`, ...(state ? [companyId, state] : [companyId]));
  return {company: get('SELECT * FROM company WHERE id=?', companyId), users: rows.map(publicUser)};
 },
 'user.get'(c, b) {
  need(c, 'user'); const u = companyUser(c, b.id);
  return {user: publicUser(u), roles: all('SELECT id,name FROM role WHERE company_id=? ORDER BY name', u.company_id), levels: LEVELS};
 },
 'user.form'(c, b) { need(c, 'user'); const companyId = companyScope(c, b.companyId); return {roles: all('SELECT id,name FROM role WHERE company_id=? ORDER BY name', companyId), levels: LEVELS}; },
 async 'user.save'(c, b) {
  need(c, 'user');
  const f = {username: required(b.username, 'Name', 40), name_cn: text(b.name_cn, 80), name_en: text(b.name_en, 80), sex: ['M', 'F'].includes(b.sex) ? b.sex : '',
   dept: text(b.dept, 200), email: text(b.email, 120), mobile: text(b.mobile, 40), level: LEVELS.includes(b.level) ? b.level : 'Normal User'};
  check(/^[A-Za-z0-9._-]{2,40}$/.test(f.username), 'Name may contain 2–40 letters, numbers, dots, hyphens or underscores.');
  check(!f.email || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email), 'Email is not valid.');
  const existing = b.id ? companyUser(c, b.id) : null;
  const companyId = existing ? existing.company_id : companyScope(c, b.companyId);
  check(!get('SELECT id FROM user WHERE username=? AND id<>?', f.username, existing?.id ?? ''), 'This name is already used by another account.');
  const roleIds = ids(b.roleIds).filter(r => get('SELECT id FROM role WHERE id=? AND company_id=?', r, companyId));
  let salt = '', pass = '';
  if (!existing) { validPassword(b.password); salt = uid(); pass = await hashPassword(b.password, salt); }
  return tx(() => {
   const id = existing?.id ?? uid();
   if (existing) run('UPDATE user SET username=?,name_cn=?,name_en=?,sex=?,dept=?,email=?,mobile=?,level=? WHERE id=?', f.username, f.name_cn, f.name_en, f.sex, f.dept, f.email, f.mobile, f.level, id);
   else run('INSERT INTO user(id,company_id,username,name_cn,name_en,sex,dept,email,mobile,level,salt,pass,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)', id, companyId, f.username, f.name_cn, f.name_en, f.sex, f.dept, f.email, f.mobile, f.level, salt, pass, now());
   run('DELETE FROM user_role WHERE user_id=?', id);
   for (const r of roleIds) run('INSERT INTO user_role(user_id,role_id) VALUES(?,?)', id, r);
   log(c, 'account', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}用户:${f.username}`);
   return {id};
  });
 },
 'user.state'(c, b) {
  need(c, 'user'); const u = companyUser(c, b.id);
  check(u.id !== c.user.id, 'You cannot deactivate your own account.');
  const state = u.state === 'normal' ? 'invalid' : 'normal';
  tx(() => { run('UPDATE user SET state=?,revision=revision+1 WHERE id=?', state, u.id); log(c, 'account', 'modify', `${state === 'invalid' ? '停用' : '启用'}用户:${u.username}`); });
  return {state};
 },
 async 'user.reset'(c, b) {
  need(c, 'user'); const u = companyUser(c, b.id); validPassword(b.password);
  const salt = uid(), pass = await hashPassword(b.password, salt);
  tx(() => { run('UPDATE user SET salt=?,pass=?,revision=revision+1 WHERE id=?', salt, pass, u.id); log(c, 'account', 'modify', `重置密码:${u.username}`); });
  return {};
 },
 // Hand-over tools from the user row menu.
 'user.transfer'(c, b) {
  need(c, 'user'); const from = companyUser(c, b.id);
  const kind = text(b.kind, 40);
  const needsTarget = kind !== 'groupDelete';
  const to = needsTarget ? companyUser(c, b.to) : null;
  if (to) check(to.id !== from.id, 'Choose a different user.');
  let count = 0;
  const move = (table: string, extra = '') => { count += Number(run(`UPDATE OR IGNORE ${table} SET user_id=? WHERE user_id=? ${extra}`, to!.id, from.id).changes); run(`DELETE FROM ${table} WHERE user_id=? ${extra}`, from.id); };
  const copy = (table: string, cols: string, extra = '') => { count += Number(run(`INSERT OR IGNORE INTO ${table}(${cols},user_id) SELECT ${cols},? FROM ${table} WHERE user_id=? ${extra}`, to!.id, from.id).changes); };
  tx(() => {
   if (kind === 'participants') move('efile_member', "AND kind='participant'");
   else if (kind === 'admins') move('efile_member', "AND kind='admin'");
   else if (kind === 'process') { move('efile_step_user'); count += Number(run('UPDATE process_stage SET executor_id=? WHERE executor_id=?', to!.id, from.id).changes); }
   else if (kind === 'groupDelete') count += Number(run('DELETE FROM user_group_member WHERE user_id=?', from.id).changes);
   else if (kind === 'copy') { copy('efile_member', 'efile_id,kind'); copy('user_efile', 'efile_id,in_my,hidden,mtt,link,color'); }
   else if (kind === 'insert') { copy('efile_member', 'efile_id,kind'); copy('efile_step_user', 'efile_id,position'); copy('user_group_member', 'group_id'); }
   else if (kind === 'replace') {
    move('efile_member'); move('efile_step_user'); move('user_group_member');
    count += Number(run('UPDATE process_stage SET executor_id=? WHERE executor_id=?', to!.id, from.id).changes);
    run("UPDATE user SET state='invalid',revision=revision+1 WHERE id=?", from.id);
   } else check(false, 'This function is not available.');
   log(c, 'account', 'modify', `用户移交(${kind}):${from.username}${to ? '→' + to.username : ''}`);
  });
  return {count};
 },
 'user.links.get'(c, b) {
  need(c, 'user'); const u = companyUser(c, b.id);
  return {efiles: all('SELECT id,name FROM efile WHERE company_id=? AND archived=0 ORDER BY name', u.company_id), selected: all('SELECT efile_id FROM user_efile WHERE user_id=? AND link=1', u.id).map(r => r.efile_id)};
 },
 'user.links.save'(c, b) {
  need(c, 'user'); const u = companyUser(c, b.id);
  const chosen = ids(b.efileIds).filter(e => get('SELECT id FROM efile WHERE id=? AND company_id=?', e, u.company_id));
  tx(() => {
   run('UPDATE user_efile SET link=0 WHERE user_id=?', u.id);
   for (const e of chosen) run('INSERT INTO user_efile(user_id,efile_id,in_my,link) VALUES(?,?,0,1) ON CONFLICT(user_id,efile_id) DO UPDATE SET link=1', u.id, e);
   log(c, 'account', 'modify', `分配eFile链接:${u.username}`);
  });
  return {};
 },

 // ---- Role
 'role.list'(c, b) {
  need(c, 'role');
  const rows = c.sys && !b.companyId ? all('SELECT r.*, c.name_cn AS company FROM role r JOIN company c ON c.id=r.company_id ORDER BY c.created_at, r.name')
   : all('SELECT r.*, c.name_cn AS company FROM role r JOIN company c ON c.id=r.company_id WHERE r.company_id=? ORDER BY r.name', companyScope(c, b.companyId));
  return rows.map(r => ({...r, perms: JSON.parse(r.perms)}));
 },
 'role.get'(c, b) { need(c, 'role'); const r = find('role', b.id, 'Role'); sameCompany(c, r.company_id); return {...r, perms: JSON.parse(r.perms), permissions: ALL_PERMS}; },
 'role.save'(c, b) {
  need(c, 'role');
  const f = {name: required(b.name, 'Role Name', 80), description: text(b.description, 300), share: bool(b.share), perms: JSON.stringify((Array.isArray(b.perms) ? b.perms : []).filter((p: any) => (ALL_PERMS as readonly string[]).includes(p)))};
  return tx(() => {
   if (b.id) {
    const r = find('role', b.id, 'Role'); sameCompany(c, r.company_id);
    run('UPDATE role SET name=?,description=?,share=?,perms=? WHERE id=?', f.name, f.description, f.share, f.perms, r.id);
    log(c, 'account', 'modify', `修改角色:${f.name}`); return {id: r.id};
   }
   const id = uid(); run('INSERT INTO role(id,company_id,name,description,share,perms) VALUES(?,?,?,?,?,?)', id, companyScope(c, b.companyId), f.name, f.description, f.share, f.perms);
   log(c, 'account', 'add', `新增角色:${f.name}`); return {id};
  });
 },
 'role.delete'(c, b) {
  need(c, 'role'); const r = find('role', b.id, 'Role'); sameCompany(c, r.company_id);
  check(!get('SELECT 1 FROM user_role WHERE role_id=?', r.id), 'Remove this role from its users before deleting it.');
  tx(() => { run('DELETE FROM role WHERE id=?', r.id); log(c, 'account', 'remove', `删除角色:${r.name}`); });
  return {};
 },
 'role.users'(c, b) {
  need(c, 'role'); const r = find('role', b.id, 'Role'); sameCompany(c, r.company_id);
  return {role: r, users: all('SELECT u.* FROM user u JOIN user_role ur ON ur.user_id=u.id WHERE ur.role_id=? ORDER BY u.username', r.id).map(publicUser)};
 },

 // ---- User Group
 'group.list'(c, b) { need(c, 'group'); return all('SELECT g.*, (SELECT COUNT(*) FROM user_group_member m WHERE m.group_id=g.id) AS members FROM user_group g WHERE company_id=? ORDER BY name', companyScope(c, b.companyId)); },
 'group.get'(c, b) {
  need(c, 'group'); const g = find('user_group', b.id, 'Group'); sameCompany(c, g.company_id);
  return {...g, members: all('SELECT user_id FROM user_group_member WHERE group_id=?', g.id).map(r => r.user_id)};
 },
 'group.save'(c, b) {
  need(c, 'group');
  const name = required(b.name, 'Name', 80), share = bool(b.share);
  return tx(() => {
   let g = b.id ? find('user_group', b.id, 'Group') : null; if (g) sameCompany(c, g.company_id);
   const companyId = g ? g.company_id : companyScope(c, b.companyId);
   const members = ids(b.members).filter(u => get('SELECT id FROM user WHERE id=? AND company_id=?', u, companyId));
   const id = g?.id ?? uid();
   if (g) run('UPDATE user_group SET name=?,share=? WHERE id=?', name, share, id); else run('INSERT INTO user_group(id,company_id,name,share) VALUES(?,?,?,?)', id, companyId, name, share);
   run('DELETE FROM user_group_member WHERE group_id=?', id);
   for (const u of members) run('INSERT INTO user_group_member(group_id,user_id) VALUES(?,?)', id, u);
   log(c, 'account', g ? 'modify' : 'add', `${g ? '修改' : '新增'}用户组:${name}`);
   return {id};
  });
 },
 'group.delete'(c, b) {
  need(c, 'group'); const g = find('user_group', b.id, 'Group'); sameCompany(c, g.company_id);
  tx(() => { run('DELETE FROM user_group WHERE id=?', g.id); log(c, 'account', 'remove', `删除用户组:${g.name}`); });
  return {};
 },
 'group.users'(c, b) {
  need(c, 'group'); const g = find('user_group', b.id, 'Group'); sameCompany(c, g.company_id);
  return {group: g, users: all('SELECT u.* FROM user u JOIN user_group_member m ON m.user_id=u.id WHERE m.group_id=? ORDER BY u.username', g.id).map(publicUser)};
 },
 'group.efiles'(c, b) {
  need(c, 'group'); const g = find('user_group', b.id, 'Group'); sameCompany(c, g.company_id);
  return {group: g, efiles: all(`SELECT DISTINCT e.id,e.name,e.color,e.highlight FROM efile e JOIN efile_group eg ON eg.efile_id=e.id WHERE eg.group_id=? ORDER BY e.name`, g.id)};
 },

 // ---- System Log
 'log.list'(c, b) {
  need(c, 'log');
  const companyId = companyScope(c, b.companyId);
  const from = date(b.from, 'Time') || '0000-01-01', to = date(b.to, 'Time') || '9999-12-31';
  const who = `%${text(b.user, 80)}%`, what = `%${text(b.content, 200)}%`;
  return all(`SELECT * FROM system_log WHERE company_id=? AND at>=? AND at<? AND user_label LIKE ? AND content LIKE ? ORDER BY at DESC LIMIT 5000`,
   companyId, from, to + 'T99', who, what);
 },

 // ---- Client Management
 'client.list'(c) { need(c, 'client'); return all('SELECT * FROM client WHERE company_id=? ORDER BY code', c.companyId); },
 'client.get'(c, b) { need(c, 'client'); const r = find('client', b.id, 'Client'); sameCompany(c, r.company_id); return r; },
 'client.save'(c, b) {
  need(c, 'client');
  const f = [required(b.code, 'Code', 40), text(b.name_cn, 120), text(b.name_en, 120), text(b.contact, 80), text(b.phone, 40), text(b.email, 120), text(b.address, 300), text(b.remark, 2000)];
  check(f[1] || f[2], 'Enter a CN Name or EN Name.');
  return tx(() => {
   if (b.id) {
    const r = find('client', b.id, 'Client'); sameCompany(c, r.company_id);
    run('UPDATE client SET code=?,name_cn=?,name_en=?,contact=?,phone=?,email=?,address=?,remark=? WHERE id=?', ...f, r.id);
    log(c, 'client', 'modify', `修改客户:${f[0]}`); return {id: r.id};
   }
   check(!get('SELECT id FROM client WHERE company_id=? AND code=?', c.companyId, f[0]), 'This client code is already used.');
   const id = uid(); run('INSERT INTO client(id,company_id,code,name_cn,name_en,contact,phone,email,address,remark) VALUES(?,?,?,?,?,?,?,?,?,?)', id, c.companyId, ...f);
   log(c, 'client', 'add', `新增客户:${f[0]}`); return {id};
  });
 },
 'client.delete'(c, b) {
  need(c, 'client'); const r = find('client', b.id, 'Client'); sameCompany(c, r.company_id);
  tx(() => { run('DELETE FROM client WHERE id=?', r.id); log(c, 'client', 'remove', `删除客户:${r.code}`); });
  return {};
 },

 // ---- Pickers: people and groups a user may choose from.
 'directory'(c) {
  return {
   users: all(`SELECT id,username,name_cn,name_en,dept FROM user WHERE company_id=? AND state='normal' ORDER BY username`, c.companyId).map(u => ({...u, label: userLabel(u)})),
   groups: all('SELECT id,name FROM user_group WHERE company_id=? ORDER BY name', c.companyId),
  };
 },
 // ---- Own profile
 'profile.get'(c) { return publicUser(c.user); },
};
