// Items inside an eFile, their confirmation steps, links to other eFiles, and processes that move items between eFiles.
import {all, get, run, uid, now, tx, type Row} from '../db';
import {check, fail, hashPassword, equal} from '../auth';
import {type Ctx, text, required, bool, ids, cents, date, userLabel, log, notify, fmt, companyUser} from '../ctx';
import {efile as openEfile, role} from '../access';
import {steps as efileSteps, balances, touch} from './efile';

const LINK_KINDS = ['auto_link', 'conditional_auto_link', 'split_link', 'auto_copy', 'auto_share', 'bind'];
const MIRROR_KINDS = ['auto_link', 'conditional_auto_link', 'split_link'];

async function unlocked(e: Row, password: any) {
 if (!e.password) return;
 const [salt, hash] = e.password.split(':');
 check(password && equal(await hashPassword(String(password), salt), hash), 'PASSWORD_REQUIRED');
}

function itemSteps(itemId: string) { return all('SELECT position, confirmed_by, confirmed_at FROM item_step WHERE item_id=? ORDER BY position', itemId); }
const nextStep = (itemId: string) => get('SELECT position FROM item_step WHERE item_id=? AND confirmed_at IS NULL ORDER BY position LIMIT 1', itemId)?.position as number | undefined;

function refreshStatus(itemId: string) {
 const st = itemSteps(itemId);
 const confirmed = st.length > 0 && st.every(s => s.confirmed_at);
 const running = get(`SELECT 1 FROM process_run WHERE stage_item_id=? AND status='running'`, itemId);
 const movedOn = get(`SELECT 1 FROM item WHERE source_item_id=? AND source_kind='process'`, itemId) || get(`SELECT 1 FROM process_run WHERE stage_item_id=? AND status='completed'`, itemId);
 run('UPDATE item SET status=? WHERE id=?', movedOn || (confirmed && !running) ? 'completed' : 'uncompleted', itemId);
}

function mirrorAmount(item: Row, l: Row) { const base = l.kind === 'split_link' ? l.split_amount : item.amount; return l.change_sign ? -base : base; }

function conditionMet(item: Row, stepEfileId: string) {
 // True once the item (or the process run it started) has reached the given process stage eFile.
 const origin = get(`SELECT origin_item_id FROM process_run WHERE stage_item_id=? OR origin_item_id=?`, item.id, item.id)?.origin_item_id;
 if (!origin) return false;
 return !!get(`SELECT 1 FROM process_run r JOIN process_stage s ON s.process_id=r.process_id AND s.efile_id=? WHERE r.origin_item_id=? AND (s.position<=r.stage OR r.status='completed')`, stepEfileId, origin);
}

