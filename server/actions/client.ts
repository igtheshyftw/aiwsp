// IMS → Client Management. A client record belongs to the company that serves the client (normally WSP) and may be linked to
// the client's own company account. Its service team (users or user groups) serves the client: the team is offered as the
// participants of the client's new eFiles and receives the client's AiWSP Assistant conversations.
import {all, get, run, uid, tx, type Row} from '../db';
import {check, live} from '../auth';
import {type Ctx, allowed, needPerm, text, required, ids, find, userLabel, log, eligibleContact, OPEN_ITEM, today} from '../ctx';
import {visible} from '../access';

// Live users on a client's service team: the named users, or the members of the chosen groups.
export function teamUsers(clientId: string): string[] {
 return all(`SELECT ref_id AS id FROM client_team WHERE client_id=? AND kind='user'
  UNION SELECT m.user_id FROM client_team t JOIN user_group_member m ON m.group_id=t.ref_id WHERE t.client_id=? AND t.kind='group'`, clientId, clientId)
  .map(r => r.id as string).filter(id => live(get('SELECT * FROM user WHERE id=?', id)));
}
// Clients whose service team includes this user, directly or through a group.
export function myClientIds(userId: string): string[] {
 return all(`SELECT client_id FROM client_team WHERE kind='user' AND ref_id=?
  UNION SELECT t.client_id FROM client_team t JOIN user_group_member m ON m.group_id=t.ref_id AND m.user_id=? WHERE t.kind='group'`, userId, userId).map(r => r.client_id);
}
// The service team of a client company account, as served by one company (WSP).
export function companyTeam(ownerId: string, accountCompanyId: string): string[] {
 return [...new Set(all('SELECT id FROM client WHERE company_id=? AND account_company_id=?', ownerId, accountCompanyId).flatMap(r => teamUsers(r.id)))];
}
// Client company accounts this user serves (for the Assistant inbox).
export function servedCompanies(c: Ctx): string[] {
 const mine = myClientIds(c.user.id); if (!mine.length) return [];
 return all(`SELECT DISTINCT account_company_id AS id FROM client WHERE company_id=? AND account_company_id IS NOT NULL AND id IN (${mine.map(() => '?').join(',')})`, c.companyId, ...mine).map(r => r.id);
}
// Company accounts a client record may be linked to: any other company for a System Admin, otherwise connected companies.
function accountChoices(c: Ctx): Row[] {
 return c.sys ? all('SELECT id, name_cn, name_en FROM company WHERE id<>? ORDER BY name_cn', c.companyId)
  : all(`SELECT co.id, co.name_cn, co.name_en FROM connection cn JOIN company co ON co.id = CASE WHEN cn.from_company=? THEN cn.to_company ELSE cn.from_company END
     WHERE cn.status='connected' AND (cn.from_company=? OR cn.to_company=?) ORDER BY co.name_cn`, c.companyId, c.companyId, c.companyId);
}
const companyName = (id: string | null) => { const co = id ? get('SELECT name_cn, name_en FROM company WHERE id=?', id) : null; return co ? (co.name_en && co.name_en !== co.name_cn ? `${co.name_cn} (${co.name_en})` : co.name_cn) : ''; };
function team(r: Row) {
 return {users: all(`SELECT u.* FROM client_team t JOIN user u ON u.id=t.ref_id WHERE t.client_id=? AND t.kind='user' ORDER BY u.username`, r.id).map(u => ({id: u.id, label: userLabel(u)})),
  groups: all(`SELECT g.id, g.name AS label FROM client_team t JOIN user_group g ON g.id=t.ref_id WHERE t.client_id=? AND t.kind='group' ORDER BY g.name`, r.id)};
}
// Client Management needs the "client" function; a service team member may always open their own clients.
function openClient(c: Ctx, id: any, edit = false) {
 const r = find('client', id, 'Client'); check(r.company_id === c.companyId, 'Client is unavailable.');
 check(allowed(c, 'client') || (!edit && myClientIds(c.user.id).includes(r.id)), 'Client is unavailable.');
 return r;
}

