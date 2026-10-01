// Items, their approval workflow (docs/aiwsp/urgent-functions.md "Approval"), links to other eFiles, and IMS processes.
import {all, get, run, uid, now, tx, nextSeq, type Row} from '../db';
import {check, fail, hashPassword, equal, live} from '../auth';
import {type Ctx, text, required, bool, ids, cents, date, userLabel, log, notify, fmt, context, allowed} from '../ctx';
import {efile as openEfile, role, may} from '../access';
import {steps as efileSteps, balances, touch} from './efile';
import {myClientIds} from './client';

const LINK_KINDS = ['auto_link', 'conditional_auto_link', 'split_link', 'auto_copy', 'auto_share', 'bind'];
const MIRROR_KINDS = ['auto_link', 'conditional_auto_link', 'split_link'];
const EDITABLE = ['draft', 'returned', 'withdrawn', 'none'];
export const STATUS_LABEL: Record<string, string> = {draft: 'Draft', pending: 'Pending approval', returned: 'Returned for correction', rejected: 'Rejected', withdrawn: 'Withdrawn', approved: 'Approved', none: 'No approval required'};

async function unlocked(e: Row, password: any) {
 if (!e.password) return;
 const [salt, hash] = e.password.split(':');
 check(password && equal(await hashPassword(String(password), salt), hash), 'PASSWORD_REQUIRED');
}
const getItem = (id: any) => { const i = get('SELECT * FROM item WHERE id=?', text(id, 64)); if (!i) fail('Item is unavailable.'); return i; };
const editors = (i: Row): string[] => JSON.parse(i.editors || '[]');
const who = (id: string | null | undefined) => { const u = id ? get('SELECT * FROM user WHERE id=?', id) : null; return u ? userLabel(u) : ''; };
function event(i: Row, c: Ctx, action: string, note = '', override = 0) {
 run('INSERT INTO item_event(id,item_id,at,actor_id,actor,action,note,override) VALUES(?,?,?,?,?,?,?,?)', uid(), i.id, now(), c.user.id, userLabel(c.user), action, note.slice(0, 2000), override);
}
function participants(i: Row) {
 const stepUsers = all('SELECT approvers, decided_by FROM item_step WHERE item_id=?', i.id).flatMap(s => [...JSON.parse(s.approvers), s.decided_by]);
 return [...new Set([i.created_by, i.submitted_by, ...editors(i), ...stepUsers].filter(Boolean))] as string[];
}

// ---------------- Approval steps
const currentStep = (i: Row) => get('SELECT * FROM item_step WHERE item_id=? AND round=? AND decision IS NULL ORDER BY position LIMIT 1', i.id, i.round);
// An approver must be active, hold the approval function, still have access to the eFile, and not be the item's creator, submitter or an editor.
function eligible(userId: string, i: Row, e: Row) {
 if (userId === i.created_by || userId === i.submitted_by || editors(i).includes(userId)) return false;
 const u = get('SELECT u.*, c.status AS company_status FROM user u JOIN company c ON c.id=u.company_id WHERE u.id=?', userId);
 if (!u || !live(u, u.company_status)) return false;
 const uc = context(u);
 return allowed(uc, 'approve') && !!role(uc, e);
}
function stepState(i: Row, e: Row) {
 const s = i.status === 'pending' ? currentStep(i) : null;
 if (!s) return null;
 const approvers: string[] = JSON.parse(s.approvers);
 return {position: s.position, title: s.title, approvers, eligible: approvers.filter(u => eligible(u, i, e)), paused: !approvers.some(u => eligible(u, i, e))};
}
function submit(c: Ctx, i: Row, e: Row, note = '') {
 check(e.approval, 'This eFile does not require approval.');
 const defined = efileSteps(e.id);
 // Every submission goes through all of the eFile's steps, in order.
 const use = defined;
 check(use.length, 'This eFile has no approval steps. Ask its administrator to Set Confirmation.');
 const round = i.round + 1;
 const snapshot = JSON.stringify({name: i.name, amount: i.amount, currency: i.currency, item_date: i.item_date, target_date: i.target_date, attachments: all('SELECT id, filename, size FROM item_attachment WHERE item_id=?', i.id)});
 run('INSERT INTO item_version(item_id,version,snapshot,by,at) VALUES(?,?,?,?,?)', i.id, round, snapshot, c.user.id, now());
 use.forEach((s, n) => run('INSERT INTO item_step(item_id,round,position,title,approvers) VALUES(?,?,?,?,?)', i.id, round, n + 1, s.title, JSON.stringify(s.users.map((u: Row) => u.id))));
 run(`UPDATE item SET status='pending', round=?, submitted_by=?, updated_at=?, version=version+1 WHERE id=?`, round, c.user.id, now(), i.id);
 const fresh = get('SELECT * FROM item WHERE id=?', i.id)!;
 event(fresh, c, round > 1 ? `Resubmitted (version ${round}), approval restarts at step 1` : 'Submitted for approval', note);
 const st = stepState(fresh, e)!;
 notify(st.eligible, 'approval', `Approval needed (step 1: ${st.title}): ${i.name}`, e.id, i.id);
 if (st.paused) notify(adminsOf(e), 'approval', `No eligible approver for step 1 of "${i.name}". Assign one.`, e.id, i.id);
}
function adminsOf(e: Row) {
 const admins = all(`SELECT user_id FROM efile_member WHERE efile_id=? AND kind='admin'`, e.id).map(r => r.user_id).filter(u => live(get('SELECT * FROM user WHERE id=?', u)));
 if (admins.length) return admins;
 return all(`SELECT id FROM user WHERE (company_id=? AND position='chief') OR position='system'`, e.company_id).map(r => r.id);
}

