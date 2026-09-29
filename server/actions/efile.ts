// IMS → My eFile: the eFile list, setup form, bulk actions, sharing, approval steps and balances.
import {all, get, run, uid, now, tx, type Row} from '../db';
import {check, hashPassword, validPassword, equal} from '../auth';
import {type Ctx, needPerm, text, required, bool, ids, cents, userLabel, log, fmt, eligibleContact, userPerms, notify, companyAdmin} from '../ctx';
import {visible, efile as openEfile, liveAdmins} from '../access';

export const COLORS = ['', 'Blue', 'Teal', 'Green', 'Yellow', 'Orange', 'Red', 'Purple', 'Grey', 'Personalised 1', 'Personalised 2', 'Personalised 3', 'Personalised 4', 'Personalised 5'];
// Standard ISO 4217 codes offered for amounts.
export const CURRENCIES = ['CNY', 'HKD', 'USD', 'EUR', 'GBP', 'JPY', 'SGD', 'MOP', 'TWD', 'AUD', 'CAD', 'CHF', 'KRW', 'MYR', 'THB', 'NZD'];
const color = (v: any) => COLORS.includes(v) ? v : '';
const MAX_STEPS = 20;

const labels = (rows: Row[]) => rows.map(u => ({id: u.id, label: u.username, name: userLabel(u), rights: u.rights, external: !!u.external}));
function members(e: Row, kind: string) { return labels(all('SELECT u.*, m.rights, u.company_id<>? AS external FROM user u JOIN efile_member m ON m.user_id=u.id WHERE m.efile_id=? AND m.kind=? ORDER BY u.username', e.company_id, e.id, kind)); }
function groups(id: string, kind: string) { return all('SELECT g.id, g.name AS label, eg.rights FROM user_group g JOIN efile_group eg ON eg.group_id=g.id WHERE eg.efile_id=? AND eg.kind=? ORDER BY g.name', id, kind); }
export function steps(id: string): Row[] {
 return all('SELECT position,title FROM efile_step WHERE efile_id=? ORDER BY position', id).map(s => ({...s,
  users: labels(all('SELECT u.* FROM user u JOIN efile_step_user su ON su.user_id=u.id WHERE su.efile_id=? AND su.position=? ORDER BY u.username', id, s.position))}));
}
// Balance/Sum = opening balance + every entered amount; Notional = notional opening + amounts of items not yet final. Blank amounts count as nothing.
export const FINAL = ['approved', 'rejected'];
export function balances(e: Row) {
 const r = get(`SELECT COALESCE(SUM(amount),0) AS total, COALESCE(SUM(CASE WHEN done=0 AND status NOT IN ('approved','rejected') THEN amount ELSE 0 END),0) AS open FROM item WHERE efile_id=? AND archived=0`, e.id)!;
 return {balance: e.balance + r.total, notional: e.notional + r.open};
}
function personal(c: Ctx, efileId: string, set: string, ...values: any[]) {
 run(`INSERT INTO user_efile(user_id,efile_id) VALUES(?,?) ON CONFLICT(user_id,efile_id) DO NOTHING`, c.user.id, efileId);
 run(`UPDATE user_efile SET ${set} WHERE user_id=? AND efile_id=?`, ...values, c.user.id, efileId);
}
export const touch = (efileId: string) => run('UPDATE efile SET updated_at=? WHERE id=?', now(), efileId);
const contacts = (companyId: string, list: any, label = 'user') => ids(list).map(u => { check(eligibleContact(companyId, u), `A selected ${label} is not your company's staff or an approved connection contact.`); return u; });
const companyGroups = (companyId: string, list: any) => ids(list).map(g => { check(get('SELECT id FROM user_group WHERE id=? AND company_id=?', g, companyId), 'A selected group is unavailable.'); return g; });
const rightOf = (v: any) => v === 'view' ? 'view' : 'edit';

