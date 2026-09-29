// IMS → My eFile: the eFile list, setup form, bulk actions, sharing, confirmation steps and balances.
import {all, get, run, uid, now, tx, type Row} from '../db';
import {check, hashPassword, validPassword, equal} from '../auth';
import {type Ctx, need, text, required, bool, ids, cents, userLabel, log, fmt} from '../ctx';
import {visible, membership, efile as openEfile} from '../access';

export const COLORS = ['', 'Blue', 'Teal', 'Green', 'Yellow', 'Orange', 'Red', 'Purple', 'Grey', 'Personalised 1', 'Personalised 2', 'Personalised 3', 'Personalised 4', 'Personalised 5'];
const color = (v: any) => COLORS.includes(v) ? v : '';

const labels = (rows: Row[]) => rows.map(u => ({id: u.id, label: u.username, name: userLabel(u)}));
function members(id: string, kind: string) { return labels(all('SELECT u.* FROM user u JOIN efile_member m ON m.user_id=u.id WHERE m.efile_id=? AND m.kind=? ORDER BY u.username', id, kind)); }
function groups(id: string, kind: string) { return all('SELECT g.id, g.name AS label FROM user_group g JOIN efile_group eg ON eg.group_id=g.id WHERE eg.efile_id=? AND eg.kind=? ORDER BY g.name', id, kind); }
export function steps(id: string): Row[] {
 return all('SELECT position,title FROM efile_step WHERE efile_id=? ORDER BY position', id).map(s => ({...s,
  users: labels(all('SELECT u.* FROM user u JOIN efile_step_user su ON su.user_id=u.id WHERE su.efile_id=? AND su.position=? ORDER BY u.username', id, s.position))}));
}
export function balances(e: Row) {
 const r = get(`SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN status='uncompleted' THEN amount ELSE 0 END),0) AS open FROM item WHERE efile_id=?`, e.id)!;
 return {balance: e.balance + r.total, notional: e.notional + r.open};
}
function companyUsers(c: Ctx, list: any) { return ids(list).filter(u => get(`SELECT id FROM user WHERE id=? AND company_id=?`, u, c.companyId)); }
function companyGroups(c: Ctx, list: any) { return ids(list).filter(g => get('SELECT id FROM user_group WHERE id=? AND company_id=?', g, c.companyId)); }
function personal(c: Ctx, efileId: string, set: string, ...values: any[]) {
 run(`INSERT INTO user_efile(user_id,efile_id) VALUES(?,?) ON CONFLICT(user_id,efile_id) DO NOTHING`, c.user.id, efileId);
 run(`UPDATE user_efile SET ${set} WHERE user_id=? AND efile_id=?`, ...values, c.user.id, efileId);
}
export const touch = (efileId: string) => run('UPDATE efile SET updated_at=? WHERE id=?', now(), efileId);

