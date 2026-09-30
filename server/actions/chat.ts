// AiWSP Assistant: clients ask questions; the agent (server/agent.ts) answers; WSP professionals review, take over and reply.
// Who sees what: a client sees only their own conversations. WSP staff with the "Client conversations" function see
// conversations of the companies they are designated for through a connection (and their own company's, for testing).
// System Admins see all and manage the assistant settings.
import {all, get, run, uid, now, tx, type Row} from '../db';
import {check, fail, live} from '../auth';
import {type Ctx, context, allowed, text, required, log, notify, userLabel} from '../ctx';
import {answer, type AgentRequest} from '../agent';

const settings = (): Row => { const s = get('SELECT * FROM assistant_setting WHERE id=1')!; return {...s, suggestions: JSON.parse(s.suggestions || '[]')}; };
const operatorId = () => get('SELECT id FROM company WHERE operator=1')?.id as string | undefined;
const REVIEW_BELOW = Number(process.env.AGENT_REVIEW_BELOW || 0);

// Companies whose conversations this user may handle as WSP staff.
function staffCompanies(c: Ctx): Set<string> | 'all' {
 if (c.sys) return 'all';
 if (c.companyId !== operatorId() || !allowed(c, 'clientChat')) return new Set();
 const ids = all(`SELECT CASE WHEN cn.from_company=? THEN cn.to_company ELSE cn.from_company END AS other FROM connection cn
  JOIN connection_user cu ON cu.connection_id=cn.id AND cu.user_id=? WHERE cn.status='connected' AND (cn.from_company=? OR cn.to_company=?)`, c.companyId, c.user.id, c.companyId, c.companyId).map(r => r.other);
 return new Set([c.companyId, ...ids]);
}
const isStaffFor = (c: Ctx, companyId: string) => { const s = staffCompanies(c); return s === 'all' || s.has(companyId); };
function staffFor(companyId: string) {
 const op = operatorId(); if (!op) return [];
 const users = all(`SELECT * FROM user WHERE company_id=? OR position='system'`, op).filter(u => live(u));
 return users.filter(u => isStaffFor(context(u), companyId)).map(u => u.id);
}
function openConv(c: Ctx, id: any) {
 const cv = get('SELECT * FROM chat_conversation WHERE id=?', text(id, 64)); if (!cv) fail('Conversation is unavailable.');
 const mine = cv.user_id === c.user.id, staff = isStaffFor(c, cv.company_id);
 check(mine || staff, 'Conversation is unavailable.');
 return {...cv, mine, staff} as Row;
}
const post = (convId: string, role: string, body: string, author: Row | null, state = 'sent', meta: any = {}) => {
 const id = uid(), t = now();
 run('INSERT INTO chat_message(id,conversation_id,role,author_id,author,body,state,meta,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  id, convId, role, author?.id ?? null, author ? userLabel(author) : '', body, state, JSON.stringify(meta), t, t);
 run('UPDATE chat_conversation SET updated_at=? WHERE id=?', t, convId);
 return id;
};
const markRead = (userId: string, convId: string) => run('INSERT INTO chat_read(user_id,conversation_id,at) VALUES(?,?,?) ON CONFLICT DO UPDATE SET at=excluded.at', userId, convId, now());

// Run the agent in the background: a "thinking" message fills in as the answer streams, then is sent or held for review.
const running = new Set<string>();
function runAgent(convId: string) {
 const cv = get('SELECT * FROM chat_conversation WHERE id=?', convId)!;
 const s = settings(); if (!s.enabled || !cv.agent_on || cv.status === 'closed' || running.has(convId)) return;
 const client = get('SELECT * FROM user WHERE id=?', cv.user_id)!;
 const company = get('SELECT * FROM company WHERE id=?', cv.company_id)!;
 const history = all(`SELECT * FROM chat_message WHERE conversation_id=? AND state='sent' AND role IN ('client','agent','staff') ORDER BY created_at`, convId);
 const question = [...history].reverse().find(m => m.role === 'client')?.body ?? '';
 const msgId = post(convId, 'agent', '', null, 'thinking');
 running.add(convId);
 const req: AgentRequest = {conversation: {id: cv.id, title: cv.title}, client: {id: client.id, name: userLabel(client), company: company.name_en || company.name_cn, company_id: company.id},
  messages: history.map(m => ({role: m.role, content: m.body, author: m.author, at: m.created_at})), question};
 let last = 0;
 const onDelta = (textSoFar: string) => { const t = Date.now(); if (t - last < 250) return; last = t; run(`UPDATE chat_message SET body=?, updated_at=? WHERE id=? AND state='thinking'`, textSoFar, now(), msgId); };
 answer(req, onDelta).then(r => tx(() => {
  const review = !!s.review || (r.confidence !== undefined && r.confidence < REVIEW_BELOW);
  const meta = {sources: r.sources ?? [], confidence: r.confidence};
  if (r.reply.trim()) run('UPDATE chat_message SET body=?, state=?, meta=?, updated_at=? WHERE id=?', r.reply, review ? 'review' : 'sent', JSON.stringify(meta), now(), msgId);
  else run('DELETE FROM chat_message WHERE id=?', msgId);
  if (review) notify(staffFor(cv.company_id), 'chat', `Assistant answer to review: ${cv.title}`);
  if (r.handoff) handOff(cv, 'The assistant has asked a WSP professional to join this conversation.');
  run('UPDATE chat_conversation SET updated_at=? WHERE id=?', now(), convId);
 })).catch(err => tx(() => {
  console.error('Agent error:', err?.message ?? err);
  run(`UPDATE chat_message SET role='system', body=?, state='sent', updated_at=? WHERE id=?`, 'The assistant could not answer just now. A WSP professional will follow up here.', now(), msgId);
  handOff(cv, '');
 })).finally(() => running.delete(convId));
}
function handOff(cv: Row, message: string) {
 run(`UPDATE chat_conversation SET status='waiting', updated_at=? WHERE id=?`, now(), cv.id);
 if (message) post(cv.id, 'system', message, null);
 notify(staffFor(cv.company_id), 'chat', `A client is waiting for a WSP professional: ${cv.title}`);
}

// What a message looks like to the viewer. Clients never see staff notes, discarded drafts, or drafts under review.
function visibleMessages(cv: Row, staff: boolean) {
 const review = !!settings().review;
 const rows = all('SELECT * FROM chat_message WHERE conversation_id=? ORDER BY created_at', cv.id);
 const out: Row[] = [];
 for (const m of rows) {
  const base = {id: m.id, role: m.role, author: m.author, body: m.body, state: m.state, meta: JSON.parse(m.meta || '{}'), rating: m.rating, created_at: m.created_at};
  if (staff) { out.push({...base, reviewed_by: m.reviewed_by}); continue; }
  if (m.role === 'note' || m.state === 'discarded') continue;
  if (m.state === 'review') { out.push({...base, role: 'system', body: 'An answer is being prepared and checked by a WSP professional.', state: 'sent', meta: {}}); continue; }
  if (m.state === 'thinking' && review) { out.push({...base, body: ''}); continue; }
  out.push(base);
 }
 return out;
}
function summary(cv: Row, userId: string, staff: boolean) {
 const last = get(`SELECT body, role FROM chat_message WHERE conversation_id=? AND state IN ('sent','review') ${staff ? '' : "AND role<>'note'"} ORDER BY created_at DESC LIMIT 1`, cv.id);
 const read = get('SELECT at FROM chat_read WHERE user_id=? AND conversation_id=?', userId, cv.id)?.at ?? '';
 const unread = !!get(`SELECT 1 FROM chat_message WHERE conversation_id=? AND created_at>? AND state IN ('sent','review') AND (author_id IS NULL OR author_id<>?) ${staff ? '' : "AND role<>'note'"} LIMIT 1`, cv.id, read, userId);
 const client = get('SELECT * FROM user WHERE id=?', cv.user_id);
 const company = get('SELECT name_cn, name_en FROM company WHERE id=?', cv.company_id);
 return {id: cv.id, title: cv.title, status: cv.status, agent_on: !!cv.agent_on, updated_at: cv.updated_at, unread,
  last: last ? (last.role === 'note' ? '(note) ' : '') + last.body.slice(0, 140) : '', client: client ? userLabel(client) : '', company: company?.name_en || company?.name_cn || '',
  assigned: cv.assigned_to ? userLabel(get('SELECT * FROM user WHERE id=?', cv.assigned_to) ?? {username: ''}) : '',
  review: !!get(`SELECT 1 FROM chat_message WHERE conversation_id=? AND state='review'`, cv.id)};
}

export const chatActions: Record<string, (c: Ctx, b: any) => any> = {
 'chat.config'(c) {
  const s = settings(); const sc = staffCompanies(c);
  return {name: s.name, welcome: s.welcome, disclaimer: s.disclaimer, suggestions: s.suggestions, enabled: !!s.enabled, review: !!s.review,
   agent_connected: !!process.env.AGENT_URL, can_staff: sc === 'all' || sc.size > 0, can_settings: c.sys};
 },
 'chat.list'(c) {
  return all('SELECT * FROM chat_conversation WHERE user_id=? ORDER BY updated_at DESC LIMIT 200', c.user.id).map(cv => summary(cv, c.user.id, false));
 },
 'chat.start'(c, b) {
  check(settings().enabled, 'The assistant is switched off at the moment.');
  const body = required(b.text, 'Question', 4000);
  const id = uid(), t = now();
  tx(() => {
   run('INSERT INTO chat_conversation(id,company_id,user_id,title,created_at,updated_at) VALUES(?,?,?,?,?,?)', id, c.companyId, c.user.id, body.replace(/\s+/g, ' ').slice(0, 80), t, t);
   post(id, 'client', body, c.user); markRead(c.user.id, id);
   log(c, 'chat', 'add', `新建咨询:${body.slice(0, 60)}`);
  });
  runAgent(id);
  return {id};
 },
 'chat.get'(c, b) {
  const cv = openConv(c, b.id);
  const asStaff = !!b.staff && cv.staff;
  markRead(c.user.id, cv.id);
  return {conversation: summary(cv, c.user.id, asStaff), messages: visibleMessages(cv, asStaff), staff: asStaff, mine: cv.mine,
   thinking: !!get(`SELECT 1 FROM chat_message WHERE conversation_id=? AND state='thinking'`, cv.id)};
 },
 'chat.send'(c, b) {
  const cv = openConv(c, b.id); check(cv.mine, 'Only the client writes in their own conversation.'); check(cv.status !== 'closed', 'This conversation is closed. Start a new one.');
  const body = required(b.text, 'Message', 4000);
  tx(() => { post(cv.id, 'client', body, c.user); markRead(c.user.id, cv.id); });
  if (cv.agent_on && cv.status === 'open') runAgent(cv.id);
  else notify(cv.assigned_to ? [cv.assigned_to] : staffFor(cv.company_id), 'chat', `New client message: ${cv.title}`);
  return {};
 },
 'chat.human'(c, b) {
  const cv = openConv(c, b.id); check(cv.mine && cv.status !== 'closed');
  tx(() => { handOff(cv, 'You asked to speak to a WSP professional. Someone will reply here.'); log(c, 'chat', 'modify', `请求人工:${cv.title}`); });
  return {};
 },
 'chat.rate'(c, b) {
  const m = get('SELECT * FROM chat_message WHERE id=?', text(b.messageId, 64)); check(m && m.role === 'agent', 'Message is unavailable.');
  const cv = openConv(c, m!.conversation_id); check(cv.mine);
  run('UPDATE chat_message SET rating=? WHERE id=?', b.rating === 1 ? 1 : b.rating === -1 ? -1 : null, m!.id);
  if (b.rating === -1) notify(staffFor(cv.company_id), 'chat', `A client marked an assistant answer as unhelpful: ${cv.title}`);
  return {};
 },
 'chat.close'(c, b) {
  const cv = openConv(c, b.id);
  tx(() => { run(`UPDATE chat_conversation SET status=?, updated_at=? WHERE id=?`, cv.status === 'closed' ? 'open' : 'closed', now(), cv.id); log(c, 'chat', 'modify', `${cv.status === 'closed' ? '重开' : '关闭'}咨询:${cv.title}`, cv.company_id); });
  return {};
 },

 // ---- WSP staff
 'chat.inbox'(c, b) {
  const sc = staffCompanies(c); check(sc === 'all' || sc.size, 'You do not handle client conversations.');
  const rows = (sc === 'all' ? all('SELECT * FROM chat_conversation ORDER BY updated_at DESC LIMIT 500')
   : all(`SELECT * FROM chat_conversation WHERE company_id IN (${[...sc].map(() => '?').join(',')}) ORDER BY updated_at DESC LIMIT 500`, ...sc)).map(cv => summary(cv, c.user.id, true));
  const f = text(b.filter, 20) || 'attention';
  const pick = {attention: (r: Row) => r.review || r.status === 'waiting', review: (r: Row) => r.review, waiting: (r: Row) => r.status === 'waiting',
   mine: (r: Row) => r.assigned === userLabel(c.user), open: (r: Row) => r.status !== 'closed', closed: (r: Row) => r.status === 'closed', all: () => true}[f] ?? (() => true);
  return {rows: rows.filter(pick), counts: {attention: rows.filter(r => r.review || r.status === 'waiting').length, review: rows.filter(r => r.review).length, waiting: rows.filter(r => r.status === 'waiting').length}};
 },
 'chat.reply'(c, b) {
  const cv = openConv(c, b.id); check(cv.staff, 'Only WSP staff reply here.'); check(cv.status !== 'closed', 'Reopen the conversation first.');
  const body = required(b.text, 'Reply', 8000);
  tx(() => {
   post(cv.id, 'staff', body, c.user);
   run(`UPDATE chat_conversation SET status='open', agent_on=0, assigned_to=? WHERE id=?`, c.user.id, cv.id);
   notify([cv.user_id], 'chat', `WSP replied: ${cv.title}`);
   log(c, 'chat', 'add', `专业人员回复:${cv.title}`, cv.company_id);
  });
  return {};
 },
 'chat.note'(c, b) {
  const cv = openConv(c, b.id); check(cv.staff);
  tx(() => { post(cv.id, 'note', required(b.text, 'Note', 4000), c.user); });
  return {};
 },
 // Take over (the assistant stops answering) or hand back to the assistant.
 'chat.assign'(c, b) {
  const cv = openConv(c, b.id); check(cv.staff);
  const toAgent = !!b.agent;
  tx(() => {
   run(`UPDATE chat_conversation SET agent_on=?, assigned_to=?, status=CASE WHEN status='closed' THEN 'closed' ELSE 'open' END WHERE id=?`, toAgent ? 1 : 0, toAgent ? null : c.user.id, cv.id);
   post(cv.id, 'system', toAgent ? 'The AiWSP Assistant is answering again.' : `${userLabel(c.user)} from WSP has joined the conversation.`, null);
   log(c, 'chat', 'modify', `${toAgent ? '交回助手' : '接管咨询'}:${cv.title}`, cv.company_id);
  });
  return {};
 },
 // Approve (optionally edited) or discard an assistant draft held for review.
 'chat.review'(c, b) {
  const m = get(`SELECT * FROM chat_message WHERE id=? AND state='review'`, text(b.messageId, 64)); check(m, 'This answer is no longer waiting for review.');
  const cv = openConv(c, m!.conversation_id); check(cv.staff);
  tx(() => {
   if (b.approve) {
    const body = required(b.body ?? m!.body, 'Answer', 20000);
    const meta = {...JSON.parse(m!.meta || '{}'), edited: body !== m!.body};
    run(`UPDATE chat_message SET body=?, state='sent', reviewed_by=?, meta=?, created_at=?, updated_at=? WHERE id=?`, body, userLabel(c.user), JSON.stringify(meta), now(), now(), m!.id);
    notify([cv.user_id], 'chat', `New answer: ${cv.title}`);
   } else run(`UPDATE chat_message SET state='discarded', reviewed_by=?, updated_at=? WHERE id=?`, userLabel(c.user), now(), m!.id);
   log(c, 'chat', 'modify', `${b.approve ? '批准' : '弃用'}助手回答:${cv.title}`, cv.company_id);
  });
  return {};
 },
 'chat.retry'(c, b) { const cv = openConv(c, b.id); check(cv.staff); check(cv.agent_on, 'Hand the conversation back to the assistant first.'); runAgent(cv.id); return {}; },
 'chat.settings'(c, b) {
  check(c.sys, 'Only System Admins change the assistant settings.');
  if (b.save) {
   const sug = (Array.isArray(b.suggestions) ? b.suggestions : []).map((x: any) => text(x, 200)).filter(Boolean).slice(0, 6);
   tx(() => { run('UPDATE assistant_setting SET enabled=?, review=?, name=?, welcome=?, disclaimer=?, suggestions=? WHERE id=1', b.enabled ? 1 : 0, b.review ? 1 : 0, required(b.name, 'Name', 80), text(b.welcome, 1000), text(b.disclaimer, 1000), JSON.stringify(sug)); log(c, 'chat', 'modify', `修改助手设置 (review=${b.review ? 1 : 0})`); });
  }
  return {...settings(), agent_url: process.env.AGENT_URL ? new URL(process.env.AGENT_URL).origin : ''};
 },
 'chat.counters'(c) {
  const mine = all('SELECT * FROM chat_conversation WHERE user_id=?', c.user.id).filter(cv => summary(cv, c.user.id, false).unread).length;
  const sc = staffCompanies(c);
  const staff = sc === 'all' || sc.size ? (chatActions['chat.inbox'](c, {filter: 'attention'}) as Row).counts.attention : 0;
  return {mine, staff};
 },
};