function copyEfile(c: Ctx, e: Row, name: string) {
 const id = uid(), t = now();
 run(`INSERT INTO efile(id,company_id,name,tag,select_type,highlight,color,report_name,show_date,show_amount,currency,approval,balance_alias,notional_alias,created_by,created_at,updated_at)
  SELECT ?,company_id,?,tag,select_type,highlight,color,report_name,show_date,show_amount,currency,approval,balance_alias,notional_alias,?,?,? FROM efile WHERE id=?`, id, name, c.user.id, t, t, e.id);
 run('INSERT INTO efile_member(efile_id,kind,user_id,rights) SELECT ?,kind,user_id,rights FROM efile_member WHERE efile_id=?', id, e.id);
 run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id) VALUES(?,'participant',?)`, id, c.user.id);
 if (userPerms(c.user).has('efileAdmin')) run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id) VALUES(?,'admin',?)`, id, c.user.id);
 run('INSERT INTO efile_group(efile_id,kind,group_id,rights) SELECT ?,kind,group_id,rights FROM efile_group WHERE efile_id=?', id, e.id);
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
  if (view === 'my') where.push('COALESCE(ue.in_my,1)=1', notHidden, 'e.archived=0');
  else if (view === 'explorer') where.push('e.archived=0');
  else if (view === 'mine') { where.push('e.created_by=?', 'e.archived=0'); args.push(c.user.id); }
  else if (view === 'recent') where.push(notHidden, 'e.archived=0');
  else if (view === 'links') where.push('COALESCE(ue.link,0)=1', 'e.archived=0');
  else if (view === 'hidden') where.push('COALESCE(ue.hidden,0)=1');
  else if (view === 'archive') where.push('e.archived=1');
  else if (view === 'process') where.push('e.id IN (SELECT efile_id FROM process_stage)', 'e.archived=0');
  else if (view === 'confirmation') { where.push('e.id IN (SELECT efile_id FROM efile_step_user WHERE user_id=?)', 'e.archived=0'); args.push(c.user.id); }
  else if (view === 'color') { where.push(`COALESCE(NULLIF(ue.color,''),e.color)=?`, 'e.archived=0'); args.push(color(b.color)); }
  const q = text(b.q, 100); if (q) { where.push('(e.name LIKE ? OR e.tag LIKE ?)'); args.push(`%${q}%`, `%${q}%`); }
  const order = view === 'recent' ? 'e.updated_at DESC' : 'COALESCE(ue.mtt,0) DESC, e.created_at';
  return all(`SELECT e.id,e.name,e.tag,e.highlight,e.archived,e.updated_at,e.approval, COALESCE(NULLIF(ue.color,''),e.color) AS color, COALESCE(ue.mtt,0) AS mtt,
    e.password<>'' AS locked, EXISTS(SELECT 1 FROM process_stage ps WHERE ps.efile_id=e.id) AS in_process, e.created_by=? AS mine,
    EXISTS(SELECT 1 FROM efile_share s WHERE s.efile_id=e.id) AS shared, COALESCE(ue.in_my,1) AS in_my, COALESCE(ue.hidden,0) AS hidden
   FROM efile e LEFT JOIN user_efile ue ON ue.efile_id=e.id AND ue.user_id=? WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 2000`, c.user.id, c.user.id, ...args);
 },
 'efile.get'(c, b) {
  const e = openEfile(c, b.id); const {password, ...safe} = e;
  const bal = balances(e);
  return {...safe, locked: !!password, participants: members(e, 'participant'), admins: members(e, 'admin'), groups: groups(e.id, 'participant'),
   wechat_participants: members(e, 'wechat'), wechat_groups: groups(e.id, 'wechat'), steps: steps(e.id), colors: COLORS, currencies: CURRENCIES,
   balance_total: fmt(bal.balance), notional_total: fmt(bal.notional), balance_open: fmt(e.balance), notional_open: fmt(e.notional),
   admin_fallback: !liveAdmins(e.id).length};
 },
 'efile.form'() { return {colors: COLORS, currencies: CURRENCIES}; },
 'efile.save'(c, b) {
  const existing = b.id ? openEfile(c, b.id, 'admin') : null;
  if (!existing) needPerm(c, 'createFile', 'Your level does not allow creating eFiles.');
  if (existing) check(Number(b.version) === existing.version, 'Someone else changed this eFile. Reload it and make your change again.');
  const companyId = existing?.company_id ?? c.companyId;
  const f = {name: required(b.name, 'Name', 300), tag: text(b.tag, 300), highlight: bool(b.highlight), color: color(b.color), report_name: text(b.report_name, 200),
   show_date: bool(b.show_date ?? 1), show_amount: bool(b.show_amount ?? 1), currency: CURRENCIES.includes(b.currency) ? b.currency : 'CNY', approval: bool(b.approval)};
  // Participants carry a right: view or edit. Cross-company users must be approved connection contacts.
  const parts: [string, string][] = (Array.isArray(b.participants) ? b.participants : []).map((p: any) => typeof p === 'string' ? [p, 'edit'] : [text(p.id, 64), rightOf(p.rights)]);
  contacts(companyId, parts.map(p => p[0]), 'participant');
  const grps: [string, string][] = (Array.isArray(b.groups) ? b.groups : []).map((g: any) => typeof g === 'string' ? [g, 'edit'] : [text(g.id, 64), rightOf(g.rights)]);
  companyGroups(companyId, grps.map(g => g[0]));
  const admins = contacts(companyId, b.admins, 'administrator');
  if (!existing && !admins.length && userPerms(c.user).has('efileAdmin')) admins.push(c.user.id);
  for (const a of admins) check(userPerms(get('SELECT * FROM user WHERE id=?', a)!).has('efileAdmin'), `${get('SELECT username FROM user WHERE id=?', a)!.username} does not hold the eFile administration function.`);
  check(parts.length || grps.length, 'Choose at least one participant or group.');
  check(admins.length, 'Choose at least one eFile Admin.');
  for (const a of admins) if (!parts.some(p => p[0] === a)) parts.push([a, 'edit']);
  if (f.approval) check(existing ? all('SELECT 1 FROM efile_step WHERE efile_id=?', existing.id).length : true, 'Set the approval steps (Set Confirmation) before requiring approval.');
  return tx(() => {
   const id = existing?.id ?? uid(), t = now();
   if (existing) run('UPDATE efile SET name=?,tag=?,highlight=?,color=?,report_name=?,show_date=?,show_amount=?,currency=?,approval=?,version=version+1,updated_at=? WHERE id=?',
    f.name, f.tag, f.highlight, f.color, f.report_name, f.show_date, f.show_amount, f.currency, f.approval, t, id);
   else run('INSERT INTO efile(id,company_id,name,tag,highlight,color,report_name,show_date,show_amount,currency,approval,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, companyId, f.name, f.tag, f.highlight, f.color, f.report_name, f.show_date, f.show_amount, f.currency, f.approval, c.user.id, t, t);
   const before = new Set(all(`SELECT user_id FROM efile_member WHERE efile_id=? AND kind IN ('participant','admin')`, id).map(r => r.user_id));
   run('DELETE FROM efile_member WHERE efile_id=?', id); run('DELETE FROM efile_group WHERE efile_id=?', id);
   for (const [u, r] of parts) run(`INSERT OR REPLACE INTO efile_member(efile_id,kind,user_id,rights) VALUES(?,'participant',?,?)`, id, u, r);
   for (const u of admins) run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id) VALUES(?,'admin',?)`, id, u);
   for (const u of contacts(companyId, b.wechat_participants)) run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id) VALUES(?,'wechat',?)`, id, u);
   for (const [g, r] of grps) run(`INSERT OR REPLACE INTO efile_group(efile_id,kind,group_id,rights) VALUES(?,'participant',?,?)`, id, g, r);
   for (const g of companyGroups(companyId, b.wechat_groups)) run(`INSERT OR IGNORE INTO efile_group(efile_id,kind,group_id) VALUES(?,'wechat',?)`, id, g);
   const after = new Set([...parts.map(p => p[0]), ...admins]);
   notify([...[...after].filter(u => !before.has(u)), ...[...before].filter(u => !after.has(u))].filter(u => u !== c.user.id), 'access', `Your access to eFile "${f.name}" changed.`, id);
   log(c, 'efile', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}eFile:${f.name}`, companyId);
   return {id};
  });
 },
 // Only eFiles whose items were never submitted can be deleted; anything with approval history is archived instead.
 'efile.delete'(c, b) {
  const e = openEfile(c, b.id, 'admin');
  check(!get('SELECT 1 FROM process_stage WHERE efile_id=?', e.id), 'This eFile is part of a process. Remove it from the process first.');
  check(!get(`SELECT 1 FROM item WHERE efile_id=? AND (round>0 OR status NOT IN ('draft','none'))`, e.id), 'This eFile has submitted items. Archive it instead; approval history is never deleted.');
  tx(() => { run('DELETE FROM efile WHERE id=?', e.id); log(c, 'efile', 'remove', `删除eFile:${e.name}`, e.company_id); });
  return {};
 },
 async 'efile.unlock'(c, b) {
  const e = openEfile(c, b.id);
  if (!e.password) return {ok: true};
  const [salt, hash] = e.password.split(':');
  check(equal(await hashPassword(String(b.password ?? ''), salt), hash), 'Incorrect eFile password.');
  return {ok: true};
 },
 // Set Confirmation = approval steps: ordered names and eligible approvers. Only future submissions use a change.
 'efile.steps.save'(c, b) {
  const e = openEfile(c, b.id, 'admin');
  const list = (Array.isArray(b.steps) ? b.steps : []).filter((s: any) => ids(s.users).length).slice(0, MAX_STEPS);
  for (const s of list) for (const u of ids(s.users)) {
   check(eligibleContact(e.company_id, u), 'An approver is not your company\'s staff or an approved connection contact.');
   const who = get('SELECT * FROM user WHERE id=?', u)!; check(userPerms(who).has('approve'), `${who.username} does not hold the approval function.`);
  }
  if (e.approval) check(list.length, 'This eFile requires approval, so it needs at least one step.');
  tx(() => {
   run('DELETE FROM efile_step WHERE efile_id=?', e.id); run('DELETE FROM efile_step_user WHERE efile_id=?', e.id);
   list.forEach((s: any, i: number) => {
    run('INSERT INTO efile_step(efile_id,position,title) VALUES(?,?,?)', e.id, i + 1, text(s.title, 200) || `Step ${i + 1}`);
    for (const u of ids(s.users)) run('INSERT INTO efile_step_user(efile_id,position,user_id) VALUES(?,?,?)', e.id, i + 1, u);
   });
   if (b.approval !== undefined) run('UPDATE efile SET approval=?, version=version+1 WHERE id=?', bool(b.approval) && list.length ? 1 : 0, e.id);
   log(c, 'efile', 'modify', `设置审批步骤:${e.name} (${list.length})`, e.company_id);
  });
  return {};
 },
 // Set Grand Balance/Sum
 'efile.balance.save'(c, b) {
  const e = openEfile(c, b.id, 'admin');
  tx(() => {
   run('UPDATE efile SET balance=?,balance_alias=?,notional=?,notional_alias=?,updated_at=? WHERE id=?', cents(b.balance, 'Balance/Sum') ?? 0, text(b.balance_alias, 200), cents(b.notional, 'Notional Balance/Sum') ?? 0, text(b.notional_alias, 200), now(), e.id);
   log(c, 'efile', 'modify', `设置总余额:${e.name}`, e.company_id);
  });
  return {};
 },
 'efile.copy'(c, b) {
  needPerm(c, 'createFile', 'Your level does not allow creating eFiles.'); const e = openEfile(c, b.id);
  const shareWith = contacts(e.company_id, b.shareWith);
  return tx(() => {
   const id = copyEfile(c, e, text(b.name, 300) || `${e.name} - Copy`);
   for (const u of shareWith) run('INSERT OR IGNORE INTO efile_share(efile_id,user_id) VALUES(?,?)', id, u);
   notify(shareWith, 'access', `An eFile was shared with you: ${e.name}`, id);
   log(c, 'efile', 'add', `复制eFile:${e.name}`, e.company_id);
   return {id};
  });
 },
 async 'efile.bulk'(c, b) {
  const op = text(b.op, 40); const list = ids(b.ids); check(list.length, 'Select at least one eFile.');
  const adminOps = ['share', 'share.cancel', 'shareBalance', 'shareBalance.cancel', 'password', 'password.cancel', 'users.add', 'users.remove', 'user.replace', 'name.replace', 'name.insert', 'archive', 'archive.cancel'];
  const files = list.map(id => openEfile(c, id, adminOps.includes(op) ? 'admin' : 'view'));
  let password = '';
  if (op === 'password') { validPassword(b.password); const salt = uid(); password = `${salt}:${await hashPassword(b.password, salt)}`; }
  tx(() => {
   for (const e of files) {
    const users = () => contacts(e.company_id, b.users);
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
     case 'share': for (const u of users()) run('INSERT OR IGNORE INTO efile_share(efile_id,user_id) VALUES(?,?)', e.id, u); notify(users(), 'access', `An eFile was shared with you: ${e.name}`, e.id); break;
     case 'share.cancel': run('DELETE FROM efile_share WHERE efile_id=?', e.id); break;
     case 'shareBalance': for (const u of users()) run('INSERT INTO efile_share(efile_id,user_id,balance) VALUES(?,?,1) ON CONFLICT DO UPDATE SET balance=1', e.id, u); break;
     case 'shareBalance.cancel': run('UPDATE efile_share SET balance=0 WHERE efile_id=?', e.id); break;
     case 'password': run('UPDATE efile SET password=? WHERE id=?', password, e.id); break;
     case 'password.cancel': run(`UPDATE efile SET password='' WHERE id=?`, e.id); break;
     case 'users.add': for (const u of users()) run(`INSERT OR IGNORE INTO efile_member(efile_id,kind,user_id,rights) VALUES(?,'participant',?,?)`, e.id, u, rightOf(b.rights)); notify(users(), 'access', `You were added to eFile "${e.name}".`, e.id); break;
     case 'users.remove': for (const u of ids(b.users)) run(`DELETE FROM efile_member WHERE efile_id=? AND user_id=? AND kind='participant'`, e.id, u); notify(ids(b.users), 'access', `You were removed from eFile "${e.name}".`); break;
     case 'user.replace': {
      const from = text(b.from, 64), [to] = contacts(e.company_id, [b.to]);
      run('UPDATE OR IGNORE efile_member SET user_id=? WHERE efile_id=? AND user_id=?', to, e.id, from); run('DELETE FROM efile_member WHERE efile_id=? AND user_id=?', e.id, from);
      if (get('SELECT 1 FROM efile_step_user WHERE efile_id=? AND user_id=?', e.id, from)) {
       check(userPerms(get('SELECT * FROM user WHERE id=?', to)!).has('approve'), 'The replacement does not hold the approval function.');
       run('UPDATE OR IGNORE efile_step_user SET user_id=? WHERE efile_id=? AND user_id=?', to, e.id, from); run('DELETE FROM efile_step_user WHERE efile_id=? AND user_id=?', e.id, from);
      }
      break;
     }
     case 'name.replace': { const find = text(b.find, 100); check(find, 'Enter the text to replace.'); run('UPDATE efile SET name=? WHERE id=?', e.name.split(find).join(text(b.replace, 100)) || e.name, e.id); break; }
     case 'name.insert': { const ins = text(b.text, 100); check(ins, 'Enter the text to insert.'); run('UPDATE efile SET name=? WHERE id=?', b.position === 'end' ? e.name + ins : ins + e.name, e.id); break; }
     case 'archive': check(!get(`SELECT 1 FROM item WHERE efile_id=? AND status='pending'`, e.id), `${e.name} has items waiting for approval.`); check(!get(`SELECT 1 FROM process_run r JOIN item i ON i.id=r.stage_item_id WHERE i.efile_id=? AND r.status='running'`, e.id), `${e.name} has items in a running process.`); run('UPDATE efile SET archived=1 WHERE id=?', e.id); break;
     case 'archive.cancel': run('UPDATE efile SET archived=0 WHERE id=?', e.id); break;
     default: check(false, 'This function is not available.');
    }
    if (adminOps.includes(op)) { run('UPDATE efile SET version=version+1 WHERE id=?', e.id); if (op.startsWith('users') || op === 'user.replace') check(liveAdmins(e.id).length || companyAdmin(c, e.company_id), 'An eFile must keep an administrator.'); }
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
  needPerm(c, 'createFile');
  const name = required(b.name, 'Name', 200), url = required(b.url, 'Link', 1000);
  check(/^https?:\/\//i.test(url), 'The link must start with http:// or https://');
  return tx(() => {
   if (b.id) { const r = get('SELECT * FROM system_link WHERE id=? AND company_id=?', text(b.id, 64), c.companyId); check(r, 'Link is unavailable.'); run('UPDATE system_link SET name=?,url=? WHERE id=?', name, url, r!.id); log(c, 'efile', 'modify', `修改系统链接:${name}`); return {id: r!.id}; }
   const id = uid(); run('INSERT INTO system_link(id,company_id,name,url,created_at) VALUES(?,?,?,?,?)', id, c.companyId, name, url, now()); log(c, 'efile', 'add', `新增系统链接:${name}`); return {id};
  });
 },
 'systemlink.delete'(c, b) {
  needPerm(c, 'createFile'); const r = get('SELECT * FROM system_link WHERE id=? AND company_id=?', text(b.id, 64), c.companyId); check(r, 'Link is unavailable.');
  tx(() => { run('DELETE FROM system_link WHERE id=?', r!.id); log(c, 'efile', 'remove', `删除系统链接:${r!.name}`); });
  return {};
 },
};