function copyEfile(c: Ctx, e: Row, name: string) {
 const id = uid(), t = now();
 run(`INSERT INTO efile(id,company_id,name,tag,select_type,highlight,color,report_name,item_type,balance,balance_alias,notional,notional_alias,currency,created_by,created_at,updated_at)
  SELECT ?,company_id,?,tag,select_type,highlight,color,report_name,item_type,0,balance_alias,0,notional_alias,currency,?,?,? FROM efile WHERE id=?`, id, name, c.user.id, t, t, e.id);
 run('INSERT INTO efile_member(efile_id,kind,user_id) SELECT ?,kind,user_id FROM efile_member WHERE efile_id=?', id, e.id);
 run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id) VALUES(?,'participant',?),(?,'admin',?)`, id, c.user.id, id, c.user.id);
 run('INSERT INTO efile_group(efile_id,kind,group_id) SELECT ?,kind,group_id FROM efile_group WHERE efile_id=?', id, e.id);
 run('INSERT INTO efile_step(efile_id,position,title) SELECT ?,position,title FROM efile_step WHERE efile_id=?', id, e.id);
 run('INSERT INTO efile_step_user(efile_id,position,user_id) SELECT ?,position,user_id FROM efile_step_user WHERE efile_id=?', id, e.id);
 return id;
}

export const efileActions: Record<string, (c: Ctx, b: any) => any> = {
 'efile.list'(c, b) {
  const view = text(b.view, 20) || 'my';
  const [cond, params] = visible(c);
  const where: string[] = [cond]; const args: any[] = [...params];
  const notHidden = 'COALESCE(ue.hidden,0)=0';
  if (view === 'my') { const [m, mp] = membership(c); where.push(`(ue.in_my=1 OR (ue.in_my IS NULL AND ${m}))`, notHidden, 'e.archived=0'); args.push(...mp); }
  else if (view === 'explorer') where.push('e.archived=0');
  else if (view === 'recent') where.push(notHidden, 'e.archived=0');
  else if (view === 'links') where.push('COALESCE(ue.link,0)=1', 'e.archived=0');
  else if (view === 'hidden') where.push('COALESCE(ue.hidden,0)=1');
  else if (view === 'archive') where.push('e.archived=1');
  else if (view === 'process') where.push('e.id IN (SELECT efile_id FROM process_stage)', 'e.archived=0');
  else if (view === 'confirmation') { where.push('e.id IN (SELECT efile_id FROM efile_step_user WHERE user_id=?)', 'e.archived=0'); args.push(c.user.id); }
  else if (view === 'color') { where.push(`COALESCE(NULLIF(ue.color,''),e.color)=?`, 'e.archived=0'); args.push(color(b.color)); }
  const q = text(b.q, 100); if (q) { where.push('(e.name LIKE ? OR e.tag LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const order = view === 'recent' ? 'e.updated_at DESC' : 'COALESCE(ue.mtt,0) DESC, e.created_at';
  return all(`SELECT e.id,e.name,e.tag,e.highlight,e.archived,e.updated_at, COALESCE(NULLIF(ue.color,''),e.color) AS color, COALESCE(ue.mtt,0) AS mtt,
    e.password<>'' AS locked, EXISTS(SELECT 1 FROM process_stage ps WHERE ps.efile_id=e.id) AS in_process,
    EXISTS(SELECT 1 FROM efile_share s WHERE s.efile_id=e.id) AS shared, COALESCE(ue.in_my,1) AS in_my, COALESCE(ue.hidden,0) AS hidden
   FROM efile e LEFT JOIN user_efile ue ON ue.efile_id=e.id AND ue.user_id=? WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 2000`, c.user.id, ...args);
 },
 'efile.get'(c, b) {
  const e = openEfile(c, b.id); const {password, ...safe} = e;
  const bal = balances(e);
  return {...safe, locked: !!password, participants: members(e.id, 'participant'), admins: members(e.id, 'admin'), groups: groups(e.id, 'participant'),
   wechat_participants: members(e.id, 'wechat'), wechat_groups: groups(e.id, 'wechat'), steps: steps(e.id), colors: COLORS,
   balance_total: fmt(bal.balance), notional_total: fmt(bal.notional), balance_open: fmt(e.balance), notional_open: fmt(e.notional)};
 },
 'efile.form'() { return {colors: COLORS}; },
 'efile.save'(c, b) {
  const existing = b.id ? openEfile(c, b.id, 'admin') : null;
  if (!existing) need(c, 'efile');
  const f = {name: required(b.name, 'Name', 300), tag: text(b.tag, 300), highlight: bool(b.highlight), color: color(b.color), report_name: text(b.report_name, 200), currency: text(b.currency, 8).toUpperCase() || 'CNY'};
  const participants = companyUsers(c, b.participants), admins = companyUsers(c, b.admins), grp = companyGroups(c, b.groups);
  if (!existing && !admins.includes(c.user.id)) admins.push(c.user.id);
  check(participants.length || grp.length, 'Choose at least one participant or group.');
  check(admins.length, 'Choose at least one administrator.');
  for (const a of admins) if (!participants.includes(a)) participants.push(a);
  return tx(() => {
   const id = existing?.id ?? uid(), t = now();
   if (existing) run('UPDATE efile SET name=?,tag=?,highlight=?,color=?,report_name=?,currency=?,updated_at=? WHERE id=?', f.name, f.tag, f.highlight, f.color, f.report_name, f.currency, t, id);
   else run('INSERT INTO efile(id,company_id,name,tag,highlight,color,report_name,currency,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)', id, c.companyId, f.name, f.tag, f.highlight, f.color, f.report_name, f.currency, c.user.id, t, t);
   run('DELETE FROM efile_member WHERE efile_id=?', id); run('DELETE FROM efile_group WHERE efile_id=?', id);
   for (const u of participants) run(`INSERT INTO efile_member(efile_id,kind,user_id) VALUES(?,'participant',?)`, id, u);
   for (const u of admins) run(`INSERT INTO efile_member(efile_id,kind,user_id) VALUES(?,'admin',?)`, id, u);
   for (const u of companyUsers(c, b.wechat_participants)) run(`INSERT INTO efile_member(efile_id,kind,user_id) VALUES(?,'wechat',?)`, id, u);
   for (const g of grp) run(`INSERT INTO efile_group(efile_id,kind,group_id) VALUES(?,'participant',?)`, id, g);
   for (const g of companyGroups(c, b.wechat_groups)) run(`INSERT INTO efile_group(efile_id,kind,group_id) VALUES(?,'wechat',?)`, id, g);
   log(c, 'efile', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}eFile:${f.name}`);
   return {id};
  });
 },
 'efile.delete'(c, b) {
  const e = openEfile(c, b.id, 'admin');
  check(!get('SELECT 1 FROM process_stage WHERE efile_id=?', e.id), 'This eFile is part of a process. Remove it from the process first.');
  tx(() => { run('DELETE FROM efile WHERE id=?', e.id); log(c, 'efile', 'remove', `删除eFile:${e.name}`); });
  return {};
 },
 async 'efile.unlock'(c, b) {
  const e = openEfile(c, b.id);
  if (!e.password) return {ok: true};
  const [salt, hash] = e.password.split(':');
  check(equal(await hashPassword(String(b.password ?? ''), salt), hash), 'Incorrect eFile password.');
  return {ok: true};
 },
 // Set Confirmation: up to five titled steps, each with one or more users.
 'efile.steps.save'(c, b) {
  const e = openEfile(c, b.id, 'admin');
  const list = (Array.isArray(b.steps) ? b.steps : []).slice(0, 5);
  tx(() => {
   run('DELETE FROM efile_step WHERE efile_id=?', e.id); run('DELETE FROM efile_step_user WHERE efile_id=?', e.id);
   list.forEach((s: any, i: number) => {
    const users = companyUsers(c, s.users); if (!users.length) return;
    run('INSERT INTO efile_step(efile_id,position,title) VALUES(?,?,?)', e.id, i + 1, text(s.title, 200) || `${['1st', '2nd', '3rd', '4th', '5th'][i]} Confirmation`);
    for (const u of users) run('INSERT INTO efile_step_user(efile_id,position,user_id) VALUES(?,?,?)', e.id, i + 1, u);
   });
   log(c, 'efile', 'modify', `设置确认:${e.name}`);
  });
  return {};
 },
 // Set Grand Balance/Sum
 'efile.balance.save'(c, b) {
  const e = openEfile(c, b.id, 'admin');
  tx(() => {
   run('UPDATE efile SET balance=?,balance_alias=?,notional=?,notional_alias=?,updated_at=? WHERE id=?', cents(b.balance, 'Balance/Sum'), text(b.balance_alias, 200), cents(b.notional, 'Notional Balance/Sum'), text(b.notional_alias, 200), now(), e.id);
   log(c, 'efile', 'modify', `设置总余额:${e.name}`);
  });
  return {};
 },
 'efile.copy'(c, b) {
  need(c, 'efile'); const e = openEfile(c, b.id);
  const shareWith = companyUsers(c, b.shareWith);
  return tx(() => {
   const id = copyEfile(c, e, text(b.name, 300) || `${e.name} - Copy`);
   for (const u of shareWith) run('INSERT OR IGNORE INTO efile_share(efile_id,user_id) VALUES(?,?)', id, u);
   log(c, 'efile', 'add', `复制eFile:${e.name}`);
   return {id};
  });
 },
 async 'efile.bulk'(c, b) {
  const op = text(b.op, 40); const list = ids(b.ids); check(list.length, 'Select at least one eFile.');
  const adminOps = ['share', 'share.cancel', 'shareBalance', 'shareBalance.cancel', 'password', 'password.cancel', 'users.add', 'users.remove', 'user.replace', 'name.replace', 'name.insert', 'archive', 'archive.cancel'];
  const files = list.map(id => openEfile(c, id, adminOps.includes(op) ? 'admin' : 'member'));
  const users = companyUsers(c, b.users);
  let password = '';
  if (op === 'password') { validPassword(b.password); const salt = uid(); password = `${salt}:${await hashPassword(b.password, salt)}`; }
  tx(() => {
   for (const e of files) {
    switch (op) {
     case 'my.add': personal(c, e.id, 'in_my=1'); break;
     case 'my.remove': personal(c, e.id, 'in_my=0'); break;
     case 'mtt': personal(c, e.id, 'mtt=1'); break;
     case 'mtt.cancel': personal(c, e.id, 'mtt=0'); break;
     case 'hide': personal(c, e.id, 'hidden=1'); break;
     case 'hide.cancel': personal(c, e.id, 'hidden=0'); break;
     case 'color': personal(c, e.id, 'color=?', color(b.color)); break;
     case 'link.add': personal(c, e.id, 'link=1'); break;
     case 'link.remove': personal(c, e.id, 'link=0'); break;
     case 'share': for (const u of users) run('INSERT OR IGNORE INTO efile_share(efile_id,user_id) VALUES(?,?)', e.id, u); break;
     case 'share.cancel': run('DELETE FROM efile_share WHERE efile_id=?', e.id); break;
     case 'shareBalance': for (const u of users) run('INSERT INTO efile_share(efile_id,user_id,balance) VALUES(?,?,1) ON CONFLICT DO UPDATE SET balance=1', e.id, u); break;
     case 'shareBalance.cancel': run('UPDATE efile_share SET balance=0 WHERE efile_id=?', e.id); break;
     case 'password': run('UPDATE efile SET password=? WHERE id=?', password, e.id); break;
     case 'password.cancel': run(`UPDATE efile SET password='' WHERE id=?`, e.id); break;
     case 'users.add': for (const u of users) run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id) VALUES(?,'participant',?)`, e.id, u); break;
     case 'users.remove': for (const u of users) run(`DELETE FROM efile_member WHERE efile_id=? AND user_id=? AND kind='participant'`, e.id, u); break;
     case 'user.replace': {
      const [from, to] = [text(b.from, 64), text(b.to, 64)]; check(companyUsers(c, [from, to]).length === 2, 'Choose both users.');
      run('UPDATE OR IGNORE efile_member SET user_id=? WHERE efile_id=? AND user_id=?', to, e.id, from); run('DELETE FROM efile_member WHERE efile_id=? AND user_id=?', e.id, from);
      run('UPDATE OR IGNORE efile_step_user SET user_id=? WHERE efile_id=? AND user_id=?', to, e.id, from); run('DELETE FROM efile_step_user WHERE efile_id=? AND user_id=?', e.id, from);
      break;
     }
     case 'name.replace': { const find = text(b.find, 100); check(find, 'Enter the text to replace.'); run('UPDATE efile SET name=? WHERE id=?', e.name.split(find).join(text(b.replace, 100)) || e.name, e.id); break; }
     case 'name.insert': { const ins = text(b.text, 100); check(ins, 'Enter the text to insert.'); run('UPDATE efile SET name=? WHERE id=?', b.position === 'end' ? e.name + ins : ins + e.name, e.id); break; }
     case 'archive': check(!get(`SELECT 1 FROM process_run r JOIN item i ON i.id=r.stage_item_id WHERE i.efile_id=? AND r.status='running'`, e.id), `${e.name} has items in a running process.`); run('UPDATE efile SET archived=1 WHERE id=?', e.id); break;
     case 'archive.cancel': run('UPDATE efile SET archived=0 WHERE id=?', e.id); break;
     default: check(false, 'This function is not available.');
    }
   }
   if (adminOps.includes(op)) log(c, 'efile', 'modify', `批量操作(${op}):${files.map(f => f.name).join(', ')}`);
  });
  return {count: files.length};
 },
 // eFile Process Monitor + Relevant eFile List
 'efile.monitor'(c, b) {
  const e = openEfile(c, b.id);
  const processes = all('SELECT DISTINCT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? ORDER BY p.name', e.id);
  const stageRows = (pid: string) => all(`SELECT s.position, s.efile_id, f.name, (SELECT COUNT(*) FROM process_run r WHERE r.process_id=s.process_id AND r.stage=s.position AND r.status='running') AS items
   FROM process_stage s JOIN efile f ON f.id=s.efile_id WHERE s.process_id=? ORDER BY s.position`, pid);
  const main = processes.find(p => get('SELECT 1 FROM process_stage WHERE process_id=? AND position=1 AND efile_id=?', p.id, e.id)) ?? processes[0];
  return {efile: {id: e.id, name: e.name}, stages: main ? stageRows(main.id) : [],
   relevant: processes.map(p => {
    const first = get('SELECT f.id, f.name FROM process_stage s JOIN efile f ON f.id=s.efile_id WHERE s.process_id=? AND s.position=1', p.id);
    return {id: p.id, name: p.name, first_efile_id: first?.id, first_efile: first?.name ?? '', items: get(`SELECT COUNT(*) AS n FROM process_run WHERE process_id=? AND status='running'`, p.id)!.n};
   })};
 },
 // Name lookup for pickers of eFiles (Set Process, item links).
 'efile.options'(c) { const [cond, params] = visible(c); return all(`SELECT e.id,e.name FROM efile e WHERE e.archived=0 AND ${cond} ORDER BY e.name`, ...params); },
 'efile.colors'() { return COLORS; },
 // System Link: company-wide shortcuts to other systems, kept by users who may create eFiles.
 'systemlink.list'(c) { return all('SELECT * FROM system_link WHERE company_id=? ORDER BY name', c.companyId); },
 'systemlink.save'(c, b) {
  need(c, 'efile');
  const name = required(b.name, 'Name', 200), url = required(b.url, 'Link', 1000);
  check(/^https?:\/\//i.test(url), 'The link must start with http:// or https://');
  return tx(() => {
   if (b.id) { const r = get('SELECT * FROM system_link WHERE id=? AND company_id=?', text(b.id, 64), c.companyId); check(r, 'Link is unavailable.'); run('UPDATE system_link SET name=?,url=? WHERE id=?', name, url, r!.id); log(c, 'efile', 'modify', `修改系统链接:${name}`); return {id: r!.id}; }
   const id = uid(); run('INSERT INTO system_link(id,company_id,name,url,created_at) VALUES(?,?,?,?,?)', id, c.companyId, name, url, now()); log(c, 'efile', 'add', `新增系统链接:${name}`); return {id};
  });
 },
 'systemlink.delete'(c, b) {
  need(c, 'efile'); const r = get('SELECT * FROM system_link WHERE id=? AND company_id=?', text(b.id, 64), c.companyId); check(r, 'Link is unavailable.');
  tx(() => { run('DELETE FROM system_link WHERE id=?', r!.id); log(c, 'efile', 'remove', `删除系统链接:${r!.name}`); });
  return {};
 },
};