// Create or update the items that links on this item produce in other eFiles.
function syncLinks(c: Ctx, itemId: string) {
 const item = get('SELECT * FROM item WHERE id=?', itemId)!;
 for (const l of all('SELECT * FROM item_link WHERE item_id=?', itemId)) {
  const mirror = MIRROR_KINDS.includes(l.kind), copyOnce = l.kind === 'auto_copy';
  if (!mirror && !copyOnce) continue;
  if (l.kind === 'conditional_auto_link' && !l.target_item_id && !conditionMet(item, l.step_efile_id)) continue;
  const existing = l.target_item_id ? get('SELECT * FROM item WHERE id=?', l.target_item_id) : null;
  const amount = mirrorAmount(item, l);
  if (existing) {
   if (mirror && !l.locked) { run('UPDATE item SET name=?,amount=?,item_date=?,target_date=?,updated_at=? WHERE id=?', item.name, amount, item.item_date, item.target_date, now(), existing.id); touch(existing.efile_id); }
   continue;
  }
  const id = uid(), t = now();
  run(`INSERT INTO item(id,efile_id,name,amount,item_date,target_date,source_item_id,source_kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
   id, l.target_efile_id, item.name, amount, item.item_date, item.target_date, mirror ? item.id : null, mirror ? l.kind : 'auto_copy', c.user.id, t, t);
  run('UPDATE item_link SET target_item_id=? WHERE id=?', id, l.id);
  touch(l.target_efile_id);
 }
}

function removeMirrors(itemId: string) {
 for (const m of all(`SELECT id FROM item WHERE source_item_id=? AND source_kind IN ('auto_link','conditional_auto_link','split_link')`, itemId)) { removeMirrors(m.id); run('DELETE FROM item WHERE id=?', m.id); }
}

// ---- Processes
function stage(processId: string, position: number) { return get('SELECT * FROM process_stage WHERE process_id=? AND position=?', processId, position); }

function startProcesses(c: Ctx, item: Row) {
 for (const s of all('SELECT * FROM process_stage WHERE efile_id=? AND position=1', item.efile_id)) {
  run(`INSERT INTO process_run(id,process_id,origin_item_id,stage_item_id,stage,status,updated_at) VALUES(?,?,?,?,1,'running',?)`, uid(), s.process_id, item.id, item.id, now());
  notify([s.executor_id, ...JSON.parse(s.notify)].filter(u => u !== c.user.id), 'process', `New item in process: ${item.name}`, item.efile_id, item.id);
 }
}

// Move a run's item on to the next stage eFile (or complete the run after the last stage).
function commitRun(c: Ctx, r: Row) {
 const item = get('SELECT * FROM item WHERE id=?', r.stage_item_id)!;
 const next = stage(r.process_id, r.stage + 1);
 if (!next) {
  run(`UPDATE process_run SET status='completed',updated_at=? WHERE id=?`, now(), r.id);
  refreshStatus(item.id);
  syncConditional(c, r.origin_item_id);
  return;
 }
 const id = uid(), t = now();
 run(`INSERT INTO item(id,efile_id,name,amount,item_date,target_date,source_item_id,source_kind,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'process',?,?,?)`,
  id, next.efile_id, item.name, item.amount, item.item_date, item.target_date, item.id, c.user.id, t, t);
 for (const s of all('SELECT position FROM efile_step WHERE efile_id=?', next.efile_id)) run('INSERT INTO item_step(item_id,position) VALUES(?,?)', id, s.position);
 run('UPDATE process_run SET stage=?,stage_item_id=?,updated_at=? WHERE id=?', r.stage + 1, id, t, r.id);
 refreshStatus(item.id); refreshStatus(id);
 touch(next.efile_id);
 syncConditional(c, r.origin_item_id);
 notify([next.executor_id, ...JSON.parse(next.notify)], 'process', `Item arrived at ${get('SELECT name FROM efile WHERE id=?', next.efile_id)!.name}: ${item.name}`, next.efile_id, id);
 log(c, 'process', 'modify', `提交流程:${item.name} → 第${r.stage + 1}步`);
 autoCommit(c, {...r, stage: r.stage + 1, stage_item_id: id});
}
function syncConditional(c: Ctx, originItemId: string) { if (get(`SELECT 1 FROM item_link WHERE item_id=? AND kind='conditional_auto_link'`, originItemId)) syncLinks(c, originItemId); }

// Auto Commit: a stage item whose confirmation steps are all signed moves on by itself.
function autoCommit(c: Ctx, r: Row) {
 const s = stage(r.process_id, r.stage);
 if (!s?.auto_commit) return;
 const st = itemSteps(r.stage_item_id);
 if (st.length && st.every(x => x.confirmed_at)) commitRun(c, get('SELECT * FROM process_run WHERE id=?', r.id)!);
}

function canConfirm(c: Ctx, item: Row) {
 const pos = nextStep(item.id); if (!pos) return 0;
 return get('SELECT 1 FROM efile_step_user WHERE efile_id=? AND position=? AND user_id=?', item.efile_id, pos, c.user.id) ? pos : 0;
}
function runFor(itemId: string) { return get(`SELECT r.*, s.executor_id FROM process_run r JOIN process_stage s ON s.process_id=r.process_id AND s.position=r.stage WHERE r.stage_item_id=? AND r.status='running'`, itemId); }
function canCommit(c: Ctx, itemId: string) {
 const r = runFor(itemId); if (!r || r.executor_id !== c.user.id) return false;
 return itemSteps(itemId).every(s => s.confirmed_at);
}

function itemRow(c: Ctx, i: Row) {
 const r = runFor(i.id);
 const st = itemSteps(i.id);
 return {
  id: i.id, efile_id: i.efile_id, name: i.name, amount: fmt(i.amount), item_date: i.item_date, target_date: i.target_date,
  highlight: !!i.highlight, move_to_top: !!i.move_to_top, special_marking: !!i.special_marking, status: i.status,
  starred: !!get('SELECT 1 FROM item_star WHERE user_id=? AND item_id=?', c.user.id, i.id),
  steps: st.map(s => ({position: s.position, confirmed: !!s.confirmed_at})),
  in_process: !!r || !!get(`SELECT 1 FROM process_run WHERE origin_item_id=? OR stage_item_id=?`, i.id, i.id), stage: r?.stage ?? null,
  all_confirmed: st.length > 0 && st.every(s => s.confirmed_at),
  mirrored: MIRROR_KINDS.includes(i.source_kind), shared_in: !!i.shared_in,
  comments: get('SELECT COUNT(*) AS n FROM item_comment WHERE item_id=?', i.id)!.n,
  attachments: get('SELECT COUNT(*) AS n FROM item_attachment WHERE item_id=?', i.id)!.n,
  can_confirm: canConfirm(c, i), can_commit: canCommit(c, i.id),
 };
}

export const itemActions: Record<string, (c: Ctx, b: any) => any> = {
 async 'item.list'(c, b) {
  const e = openEfile(c, b.efileId); await unlocked(e, b.password);
  const filter = text(b.filter, 20) || 'uncompleted';
  let rows = all(`SELECT i.*, 0 AS shared_in FROM item i WHERE i.efile_id=?
   UNION ALL SELECT i.*, 1 AS shared_in FROM item i JOIN item_link l ON l.item_id=i.id AND l.kind='auto_share' WHERE l.target_efile_id=?`, e.id, e.id);
  const q = text(b.q, 100).toLowerCase(); if (q) rows = rows.filter(r => r.name.toLowerCase().includes(q));
  if (filter === 'uncompleted') rows = rows.filter(r => r.status === 'uncompleted');
  else if (filter === 'completed') rows = rows.filter(r => r.status === 'completed');
  else if (filter === 'special') rows = rows.filter(r => r.special_marking);
  else if (/^step[1-5]$/.test(filter)) rows = rows.filter(r => nextStep(r.id) === Number(filter[4]));
  else if (filter === 'process') rows = rows.filter(r => get(`SELECT 1 FROM process_run WHERE stage_item_id=? AND status='running'`, r.id));
  else if (filter === 'processDone') rows = rows.filter(r => get(`SELECT 1 FROM process_run WHERE (origin_item_id=? OR stage_item_id=?) AND (status='completed' OR stage_item_id<>?)`, r.id, r.id, r.id));
  else if (filter === 'unlocked') rows = rows.filter(r => get(`SELECT 1 FROM item_link WHERE item_id=? AND locked=0 AND kind IN ('auto_link','conditional_auto_link','split_link')`, r.id));
  rows.sort((a, z) => (z.move_to_top - a.move_to_top) || z.item_date.localeCompare(a.item_date) || z.created_at.localeCompare(a.created_at));
  const items = rows.map(r => itemRow(c, r));
  const shareOnly = e.role === 'member' && get('SELECT balance FROM efile_share WHERE efile_id=? AND user_id=?', e.id, c.user.id)?.balance === 0;
  const bal = balances(e);
  log(c, 'efile', 'view', `访问eFile:${e.name}`);
  return {
   efile: {id: e.id, name: e.name, color: get('SELECT color FROM user_efile WHERE user_id=? AND efile_id=?', c.user.id, e.id)?.color || e.color, currency: e.currency, role: e.role},
   steps: efileSteps(e.id).map(s => ({position: s.position, title: s.title})),
   balances: shareOnly ? [] : [
    {kind: 'balance', name: e.balance_alias || 'Balance/Sum', amount: fmt(bal.balance)},
    ...(e.notional_alias || e.notional ? [{kind: 'notional', name: e.notional_alias || 'Notional Balance/Sum', amount: fmt(bal.notional)}] : []),
   ],
   items, sum: fmt(rows.reduce((s, r) => s + r.amount, 0)), filter,
  };
 },
 async 'item.get'(c, b) {
  const i = get('SELECT * FROM item WHERE id=?', text(b.id, 64)); if (!i) fail('Item is unavailable.');
  const e = openEfile(c, i.efile_id); await unlocked(e, b.password);
  const links = all('SELECT l.*, f.name AS efile_name, s.name AS step_efile_name, t.name AS item_name FROM item_link l JOIN efile f ON f.id=l.target_efile_id LEFT JOIN efile s ON s.id=l.step_efile_id LEFT JOIN item t ON t.id=l.target_item_id WHERE l.item_id=?', i.id)
   .map(l => ({...l, split_amount: fmt(l.split_amount), change_sign: !!l.change_sign, locked: !!l.locked}));
  const steps = efileSteps(e.id);
  const st = itemSteps(i.id);
  return {
   item: {...itemRow(c, i), created_by: userLabel(get('SELECT * FROM user WHERE id=?', i.created_by) ?? {username: '—'}), created_at: i.created_at, updated_at: i.updated_at, source_kind: i.source_kind},
   efile: {id: e.id, name: e.name, currency: e.currency, color: e.color, role: e.role},
   links, steps: steps.map(s => ({...s, required: st.some(x => x.position === s.position), confirmed: st.find(x => x.position === s.position)?.confirmed_at ?? null,
    confirmed_by: (u => u ? userLabel(u) : '')(get('SELECT u.* FROM user u WHERE u.id=?', st.find(x => x.position === s.position)?.confirmed_by ?? '')) })),
   comments: all('SELECT c.*, u.username FROM item_comment c LEFT JOIN user u ON u.id=c.user_id WHERE c.item_id=? ORDER BY c.at', i.id),
   attachments: all('SELECT id,filename,size,at FROM item_attachment WHERE item_id=? ORDER BY at', i.id),
  };
 },
 async 'item.save'(c, b) {
  const existing = b.id ? get('SELECT * FROM item WHERE id=?', text(b.id, 64)) : null;
  if (b.id) check(existing, 'Item is unavailable.');
  const e = openEfile(c, existing?.efile_id ?? b.efileId); await unlocked(e, b.password);
  check(!e.archived, 'This eFile is archived.');
  if (existing) check(!MIRROR_KINDS.includes(existing.source_kind) || !get('SELECT 1 FROM item_link WHERE target_item_id=? AND locked=0', existing.id), 'This item is linked from another eFile. Edit the original item instead.');
  const f = {name: required(b.name, 'Name', 2000), amount: cents(b.amount), item_date: date(b.item_date, 'Item Date') || now().slice(0, 10), target_date: date(b.target_date, 'Target Date'),
   highlight: bool(b.highlight), move_to_top: bool(b.move_to_top), special_marking: bool(b.special_marking)};
  const definedSteps = all('SELECT position FROM efile_step WHERE efile_id=?', e.id).map(s => s.position);
  const wanted = (Array.isArray(b.steps) ? b.steps : []).map(Number).filter((p: number) => definedSteps.includes(p));
  const links = (Array.isArray(b.links) ? b.links : []).slice(0, 50).map((l: any) => {
   check(LINK_KINDS.includes(l.kind), 'Unknown link type.');
   const target = openEfile(c, l.efile_id);
   check(target.id !== e.id, 'An item cannot link to its own eFile.');
   const out: Row = {id: text(l.id, 64), kind: l.kind, target_efile_id: target.id, change_sign: bool(l.change_sign), split_amount: l.kind === 'split_link' ? cents(l.split_amount, 'Split amount') : 0, step_efile_id: null, target_item_id: null, locked: bool(l.locked)};
   if (l.kind === 'conditional_auto_link') out.step_efile_id = openEfile(c, l.step_efile_id).id;
   if (l.kind === 'bind') { const t = get('SELECT id FROM item WHERE id=? AND efile_id=?', text(l.item_id, 64), target.id); check(t, 'Choose the item to bind.'); out.target_item_id = t.id; }
   return out;
  });
  const splits = links.filter((l: Row) => l.kind === 'split_link');
  if (splits.length) check(splits.reduce((s: number, l: Row) => s + l.split_amount, 0) === f.amount, 'Split Link amounts must add up to the item amount.');
  return tx(() => {
   const id = existing?.id ?? uid(), t = now();
   if (existing) run('UPDATE item SET name=?,amount=?,item_date=?,target_date=?,highlight=?,move_to_top=?,special_marking=?,updated_at=? WHERE id=?', f.name, f.amount, f.item_date, f.target_date, f.highlight, f.move_to_top, f.special_marking, t, id);
   else run('INSERT INTO item(id,efile_id,name,amount,item_date,target_date,highlight,move_to_top,special_marking,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', id, e.id, f.name, f.amount, f.item_date, f.target_date, f.highlight, f.move_to_top, f.special_marking, c.user.id, t, t);
   // Confirmation steps: keep signatures on steps that stay required.
   for (const s of itemSteps(id)) if (!wanted.includes(s.position)) run('DELETE FROM item_step WHERE item_id=? AND position=?', id, s.position);
   for (const p of wanted) run('INSERT OR IGNORE INTO item_step(item_id,position) VALUES(?,?)', id, p);
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
   if (!existing) startProcesses(c, {id, efile_id: e.id, name: f.name});
   syncLinks(c, id);
   refreshStatus(id); touch(e.id);
   const next = nextStep(id);
   if (next) notify(all('SELECT user_id FROM efile_step_user WHERE efile_id=? AND position=?', e.id, next).map(r => r.user_id).filter(u => u !== c.user.id), 'confirm', `Confirmation needed: ${f.name}`, e.id, id);
   log(c, 'item', existing ? 'modify' : 'add', `${existing ? '修改' : '新增'}Item:${e.name} - ${f.name.slice(0, 80)}`);
   return {id};
  });
 },
 'item.delete'(c, b) {
  const list = ids(b.ids ?? [b.id]); check(list.length, 'Select at least one item.');
  tx(() => {
   for (const id of list) {
    const i = get('SELECT * FROM item WHERE id=?', id); if (!i) continue;
    const e = openEfile(c, i.efile_id);
    check(e.role === 'admin' || i.created_by === c.user.id, 'Only the item creator or an eFile administrator can delete this item.');
    check(!get(`SELECT 1 FROM process_run WHERE (origin_item_id=? AND stage_item_id<>?) AND status='running'`, i.id, i.id), `"${i.name}" has moved on in its process and cannot be deleted here.`);
    removeMirrors(i.id); run('DELETE FROM item WHERE id=?', i.id); touch(e.id);
    log(c, 'item', 'remove', `删除Item:${e.name} - ${i.name.slice(0, 80)}`);
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
    const i = get('SELECT * FROM item WHERE id=?', id); if (!i) continue; openEfile(c, i.efile_id);
    if (ops[op]) run(`UPDATE item SET ${ops[op]} WHERE id=?`, id);
    else if (op === 'lock' || op === 'unlock') run('UPDATE item_link SET locked=? WHERE item_id=?', op === 'lock' ? 1 : 0, id);
    else check(false, 'This function is not available.');
   }
  });
  return {};
 },
 'item.star'(c, b) {
  const i = get('SELECT * FROM item WHERE id=?', text(b.id, 64)); if (!i) fail('Item is unavailable.'); openEfile(c, i.efile_id);
  if (get('SELECT 1 FROM item_star WHERE user_id=? AND item_id=?', c.user.id, i.id)) run('DELETE FROM item_star WHERE user_id=? AND item_id=?', c.user.id, i.id);
  else run('INSERT INTO item_star(user_id,item_id) VALUES(?,?)', c.user.id, i.id);
  return {};
 },
 'item.confirm'(c, b) {
  const i = get('SELECT * FROM item WHERE id=?', text(b.id, 64)); if (!i) fail('Item is unavailable.');
  const e = openEfile(c, i.efile_id);
  const pos = canConfirm(c, i); check(pos, 'This item is not waiting for your confirmation.');
  return tx(() => {
   run('UPDATE item_step SET confirmed_by=?,confirmed_at=? WHERE item_id=? AND position=?', c.user.id, now(), i.id, pos);
   const title = get('SELECT title FROM efile_step WHERE efile_id=? AND position=?', e.id, pos)?.title ?? `Step ${pos}`;
   item_comment(i.id, c.user.id, `✔ ${title}${text(b.note, 1000) ? ': ' + text(b.note, 1000) : ''}`);
   refreshStatus(i.id); touch(e.id);
   const next = nextStep(i.id);
   if (next) notify(all('SELECT user_id FROM efile_step_user WHERE efile_id=? AND position=?', e.id, next).map(r => r.user_id), 'confirm', `Confirmation needed: ${i.name}`, e.id, i.id);
   else notify([i.created_by], 'confirm', `All confirmations complete: ${i.name}`, e.id, i.id);
   log(c, 'item', 'modify', `确认Item(${title}):${e.name} - ${i.name.slice(0, 80)}`);
   const r = runFor(i.id); if (r) autoCommit(c, r);
   return {};
  });
 },
 // Send an item back: clears all its signatures so confirmation starts again.
 'item.return'(c, b) {
  const i = get('SELECT * FROM item WHERE id=?', text(b.id, 64)); if (!i) fail('Item is unavailable.');
  const e = openEfile(c, i.efile_id);
  check(canConfirm(c, i) || e.role === 'admin', 'Only the current confirmer or an eFile administrator can return this item.');
  const note = required(b.note, 'Reason', 1000);
  return tx(() => {
   run('UPDATE item_step SET confirmed_by=NULL,confirmed_at=NULL WHERE item_id=?', i.id);
   item_comment(i.id, c.user.id, `↩ Returned: ${note}`);
   refreshStatus(i.id); touch(e.id);
   notify([i.created_by], 'confirm', `Item returned: ${i.name}`, e.id, i.id);
   log(c, 'item', 'modify', `退回Item:${e.name} - ${i.name.slice(0, 80)}`);
   return {};
  });
 },
 'item.comment'(c, b) {
  const i = get('SELECT * FROM item WHERE id=?', text(b.id, 64)); if (!i) fail('Item is unavailable.'); openEfile(c, i.efile_id);
  item_comment(i.id, c.user.id, required(b.body, 'Comment', 4000)); return {};
 },
 'process.commit'(c, b) {
  const i = get('SELECT * FROM item WHERE id=?', text(b.id, 64)); if (!i) fail('Item is unavailable.'); openEfile(c, i.efile_id);
  check(canCommit(c, i.id), 'Only the process executor can commit this item, after its confirmations are complete.');
  return tx(() => { commitRun(c, get(`SELECT * FROM process_run WHERE stage_item_id=? AND status='running'`, i.id)!); return {}; });
 },

 // ---- Set Process
 'process.get'(c, b) {
  const e = openEfile(c, b.efileId);
  const p = get('SELECT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? AND s.position=1', e.id);
  const stages = p ? all('SELECT s.*, f.name AS efile_name FROM process_stage s JOIN efile f ON f.id=s.efile_id WHERE s.process_id=? ORDER BY s.position', p.id).map(s => {
   const f = get('SELECT * FROM efile WHERE id=?', s.efile_id)!;
   const ex = get('SELECT * FROM user WHERE id=?', s.executor_id);
   const executorCanOpen = ex ? !!role({user: ex, companyId: ex.company_id, sys: !!ex.system_admin, perms: new Set()}, f) : false;
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
   const ex = companyUser(c, s.executor_id); check(ex, `Choose an Executor for ${f.name}.`);
   return {efile_id: f.id, executor_id: ex.id, notify: JSON.stringify(ids(s.notify).filter(u => get('SELECT id FROM user WHERE id=? AND company_id=?', u, c.companyId))), auto_commit: bool(s.auto_commit), confirm_balance: bool(s.confirm_balance)};
  });
  return tx(() => {
   let p = get('SELECT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? AND s.position=1', e.id);
   if (p) {
    const beyond = get(`SELECT MAX(stage) AS n FROM process_run WHERE process_id=? AND status='running'`, p.id)?.n ?? 0;
    check(beyond <= stages.length, 'Items are still running at a stage you removed. Finish or delete them first.');
    run('UPDATE process SET name=? WHERE id=?', name, p.id); run('DELETE FROM process_stage WHERE process_id=?', p.id);
   } else { p = {id: uid()}; run('INSERT INTO process(id,company_id,name) VALUES(?,?,?)', p.id, e.company_id, name); }
   stages.forEach((s: Row, i: number) => run('INSERT INTO process_stage(process_id,position,efile_id,executor_id,notify,auto_commit,confirm_balance) VALUES(?,?,?,?,?,?,?)', p!.id, i + 1, s.efile_id, s.executor_id, s.notify, s.auto_commit, s.confirm_balance));
   log(c, 'process', 'modify', `设置流程:${name}`);
   return {id: p.id};
  });
 },
 // X Process Set
 'process.clear'(c, b) {
  const e = openEfile(c, b.efileId, 'admin');
  const p = get('SELECT p.* FROM process p JOIN process_stage s ON s.process_id=p.id WHERE s.efile_id=? AND s.position=1', e.id);
  check(p, 'This eFile has no process.');
  check(!get(`SELECT 1 FROM process_run WHERE process_id=? AND status='running'`, p.id), 'Items are still running in this process. Finish or delete them first.');
  tx(() => { run('DELETE FROM process WHERE id=?', p.id); log(c, 'process', 'remove', `取消流程:${p.name}`); });
  return {};
 },

 // ---- To Do (home page)
 'todo.confirm'(c) {
  const rows = all(`SELECT i.*, e.name AS efile_name FROM item i JOIN efile e ON e.id=i.efile_id
   JOIN item_step s ON s.item_id=i.id AND s.confirmed_at IS NULL
   WHERE s.position=(SELECT MIN(position) FROM item_step x WHERE x.item_id=i.id AND x.confirmed_at IS NULL)
   AND EXISTS(SELECT 1 FROM efile_step_user su WHERE su.efile_id=i.efile_id AND su.position=s.position AND su.user_id=?)
   ORDER BY i.item_date DESC`, c.user.id);
  return rows.map(r => ({id: r.id, efile_id: r.efile_id, name: `${r.efile_name} - ${r.name}`, step: nextStep(r.id)}));
 },
 'todo.executor'(c) {
  return all(`SELECT DISTINCT e.id, e.name, (SELECT COUNT(*) FROM process_run r WHERE r.process_id=s.process_id AND r.stage=s.position AND r.status='running') AS waiting
   FROM process_stage s JOIN efile e ON e.id=s.efile_id WHERE s.executor_id=? ORDER BY e.name`, c.user.id);
 },
 'counters'(c) {
  return {
   messages: get('SELECT COUNT(*) AS n FROM notification WHERE user_id=? AND read_at IS NULL', c.user.id)!.n,
   confirm: (itemActions['todo.confirm'](c, {}) as Row[]).length,
  };
 },
 'notifications'(c) { return all('SELECT * FROM notification WHERE user_id=? ORDER BY at DESC LIMIT 50', c.user.id); },
 'notifications.read'(c) { run('UPDATE notification SET read_at=? WHERE user_id=? AND read_at IS NULL', now(), c.user.id); return {}; },
};

function item_comment(itemId: string, userId: string, body: string) { run('INSERT INTO item_comment(id,item_id,user_id,body,at) VALUES(?,?,?,?,?)', uid(), itemId, userId, body, now()); }