export const clientActions: Record<string, (c: Ctx, b: any) => any> = {
 'client.list'(c, b) {
  const mine = new Set(myClientIds(c.user.id));
  const full = allowed(c, 'client');
  check(full || mine.size, 'Your level does not include Client Management.');
  const rows = all('SELECT * FROM client WHERE company_id=? ORDER BY code', c.companyId).filter(r => (full && !b.mine) || mine.has(r.id));
  return {can_manage: full, rows: rows.map(r => ({...r, mine: mine.has(r.id), account: companyName(r.account_company_id),
   efiles: get('SELECT COUNT(*) AS n FROM efile WHERE client_id=? AND archived=0', r.id)!.n}))};
 },
 'client.form'(c) { needPerm(c, 'client'); return {accounts: accountChoices(c).map(co => ({id: co.id, label: companyName(co.id)}))}; },
 'client.get'(c, b) { const r = openClient(c, b.id, true); return {...r, ...team(r)}; },
 // Client Info, three steps: 1 Basic Info, 2 Background Info (profile), 3 Service Team (users or user groups).
 'client.save'(c, b) {
  needPerm(c, 'client');
  const f = {code: required(b.code, 'Code', 40), name_cn: required(b.name_cn, 'CN Name', 120), name_en: required(b.name_en, 'EN Name', 120), phone: text(b.phone, 40), fax: text(b.fax, 40),
   introducer: text(b.introducer, 120), website: text(b.website, 200), address: text(b.address, 300), business: text(b.business, 300), remark: text(b.remark, 2000),
   team_type: b.team_type === 'user' ? 'user' : 'group', account_company_id: text(b.account_company_id, 64) || null};
  const existing = b.id ? openClient(c, b.id, true) : null;
  if (f.account_company_id && f.account_company_id !== existing?.account_company_id) {
   check(accountChoices(c).some(co => co.id === f.account_company_id), 'Link the client to a connected company account.');
   check(!get('SELECT 1 FROM client WHERE company_id=? AND account_company_id=? AND id<>?', c.companyId, f.account_company_id, existing?.id ?? ''), 'Another client is already linked to this company account.');
  }
  const refs = f.team_type === 'user' ? ids(b.users) : ids(b.groups);
  for (const r of refs) check(f.team_type === 'user' ? eligibleContact(c.companyId, r) : get('SELECT 1 FROM user_group WHERE id=? AND company_id=?', r, c.companyId),
   f.team_type === 'user' ? 'Service team users must be your staff or approved connection contacts.' : 'Choose groups of your company.');
  check(!get('SELECT id FROM client WHERE company_id=? AND code=? AND id<>?', c.companyId, f.code, existing?.id ?? ''), 'This client code is already used.');
  return tx(() => {
   const id = existing?.id ?? uid(); const cols = Object.keys(f); const vals = Object.values(f);
   if (existing) run(`UPDATE client SET ${cols.map(k => k + '=?').join(',')} WHERE id=?`, ...vals, id);
   else run(`INSERT INTO client(id,company_id,${cols.join(',')}) VALUES(?,?,${cols.map(() => '?').join(',')})`, id, c.companyId, ...vals);
   run('DELETE FROM client_team WHERE client_id=?', id);
   for (const r of refs) run('INSERT INTO client_team(client_id,kind,ref_id) VALUES(?,?,?)', id, f.team_type, r);
   log(c, 'client', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}客户:${f.code}`); return {id};
  });
 },
 'client.delete'(c, b) {
  const r = openClient(c, b.id, true);
  tx(() => { run('DELETE FROM client WHERE id=?', r.id); log(c, 'client', 'remove', `删除客户:${r.code}`); }); return {};
 },
 // One page per client: details, service team, the client's eFiles this user takes part in, with open and overdue work.
 'client.view'(c, b) {
  const r = openClient(c, b.id);
  const [cond, args] = visible(c);
  const efiles = all(`SELECT e.id, e.name, e.archived,
    (SELECT COUNT(*) FROM item i WHERE i.efile_id=e.id AND ${OPEN_ITEM}) AS open,
    (SELECT COUNT(*) FROM item i WHERE i.efile_id=e.id AND ${OPEN_ITEM} AND i.target_date<>'' AND i.target_date<?) AS overdue,
    (SELECT COUNT(*) FROM item i WHERE i.efile_id=e.id AND i.status='pending') AS pending,
    (SELECT MIN(i.target_date) FROM item i WHERE i.efile_id=e.id AND ${OPEN_ITEM} AND i.target_date<>'') AS next_due
   FROM efile e WHERE e.client_id=? AND ${cond} ORDER BY e.archived, e.name`, today(), r.id, ...args);
  const hidden = get('SELECT COUNT(*) AS n FROM efile WHERE client_id=?', r.id)!.n - efiles.length;
  const account = r.account_company_id ? get('SELECT id, name_cn, name_en, status FROM company WHERE id=?', r.account_company_id) : null;
  return {client: {...r, ...team(r)}, account: account && {...account, label: companyName(account.id),
   users: get(`SELECT COUNT(*) AS n FROM user WHERE company_id=? AND state='normal'`, account.id)!.n},
   team_now: teamUsers(r.id).map(id => userLabel(get('SELECT * FROM user WHERE id=?', id)!)), efiles, hidden_efiles: hidden,
   can_manage: allowed(c, 'client'), can_create_efile: allowed(c, 'createFile')};
 },
 // For eFile Setup: the company's clients, each with its service team to offer as participants.
 'client.options'(c) {
  return all('SELECT * FROM client WHERE company_id=? ORDER BY code', c.companyId).map(r => ({id: r.id, label: `${r.code} ${r.name_cn}`, ...team(r)}));
 },
};