// ---------------- Links to other eFiles (IMS)
function mirrorAmount(item: Row, l: Row) { const base = l.kind === 'split_link' ? l.split_amount : item.amount; return base === null ? null : l.change_sign ? -base : base; }
function conditionMet(item: Row, stepEfileId: string) {
 const origin = get(`SELECT origin_item_id FROM process_run WHERE stage_item_id=? OR origin_item_id=?`, item.id, item.id)?.origin_item_id;
 if (!origin) return false;
 return !!get(`SELECT 1 FROM process_run r JOIN process_stage s ON s.process_id=r.process_id AND s.efile_id=? WHERE r.origin_item_id=? AND (s.position<=r.stage OR r.status='completed')`, stepEfileId, origin);
}
function syncLinks(c: Ctx, itemId: string) {
 const item = get('SELECT * FROM item WHERE id=?', itemId)!;
 for (const l of all('SELECT * FROM item_link WHERE item_id=?', itemId)) {
  const mirror = MIRROR_KINDS.includes(l.kind), copyOnce = l.kind === 'auto_copy';
  if (!mirror && !copyOnce) continue;
  if (l.kind === 'conditional_auto_link' && !l.target_item_id && !conditionMet(item, l.step_efile_id)) continue;
  const existing = l.target_item_id ? get('SELECT * FROM item WHERE id=?', l.target_item_id) : null;
  if (existing) {
   if (mirror && !l.locked) { run('UPDATE item SET name=?,amount=?,currency=?,item_date=?,target_date=?,updated_at=? WHERE id=?', item.name, mirrorAmount(item, l), item.currency, item.item_date, item.target_date, now(), existing.id); touch(existing.efile_id); }
   continue;
  }
  const target = get('SELECT * FROM efile WHERE id=?', l.target_efile_id)!;
  const id = uid(), t = now();
  run(`INSERT INTO item(id,seq,efile_id,name,amount,currency,item_date,target_date,status,locked,source_item_id,source_kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
   id, nextSeq(), target.id, item.name, mirrorAmount(item, l), item.currency || target.currency, item.item_date, item.target_date, mirror ? 'none' : (target.approval ? 'draft' : 'none'), mirror ? 1 : 0, mirror ? item.id : null, mirror ? l.kind : 'auto_copy', c.user.id, t, t);
  run('UPDATE item_link SET target_item_id=? WHERE id=?', id, l.id);
  touch(target.id);
 }
}
function removeMirrors(itemId: string) {
 for (const m of all(`SELECT id FROM item WHERE source_item_id=? AND source_kind IN ('auto_link','conditional_auto_link','split_link')`, itemId)) { removeMirrors(m.id); run('DELETE FROM item WHERE id=?', m.id); }
}

// ---------------- Processes (IMS): a chain of eFiles; the stage executor commits approved items onward.
const stage = (processId: string, position: number) => get('SELECT * FROM process_stage WHERE process_id=? AND position=?', processId, position);
function startProcesses(c: Ctx, item: Row) {
 for (const s of all('SELECT * FROM process_stage WHERE efile_id=? AND position=1', item.efile_id)) {
  run(`INSERT INTO process_run(id,process_id,origin_item_id,stage_item_id,stage,status,updated_at) VALUES(?,?,?,?,1,'running',?)`, uid(), s.process_id, item.id, item.id, now());
  notify([s.executor_id, ...JSON.parse(s.notify)].filter(u => u !== c.user.id), 'process', `New item in process: ${item.name}`, item.efile_id, item.id);
 }
}
const ready = (i: Row) => ['approved', 'none'].includes(i.status);
function commitRun(c: Ctx, r: Row) {
 const item = get('SELECT * FROM item WHERE id=?', r.stage_item_id)!;
 const next = stage(r.process_id, r.stage + 1);
 run('UPDATE item SET done=1, updated_at=? WHERE id=?', now(), item.id);
 if (!next) {
  run(`UPDATE process_run SET status='completed',updated_at=? WHERE id=?`, now(), r.id);
  syncConditional(c, r.origin_item_id); return;
 }
 const target = get('SELECT * FROM efile WHERE id=?', next.efile_id)!;
 const id = uid(), t = now();
 run(`INSERT INTO item(id,seq,efile_id,name,amount,currency,item_date,target_date,status,editors,source_item_id,source_kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'process',?,?,?)`,
  id, nextSeq(), target.id, item.name, item.amount, item.currency, item.item_date, item.target_date, target.approval ? 'draft' : 'none', '[]', item.id, c.user.id, t, t);
 run('UPDATE process_run SET stage=?,stage_item_id=?,updated_at=? WHERE id=?', r.stage + 1, id, t, r.id);
 const created = get('SELECT * FROM item WHERE id=?', id)!;
 event(created, c, `Arrived from process stage ${r.stage}`);
 if (target.approval && efileSteps(target.id).length) submit(c, created, target, 'Submitted by the process');
 touch(target.id);
 syncConditional(c, r.origin_item_id);
 notify([next.executor_id, ...JSON.parse(next.notify)], 'process', `Item arrived at ${target.name}: ${item.name}`, target.id, id);
 log(c, 'process', 'modify', `提交流程:${item.name} → 第${r.stage + 1}步`, target.company_id);
 autoCommit(c, get('SELECT * FROM process_run WHERE id=?', r.id)!);
}
function syncConditional(c: Ctx, originItemId: string) { if (get(`SELECT 1 FROM item_link WHERE item_id=? AND kind='conditional_auto_link'`, originItemId)) syncLinks(c, originItemId); }
// Auto Commit: once the stage item is approved it moves on by itself (items that need no approval wait for the executor).
function autoCommit(c: Ctx, r: Row) {
 if (r.status !== 'running' || !stage(r.process_id, r.stage)?.auto_commit) return;
 const i = get('SELECT * FROM item WHERE id=?', r.stage_item_id)!;
 if (i.status === 'approved') commitRun(c, r);
}
const runFor = (itemId: string) => get(`SELECT r.*, s.executor_id FROM process_run r JOIN process_stage s ON s.process_id=r.process_id AND s.position=r.stage WHERE r.stage_item_id=? AND r.status='running'`, itemId);

// ---------------- Rows for the Item List
function itemRow(c: Ctx, i: Row, e: Row) {
 const r = runFor(i.id);
 const st = stepState(i, e);
 const total = get('SELECT COUNT(*) AS n FROM item_step WHERE item_id=? AND round=?', i.id, i.round)!.n;
 const canEdit = EDITABLE.includes(i.status) && !i.locked && !i.archived && !i.done && may(c, e, 'edit') && !MIRROR_KINDS.includes(i.source_kind) && !i.shared_in;
 return {
  id: i.id, seq: i.seq, efile_id: i.efile_id, name: i.name, amount: fmt(i.amount), currency: i.currency, item_date: i.item_date, target_date: i.target_date,
  highlight: !!i.highlight, move_to_top: !!i.move_to_top, special_marking: !!i.special_marking, status: i.status, status_label: STATUS_LABEL[i.status],
  locked: !!i.locked, archived: !!i.archived, done: !!i.done, version: i.version,
  starred: !!get('SELECT 1 FROM item_star WHERE user_id=? AND item_id=?', c.user.id, i.id),
  step: st ? {position: st.position, total, title: st.title, paused: st.paused} : null,
  approved_steps: i.status === 'approved' ? total : 0,
  in_process: !!r || !!get(`SELECT 1 FROM process_run WHERE origin_item_id=? OR stage_item_id=?`, i.id, i.id), stage: r?.stage ?? null,
  mirrored: MIRROR_KINDS.includes(i.source_kind), shared_in: !!i.shared_in, mine: i.created_by === c.user.id,
  comments: get('SELECT COUNT(*) AS n FROM item_comment WHERE item_id=?', i.id)!.n,
  attachments: get('SELECT COUNT(*) AS n FROM item_attachment WHERE item_id=?', i.id)!.n,
  can_edit: canEdit,
  can_submit: e.approval && ['draft', 'returned', 'withdrawn'].includes(i.status) && !i.archived && may(c, e, 'submit') && !i.shared_in,
  can_decide: !!st && st.approvers.includes(c.user.id) && eligible(c.user.id, i, e),
  can_withdraw: i.status === 'pending' && (i.submitted_by === c.user.id || i.created_by === c.user.id),
  can_commit: !!r && r.executor_id === c.user.id && ready(i),
  can_lock: e.role === 'admin' && ['draft', 'none', 'returned', 'withdrawn'].includes(i.status),
  can_delete: i.round === 0 && !i.shared_in && (e.role === 'admin' || i.created_by === c.user.id) && !(r && r.stage > 1),
  can_archive: !i.archived && i.round > 0 && ['approved', 'rejected', 'withdrawn'].includes(i.status) && (e.role === 'admin' || i.created_by === c.user.id),
  can_reassign: !!st && st.paused && e.role === 'admin',
 };
}
// Default order: Move to Top first, then dated items newest first, then undated items by name; the system ID breaks ties.
function order(a: Row, z: Row) {
 return (z.move_to_top - a.move_to_top) || ((a.item_date ? 0 : 1) - (z.item_date ? 0 : 1)) || (a.item_date && z.item_date ? z.item_date.localeCompare(a.item_date) : 0)
  || (!a.item_date && !z.item_date ? a.name.localeCompare(z.name) : 0) || a.seq - z.seq;
}

export const itemActions: Record<string, (c: Ctx, b: any) => any> = {
 async 'item.list'(c, b) {
  const e = openEfile(c, b.efileId); await unlocked(e, b.password);
  const filter = text(b.filter, 20) || 'uncompleted';
  let rows = all(`SELECT i.*, 0 AS shared_in FROM item i WHERE i.efile_id=?
   UNION ALL SELECT i.*, 1 AS shared_in FROM item i JOIN item_link l ON l.item_id=i.id AND l.kind='auto_share' WHERE l.target_efile_id=?`, e.id, e.id);
  const q = text(b.q, 100).toLowerCase(); if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q) || String(r.seq) === q.replace(/^#/, ''));
  const final = (r: Row) => ['approved', 'rejected'].includes(r.status) || !!r.done;
  if (filter === 'archived') rows = rows.filter(r => r.archived); else rows = rows.filter(r => !r.archived);
  if (filter === 'uncompleted') rows = rows.filter(r => !final(r));
  else if (filter === 'completed') rows = rows.filter(final);
  else if (filter === 'special') rows = rows.filter(r => r.special_marking);
  else if (filter === 'mine') rows = rows.filter(r => r.created_by === c.user.id);
  else if (filter === 'pending') rows = rows.filter(r => r.status === 'pending');
  else if (/^step\d{1,2}$/.test(filter)) rows = rows.filter(r => r.status === 'pending' && currentStep(r)?.position === Number(filter.slice(4)));
  else if (filter === 'process') rows = rows.filter(r => get(`SELECT 1 FROM process_run WHERE stage_item_id=? AND status='running'`, r.id));
  else if (filter === 'processDone') rows = rows.filter(r => get(`SELECT 1 FROM process_run WHERE (origin_item_id=? OR stage_item_id=?) AND (status='completed' OR stage_item_id<>?)`, r.id, r.id, r.id));
  else if (filter === 'unlocked') rows = rows.filter(r => get(`SELECT 1 FROM item_link WHERE item_id=? AND locked=0 AND kind IN ('auto_link','conditional_auto_link','split_link')`, r.id));
  rows.sort(order);
  const items = rows.map(r => itemRow(c, r, e));
  const shareOnly = e.role === 'view' && get('SELECT balance FROM efile_share WHERE efile_id=? AND user_id=?', e.id, c.user.id)?.balance === 0;
  const bal = balances(e);
  log(c, 'efile', 'view', `访问eFile:${e.name}`, e.company_id);
  return {
   efile: {id: e.id, name: e.name, color: get('SELECT color FROM user_efile WHERE user_id=? AND efile_id=?', c.user.id, e.id)?.color || e.color, currency: e.currency, role: e.role, approval: !!e.approval,
    can_create: may(c, e, 'createItem') && !e.archived, can_export: may(c, e, 'export')},
   // Date and amount columns show only when the eFile enables them and a shown item has a value (zero is a value).
   columns: {date: !!e.show_date && rows.some(r => r.item_date), amount: !!e.show_amount && rows.some(r => r.amount !== null)},
   steps: efileSteps(e.id).map(s => ({position: s.position, title: s.title})),
   balances: shareOnly || !e.show_amount ? [] : [
    {kind: 'balance', name: e.balance_alias || 'Balance/Sum', amount: fmt(bal.balance)},
    ...(e.notional_alias || e.notional ? [{kind: 'notional', name: e.notional_alias || 'Notional Balance/Sum', amount: fmt(bal.notional)}] : []),
   ],
   items, sum: fmt(rows.reduce((s, r) => s + (r.amount ?? 0), 0)), filter,
  };
 },
 async 'item.get'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id); await unlocked(e, b.password);
  const links = all('SELECT l.*, f.name AS efile_name, s.name AS step_efile_name, t.name AS item_name FROM item_link l JOIN efile f ON f.id=l.target_efile_id LEFT JOIN efile s ON s.id=l.step_efile_id LEFT JOIN item t ON t.id=l.target_item_id WHERE l.item_id=?', i.id)
   .map(l => ({...l, split_amount: fmt(l.split_amount), change_sign: !!l.change_sign, locked: !!l.locked}));
  const rounds = all('SELECT * FROM item_step WHERE item_id=? ORDER BY round DESC, position', i.id).map(s => ({...s, approvers: JSON.parse(s.approvers).map((u: string) => ({id: u, label: who(u), eligible: eligible(u, i, e)})), decided_by: who(s.decided_by)}));
  return {
   item: {...itemRow(c, i, e), created_by: who(i.created_by), submitted_by: who(i.submitted_by), created_at: i.created_at, updated_at: i.updated_at, source_kind: i.source_kind, round: i.round},
   efile: {id: e.id, name: e.name, currency: e.currency, color: e.color, role: e.role, approval: !!e.approval, show_date: !!e.show_date, show_amount: !!e.show_amount},
   links, steps: efileSteps(e.id), rounds,
   versions: all('SELECT version, by, at, snapshot FROM item_version WHERE item_id=? ORDER BY version DESC', i.id).map(v => ({...v, by: who(v.by), snapshot: JSON.parse(v.snapshot)})),
   events: all('SELECT at, actor, action, note, override FROM item_event WHERE item_id=? ORDER BY at', i.id),
   comments: all('SELECT c.*, u.username FROM item_comment c LEFT JOIN user u ON u.id=c.user_id WHERE c.item_id=? ORDER BY c.at', i.id),
   attachments: all('SELECT id,filename,size,content_type,at FROM item_attachment WHERE item_id=? ORDER BY at', i.id),
   can_override: c.sys && ['pending', 'approved', 'rejected'].includes(i.status),
  };
 },
 async 'item.save'(c, b) {
  const existing = b.id ? getItem(b.id) : null;
  const e = openEfile(c, existing?.efile_id ?? b.efileId, 'edit'); await unlocked(e, b.password);
  check(!e.archived, 'This eFile is archived.');
  if (existing) {
   check(Number(b.version) === existing.version, 'Someone else changed this item. Reload it and make your change again.');
   check(!MIRROR_KINDS.includes(existing.source_kind), 'This item is linked from another eFile. Edit the original item instead.');
   check(EDITABLE.includes(existing.status) && !existing.done, existing.status === 'pending' ? 'This item is waiting for approval and is locked. Withdraw it first.' : 'Submitted and approved versions cannot be overwritten.');
   check(!existing.locked, 'An administrator has locked this item.');
   check(may(c, e, 'edit'), 'Your level does not allow editing items.');
  } else check(may(c, e, 'createItem'), 'Your level does not allow creating items.');
  const f = {name: required(b.name, 'Item name', 2000),
   amount: e.show_amount ? cents(b.amount) : existing ? existing.amount : null,
   item_date: e.show_date ? date(b.item_date, 'Item Date') : existing ? existing.item_date : '',
   target_date: date(b.target_date, 'Target Date'), highlight: bool(b.highlight), move_to_top: bool(b.move_to_top), special_marking: bool(b.special_marking)};
  const links = (Array.isArray(b.links) ? b.links : []).slice(0, 50).map((l: any) => {
   check(LINK_KINDS.includes(l.kind), 'Unknown link type.');
   const target = openEfile(c, l.efile_id, l.kind === 'bind' || l.kind === 'auto_share' ? 'view' : 'edit');
   check(target.id !== e.id, 'An item cannot link to its own eFile.');
   const out: Row = {id: text(l.id, 64), kind: l.kind, target_efile_id: target.id, change_sign: bool(l.change_sign), split_amount: l.kind === 'split_link' ? cents(l.split_amount, 'Split amount') ?? 0 : 0, step_efile_id: null, target_item_id: null, locked: bool(l.locked)};
   if (l.kind === 'conditional_auto_link') out.step_efile_id = openEfile(c, l.step_efile_id).id;
   if (l.kind === 'bind') { const t = get('SELECT id FROM item WHERE id=? AND efile_id=?', text(l.item_id, 64), target.id); check(t, 'Choose the item to bind.'); out.target_item_id = t!.id; }
   return out;
  });
  const splits = links.filter((l: Row) => l.kind === 'split_link');
  if (splits.length) check(f.amount !== null && splits.reduce((s: number, l: Row) => s + l.split_amount, 0) === f.amount, 'Split Link amounts must add up to the item amount.');
  return tx(() => {
   const id = existing?.id ?? uid(), t = now();
   const eds = [...new Set([...(existing ? editors(existing) : []), c.user.id])];
   if (existing) run('UPDATE item SET name=?,amount=?,item_date=?,target_date=?,highlight=?,move_to_top=?,special_marking=?,steps=?,editors=?,version=version+1,updated_at=? WHERE id=?',
    f.name, f.amount, f.item_date, f.target_date, f.highlight, f.move_to_top, f.special_marking, '[]', JSON.stringify(eds), t, id);
   else run('INSERT INTO item(id,seq,efile_id,name,amount,currency,item_date,target_date,highlight,move_to_top,special_marking,status,steps,editors,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    id, nextSeq(), e.id, f.name, f.amount, e.currency, f.item_date, f.target_date, f.highlight, f.move_to_top, f.special_marking, e.approval ? 'draft' : 'none', '[]', JSON.stringify(eds), c.user.id, t, t);
   // Links: keep rows (and their generated items) that are unchanged, replace the rest.
   const old = all('SELECT * FROM item_link WHERE item_id=?', id);
   const same = (a: Row, z: Row) => a.kind === z.kind && a.target_efile_id === z.target_efile_id && a.step_efile_id === z.step_efile_id && (a.kind !== 'bind' || a.target_item_id === z.target_item_id);
   for (const o of old) {
    const keep = links.find((l: Row) => l.id === o.id && same(l, o));
    if (keep) { run('UPDATE item_link SET change_sign=?,split_amount=?,locked=? WHERE id=?', keep.change_sign, keep.split_amount, keep.locked, o.id); continue; }
    if (o.target_item_id && MIRROR_KINDS.includes(o.kind)) { removeMirrors(o.target_item_id); run('DELETE FROM item WHERE id=?', o.target_item_id); }
    run('DELETE FROM item_link WHERE id=?', o.id);
   }
   for (const l of links) if (!old.some(o => o.id === l.id && same(l, o)))
    run('INSERT INTO item_link(id,item_id,kind,target_efile_id,target_item_id,change_sign,split_amount,step_efile_id,locked) VALUES(?,?,?,?,?,?,?,?,?)', uid(), id, l.kind, l.target_efile_id, l.target_item_id, l.change_sign, l.split_amount, l.step_efile_id, l.locked);
   const item = get('SELECT * FROM item WHERE id=?', id)!;
   event(item, c, existing ? (existing.status === 'returned' ? 'Corrected' : 'Edited') : 'Created');
   if (!existing) startProcesses(c, item);
   syncLinks(c, id); touch(e.id);
   if (b.submit && e.approval) { check(may(c, e, 'submit'), 'Your level does not allow submitting items.'); submit(c, item, e); }
   log(c, 'item', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}Item:${e.name} - #${item.seq} ${f.name.slice(0, 80)}`, e.company_id);
   return {id};
  });
 },
 'item.submit'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id, 'edit');
  check(may(c, e, 'submit'), 'Your level does not allow submitting items.');
  check(['draft', 'returned', 'withdrawn'].includes(i.status) && !i.archived, 'This item cannot be submitted now.');
  check(Number(b.version ?? i.version) === i.version, 'Someone else changed this item. Reload it first.');
  return tx(() => { submit(c, i, e, text(b.note, 1000)); log(c, 'approval', 'add', `提交审批:${e.name} - #${i.seq} ${i.name.slice(0, 60)}`, e.company_id); return {}; });
 },
 // Approve, Return for correction, or Reject the active step. Only an eligible approver of that step may act, once.
 'item.decide'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id);
  const decision = text(b.decision, 10); check(['approve', 'return', 'reject'].includes(decision), 'Unknown decision.');
  check(i.status === 'pending', 'This item is not waiting for approval.');
  const s = currentStep(i); check(s, 'This item is not waiting for approval.');
  check(JSON.parse(s!.approvers).includes(c.user.id), 'You are not an approver of the active step.');
  check(eligible(c.user.id, i, e), 'You cannot approve an item you created, submitted or edited, or without the approval function.');
  check(Number(b.version ?? i.version) === i.version, 'This item changed while you were looking at it. Reload it first.');
  const note = decision === 'approve' ? text(b.note, 1000) : required(b.note, 'Reason', 1000);
  return tx(() => {
   const r = run('UPDATE item_step SET decision=?, decided_by=?, decided_at=?, note=? WHERE item_id=? AND round=? AND position=? AND decision IS NULL', decision, c.user.id, now(), note, i.id, i.round, s!.position);
   check(Number(r.changes) === 1, 'This step was already decided.');
   const label = {approve: 'Approved', return: 'Returned for correction', reject: 'Rejected'}[decision];
   event(i, c, `${label} (step ${s!.position}: ${s!.title})`, note);
   if (decision === 'approve') {
    const next = currentStep(i);
    if (next) {
     run('UPDATE item SET version=version+1, updated_at=? WHERE id=?', now(), i.id);
     const st = stepState(get('SELECT * FROM item WHERE id=?', i.id)!, e)!;
     notify(st.eligible, 'approval', `Approval needed (step ${st.position}: ${st.title}): ${i.name}`, e.id, i.id);
     if (st.paused) notify(adminsOf(e), 'approval', `No eligible approver for step ${st.position} of "${i.name}". Assign one.`, e.id, i.id);
    } else {
     run(`UPDATE item SET status='approved', version=version+1, updated_at=? WHERE id=?`, now(), i.id);
     notify(participants(i), 'approval', `Approval complete: ${i.name}`, e.id, i.id);
     const run_ = runFor(i.id); if (run_) autoCommit(c, run_);
    }
   } else {
    run(`UPDATE item SET status=?, version=version+1, updated_at=? WHERE id=?`, decision === 'return' ? 'returned' : 'rejected', now(), i.id);
    run(`UPDATE item_step SET decision='closed' WHERE item_id=? AND round=? AND decision IS NULL`, i.id, i.round);
    notify(participants(i).filter(u => u !== c.user.id), 'approval', `${label}: ${i.name} — ${note}`, e.id, i.id);
   }
   touch(e.id);
   log(c, 'approval', 'approve', `${label}(第${s!.position}步):${e.name} - #${i.seq} ${i.name.slice(0, 60)}`, e.company_id);
   return {};
  });
 },
 'item.withdraw'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id);
  check(i.status === 'pending' && (i.submitted_by === c.user.id || i.created_by === c.user.id), 'Only the submitter can withdraw a pending submission.');
  const note = required(b.note, 'Reason', 1000);
  return tx(() => {
   run(`UPDATE item_step SET decision='withdrawn' WHERE item_id=? AND round=? AND decision IS NULL`, i.id, i.round);
   run(`UPDATE item SET status='withdrawn', version=version+1, updated_at=? WHERE id=?`, now(), i.id);
   event(i, c, 'Withdrawn', note); notify(participants(i).filter(u => u !== c.user.id), 'approval', `Withdrawn: ${i.name} — ${note}`, e.id, i.id);
   log(c, 'approval', 'modify', `撤回审批:${e.name} - #${i.seq}`, e.company_id); touch(e.id);
   return {};
  });
 },
 // A paused step (no eligible approver) waits for an eFile administrator to assign an eligible replacement. Steps are never skipped.
 'item.reassign'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id, 'admin');
  const s = currentStep(i); check(i.status === 'pending' && s, 'This item is not waiting for approval.');
  const to = text(b.to, 64); check(eligible(to, i, e), 'Choose an eligible approver: active, holding the approval function, with access, and not the item\'s creator, submitter or editor.');
  return tx(() => {
   const list: string[] = JSON.parse(s!.approvers).filter((u: string) => eligible(u, i, e)); if (!list.includes(to)) list.push(to);
   run('UPDATE item_step SET approvers=? WHERE item_id=? AND round=? AND position=?', JSON.stringify(list), i.id, i.round, s!.position);
   event(i, c, `Approver assigned for step ${s!.position}: ${who(to)}`); notify([to], 'approval', `Approval needed (step ${s!.position}: ${s!.title}): ${i.name}`, e.id, i.id);
   log(c, 'approval', 'modify', `指派审批人:${e.name} - #${i.seq} → ${who(to)}`, e.company_id);
   return {};
  });
 },
 // System Admin only: override (approve) or reopen, with a reason, shown separately from normal decisions.
 'item.override'(c, b) {
  check(c.sys, 'Only a System Admin can override approvals.');
  const i = getItem(b.id); const e = get('SELECT * FROM efile WHERE id=?', i.efile_id)!;
  const action = text(b.mode, 10); check(['approve', 'reopen'].includes(action), 'Choose approve or reopen.');
  const note = required(b.note, 'Reason', 1000);
  return tx(() => {
   if (action === 'approve') {
    check(i.status === 'pending', 'Only a pending item can be approved by override.');
    run(`UPDATE item_step SET decision='override', decided_by=?, decided_at=?, note=? WHERE item_id=? AND round=? AND decision IS NULL`, c.user.id, now(), note, i.id, i.round);
    run(`UPDATE item SET status='approved', version=version+1, updated_at=? WHERE id=?`, now(), i.id);
   } else {
    check(['approved', 'rejected', 'pending'].includes(i.status), 'This item cannot be reopened.');
    run(`UPDATE item_step SET decision='override-closed' WHERE item_id=? AND round=? AND decision IS NULL`, i.id, i.round);
    run(`UPDATE item SET status='returned', done=0, version=version+1, updated_at=? WHERE id=?`, now(), i.id);
   }
   event(i, c, action === 'approve' ? 'System Admin override: approved' : 'System Admin override: reopened for correction', note, 1);
   notify(participants(i), 'override', `System Admin ${action === 'approve' ? 'approved by override' : 'reopened'}: ${i.name} — ${note}`, e.id, i.id);
   log(c, 'approval', 'override', `管理员覆盖(${action}):${e.name} - #${i.seq} ${i.name.slice(0, 60)} — ${note}`, e.company_id);
   if (action === 'approve') { const r = runFor(i.id); if (r) autoCommit(c, r); }
   return {};
  });
 },
 'item.lock'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id, 'admin');
  check(['draft', 'none', 'returned', 'withdrawn'].includes(i.status), 'Submitted items follow the approval lock instead.');
  const locked = i.locked ? 0 : 1;
  return tx(() => { run('UPDATE item SET locked=?, version=version+1 WHERE id=?', locked, i.id); event(i, c, locked ? 'Locked by administrator' : 'Unlocked by administrator'); log(c, 'item', 'modify', `${locked ? '锁定' : '解锁'}Item:#${i.seq}`, e.company_id); return {locked}; });
 },
 // Items with approval history are archived, never deleted.
 'item.archive'(c, b) {
  const i = getItem(b.id); const e = openEfile(c, i.efile_id);
  check(e.role === 'admin' || i.created_by === c.user.id, 'Only the creator or an eFile administrator can archive this item.');
  check(i.status !== 'pending', 'Withdraw or finish the approval first.');
  const archived = i.archived ? 0 : 1;
  return tx(() => { run('UPDATE item SET archived=? WHERE id=?', archived, i.id); event(i, c, archived ? 'Archived' : 'Restored from archive'); log(c, 'item', 'modify', `${archived ? '归档' : '恢复'}Item:#${i.seq}`, e.company_id); touch(e.id); return {}; });
 },
 'item.delete'(c, b) {
  const list = ids(b.ids ?? [b.id]); check(list.length, 'Select at least one item.');
  tx(() => {
   for (const id of list) {
    const i = get('SELECT * FROM item WHERE id=?', id); if (!i) continue;
    const e = openEfile(c, i.efile_id);
    check(e.role === 'admin' || i.created_by === c.user.id, 'Only the item creator or an eFile administrator can delete this item.');
    check(i.round === 0, `"${i.name}" has approval history. Archive it instead.`);
    check(!get(`SELECT 1 FROM process_run WHERE (origin_item_id=? AND stage_item_id<>?) AND status='running'`, i.id, i.id), `"${i.name}" has moved on in its process.`);
    check(!get(`SELECT 1 FROM process_run WHERE stage_item_id=? AND stage>1 AND status='running'`, i.id), `"${i.name}" is in a running process. Delete it from the first eFile of the process instead.`);
    removeMirrors(i.id); run('DELETE FROM item WHERE id=?', i.id); touch(e.id);
    log(c, 'item', 'remove', `删除Item:${e.name} - #${i.seq} ${i.name.slice(0, 80)}`, e.company_id);
   }
  });
  return {};
 },
 'item.bulk'(c, b) {
  const list = ids(b.ids); check(list.length, 'Select at least one item.');
  const ops: Record<string, string> = {top: 'move_to_top=1', 'top.cancel': 'move_to_top=0', highlight: 'highlight=1', 'highlight.cancel': 'highlight=0', special: 'special_marking=1', 'special.cancel': 'special_marking=0'};
  const op = text(b.op, 30);
  tx(() => {
   for (const id of list) {
    const i = get('SELECT * FROM item WHERE id=?', id); if (!i) continue; const e = openEfile(c, i.efile_id, 'edit');
    if (ops[op]) run(`UPDATE item SET ${ops[op]} WHERE id=?`, id);
    else if (op === 'lock' || op === 'unlock') { check(e.role === 'admin', 'Only eFile administrators can lock links.'); run('UPDATE item_link SET locked=? WHERE item_id=?', op === 'lock' ? 1 : 0, id); }
    else check(false, 'This function is not available.');
   }
  });
  return {};
 },
 'item.star'(c, b) {
  const i = getItem(b.id); openEfile(c, i.efile_id);
  if (get('SELECT 1 FROM item_star WHERE user_id=? AND item_id=?', c.user.id, i.id)) run('DELETE FROM item_star WHERE user_id=? AND item_id=?', c.user.id, i.id);
  else run('INSERT INTO item_star(user_id,item_id) VALUES(?,?)', c.user.id, i.id);
  return {};
 },
 'item.comment'(c, b) {
  const i = getItem(b.id); openEfile(c, i.efile_id);
  run('INSERT INTO item_comment(id,item_id,user_id,body,at) VALUES(?,?,?,?,?)', uid(), i.id, c.user.id, required(b.body, 'Comment', 4000), now()); return {};
 },
 'process.commit'(c, b) {
  const i = getItem(b.id); openEfile(c, i.efile_id);
  const r = runFor(i.id); check(r && r.executor_id === c.user.id, 'Only the process executor can commit this item.');
  check(ready(i), 'The item must be approved before it moves on.');
  return tx(() => { commitRun(c, get('SELECT * FROM process_run WHERE id=?', r!.id)!); return {}; });
 },

 // ---------------- Set Process
 'process.get'(c, b) {
  const e = openEfile(c, b.efileId);
  const p = get('SELECT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? AND s.position=1', e.id);
  const stages = p ? all('SELECT s.*, f.name AS efile_name FROM process_stage s JOIN efile f ON f.id=s.efile_id WHERE s.process_id=? ORDER BY s.position', p.id).map(s => {
   const f = get('SELECT * FROM efile WHERE id=?', s.efile_id)!;
   const ex = get('SELECT * FROM user WHERE id=?', s.executor_id);
   const executorCanOpen = ex && live(ex) ? !!role(context(ex), f) : false;
   return {position: s.position, efile_id: s.efile_id, efile_name: s.efile_name, executor: ex ? {id: ex.id, label: ex.username} : null,
    notify: JSON.parse(s.notify).map((u: string) => get('SELECT id, username AS label FROM user WHERE id=?', u)).filter(Boolean),
    auto_commit: !!s.auto_commit, confirm_balance: !!s.confirm_balance, warning: !executorCanOpen,
    waiting: get(`SELECT COUNT(*) AS n FROM process_run WHERE process_id=? AND stage=? AND status='running'`, p.id, s.position)!.n};
  }) : [];
  return {efile: {id: e.id, name: e.name}, process: p ? {id: p.id, name: p.name} : null, stages};
 },
 'process.save'(c, b) {
  const e = openEfile(c, b.efileId, 'admin');
  const name = required(b.name, 'Name', 300);
  const list = (Array.isArray(b.stages) ? b.stages : []).slice(0, 30);
  check(list.length && list[0].efile_id === e.id, 'The first eFile of the process must be this eFile.');
  const stages = list.map((s: any, i: number) => {
   const f = openEfile(c, s.efile_id);
   check(!list.slice(0, i).some((x: any) => x.efile_id === f.id), `${f.name} appears twice in the process.`);
   const ex = get('SELECT * FROM user WHERE id=?', text(s.executor_id, 64)); check(ex && live(ex) && ex.company_id === e.company_id, `Choose an Executor for ${f.name}.`);
   return {efile_id: f.id, executor_id: ex!.id, notify: JSON.stringify(ids(s.notify).filter(u => get('SELECT id FROM user WHERE id=? AND company_id=?', u, e.company_id))), auto_commit: bool(s.auto_commit), confirm_balance: bool(s.confirm_balance)};
  });
  return tx(() => {
   let p = get('SELECT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? AND s.position=1', e.id);
   if (p) {
    const beyond = get(`SELECT MAX(stage) AS n FROM process_run WHERE process_id=? AND status='running'`, p.id)?.n ?? 0;
    check(beyond <= stages.length, 'Items are still running at a stage you removed. Finish or delete them first.');
    run('UPDATE process SET name=? WHERE id=?', name, p.id); run('DELETE FROM process_stage WHERE process_id=?', p.id);
   } else { p = {id: uid()}; run('INSERT INTO process(id,company_id,name) VALUES(?,?,?)', p.id, e.company_id, name); }
   stages.forEach((s: Row, i: number) => run('INSERT INTO process_stage(process_id,position,efile_id,executor_id,notify,auto_commit,confirm_balance) VALUES(?,?,?,?,?,?,?)', p!.id, i + 1, s.efile_id, s.executor_id, s.notify, s.auto_commit, s.confirm_balance));
   log(c, 'process', 'modify', `设置流程:${name}`, e.company_id);
   return {id: p.id};
  });
 },
 'process.clear'(c, b) {
  const e = openEfile(c, b.efileId, 'admin');
  const p = get('SELECT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? AND s.position=1', e.id);
  check(p, 'This eFile has no process.');
  check(!get(`SELECT 1 FROM process_run WHERE process_id=? AND status='running'`, p!.id), 'Items are still running in this process. Finish or delete them first.');
  tx(() => { run('DELETE FROM process WHERE id=?', p!.id); log(c, 'process', 'remove', `取消流程:${p!.name}`, e.company_id); });
  return {};
 },

 // ---------------- To Do (home page)
 'todo.confirm'(c) {
  const rows = all(`SELECT i.*, e.name AS efile_name FROM item i JOIN efile e ON e.id=i.efile_id JOIN item_step s ON s.item_id=i.id AND s.round=i.round
   WHERE i.status='pending' AND s.decision IS NULL AND s.approvers LIKE ? AND s.position=(SELECT MIN(position) FROM item_step x WHERE x.item_id=i.id AND x.round=i.round AND x.decision IS NULL)
   ORDER BY i.updated_at DESC`, `%"${c.user.id}"%`);
  return rows.filter(r => { const e = get('SELECT * FROM efile WHERE id=?', r.efile_id)!; return eligible(c.user.id, r, e); })
   .map(r => ({id: r.id, efile_id: r.efile_id, name: `${r.efile_name} - ${r.name}`, seq: r.seq, step: currentStep(r)?.position}));
 },
 'todo.returned'(c) {
  return all(`SELECT i.id, i.efile_id, i.seq, i.status, e.name AS efile_name, i.name FROM item i JOIN efile e ON e.id=i.efile_id WHERE i.status IN ('returned','draft','withdrawn') AND i.archived=0 AND (i.created_by=? OR i.submitted_by=?) ORDER BY i.updated_at DESC LIMIT 200`, c.user.id, c.user.id)
   .map(r => ({...r, name: `${r.efile_name} - ${r.name}`, status_label: STATUS_LABEL[r.status]}));
 },
 'todo.paused'(c) {
  const rows = all(`SELECT i.*, e.name AS efile_name FROM item i JOIN efile e ON e.id=i.efile_id WHERE i.status='pending'`);
  return rows.filter(r => { const e = get('SELECT * FROM efile WHERE id=?', r.efile_id)!; const er = role(c, e); return er === 'admin' && stepState(r, e)?.paused; })
   .map(r => ({id: r.id, efile_id: r.efile_id, seq: r.seq, name: `${r.efile_name} - ${r.name}`}));
 },
 'todo.executor'(c) {
  return all(`SELECT DISTINCT e.id, e.name, (SELECT COUNT(*) FROM process_run r WHERE r.process_id=s.process_id AND r.stage=s.position AND r.status='running') AS waiting
   FROM process_stage s JOIN efile e ON e.id=s.efile_id WHERE s.executor_id=? ORDER BY e.name`, c.user.id);
 },
 'counters'(c) {
  return {messages: get('SELECT COUNT(*) AS n FROM notification WHERE user_id=? AND read_at IS NULL', c.user.id)!.n, confirm: (itemActions['todo.confirm'](c, {}) as Row[]).length,
   clients: myClientIds(c.user.id).length};
 },
 // Notification text and links are shown only while the recipient can still open the eFile.
 'notifications'(c) {
  return all('SELECT * FROM notification WHERE user_id=? ORDER BY at DESC LIMIT 50', c.user.id).map(n => {
   if (!n.efile_id) return n;
   const e = get('SELECT * FROM efile WHERE id=?', n.efile_id);
   return e && role(c, e) ? n : {...n, title: 'Your access to an eFile has changed.', efile_id: null, item_id: null};
  });
 },
 'notifications.read'(c) { run('UPDATE notification SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), c.user.id); return {}; },
};
