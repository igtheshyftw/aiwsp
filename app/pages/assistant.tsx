// AiWSP Assistant: a chat for clients, an inbox for WSP professionals (review, take over, reply, notes) and settings.
import {Fragment, useEffect, useRef, useState, type ReactNode} from 'react';
import {api, go, fmtTime} from '../lib';
import {Breadcrumb, Loading, toast, toastError, confirmBox, FormPanel, FieldRow} from '../ui';

// ---- Formatting: paragraphs, bullet/numbered lines, **bold** and links. Everything else is plain text (React escapes it).
function inline(s: string): ReactNode[] {
 const out: ReactNode[] = []; const re = /(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g; let last = 0, m: RegExpExecArray | null, k = 0;
 while ((m = re.exec(s))) {
  if (m.index > last) out.push(s.slice(last, m.index));
  out.push(m[0].startsWith('**') ? <b key={k++}>{m[0].slice(2, -2)}</b> : <a key={k++} href={m[0]} target="_blank" rel="noopener noreferrer">{m[0]}</a>);
  last = m.index + m[0].length;
 }
 if (last < s.length) out.push(s.slice(last));
 return out;
}
export function Rich({text}: {text: string}) {
 const blocks = text.split(/\n{2,}/);
 return <>{blocks.map((b, i) => {
  const lines = b.split('\n');
  if (lines.every(l => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
   const ordered = /^\s*\d/.test(lines[0]); const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ''))}</li>);
   return ordered ? <ol key={i}>{items}</ol> : <ul key={i}>{items}</ul>;
  }
  return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br/>}{inline(l)}</Fragment>)}</p>;
 })}</>;
}

type Msg = {id: string, role: string, author: string, body: string, state: string, meta: any, rating?: number | null, created_at: string, reviewed_by?: string};
type Thread = {conversation: any, messages: Msg[], staff: boolean, mine: boolean, thinking: boolean};

// Poll quickly while the assistant is writing, slowly otherwise (also picks up staff replies).
function useThread(id: string | undefined, staff: boolean) {
 const [t, setT] = useState<Thread | null>(null);
 const [tick, setTick] = useState(0);
 useEffect(() => {
  if (!id) { setT(null); return; }
  let live = true, timer: any;
  const load = () => api<Thread>('chat.get', {id, staff}).then(r => { if (!live) return; setT(r); timer = setTimeout(load, r.thinking ? 800 : 5000); }).catch(e => { if (live) { toastError(e); timer = setTimeout(load, 10000); } });
  load();
  return () => { live = false; clearTimeout(timer); };
 }, [id, staff, tick]);
 return {t, reload: () => setTick(x => x + 1)};
}

function Bubble({m, cfg, staffView, onRate, onReview}: {m: Msg, cfg: any, staffView: boolean, onRate?: (r: number) => void, onReview?: (approve: boolean, body?: string) => void}) {
 const [edit, setEdit] = useState<string | null>(null);
 if (m.role === 'system') return <div className="chat-system">{m.body}</div>;
 const who = m.role === 'client' ? (staffView ? m.author : 'You') : m.role === 'agent' ? cfg.name : m.role === 'note' ? `${m.author} · internal note` : `${m.author} · WSP`;
 return <div className={`bubble ${m.role} ${m.state}`}>
  <div className="who">{m.role === 'agent' && <i className="fa fa-comments-o"/>} {who} <span className="when">{fmtTime(m.created_at).slice(5, 16)}</span>
   {m.state === 'review' && <span className="ext">waiting for your review</span>}{m.state === 'discarded' && <span className="ext">discarded by {m.reviewed_by}</span>}
   {m.reviewed_by && m.state === 'sent' && staffView && <span className="ext">reviewed by {m.reviewed_by}{m.meta?.edited ? ', edited' : ''}</span>}</div>
  {m.state === 'thinking' && !m.body ? <div className="typing"><span/><span/><span/></div> : edit !== null ? <textarea className="chat-edit" value={edit} onChange={e => setEdit(e.target.value)} rows={8}/> : <div className="body"><Rich text={m.body}/>{m.state === 'thinking' && <span className="cursor"/>}</div>}
  {m.meta?.sources?.length > 0 && <div className="sources">Sources: {m.meta.sources.map((s: any, i: number) => <span key={i}>{s.url ? <a href={s.url} target="_blank" rel="noopener noreferrer">{s.title || s.url}</a> : s.title}</span>)}</div>}
  {staffView && m.role === 'agent' && typeof m.meta?.confidence === 'number' && <div className="sources">Confidence {Math.round(m.meta.confidence * 100)}%{m.rating === -1 ? ' · client marked unhelpful' : m.rating === 1 ? ' · client marked helpful' : ''}</div>}
  {onRate && m.role === 'agent' && m.state === 'sent' && <div className="rate">
   <button className={m.rating === 1 ? 'on' : ''} title="Helpful" onClick={() => onRate(1)}><i className="fa fa-thumbs-o-up"/></button>
   <button className={m.rating === -1 ? 'on' : ''} title="Not helpful" onClick={() => onRate(-1)}><i className="fa fa-thumbs-o-down"/></button></div>}
  {onReview && m.state === 'review' && <div className="review-bar">
   {edit === null ? <><button className="btn green" onClick={() => onReview(true)}><i className="fa fa-check"/> Approve and send</button>
    <button className="btn grey" onClick={() => setEdit(m.body)}><i className="fa fa-edit"/> Edit</button>
    <button className="btn grey" onClick={() => onReview(false)}><i className="fa fa-times"/> Discard</button></>
    : <><button className="btn green" onClick={() => onReview(true, edit)}><i className="fa fa-check"/> Send edited answer</button><button className="btn grey" onClick={() => setEdit(null)}>Cancel</button></>}
  </div>}
 </div>;
}

function Composer({placeholder, onSend, disabled, extra}: {placeholder: string, onSend: (text: string) => Promise<any>, disabled?: boolean, extra?: ReactNode}) {
 const [text, setText] = useState(''); const [busy, setBusy] = useState(false);
 const send = async () => { const v = text.trim(); if (!v || busy) return; setBusy(true); try { await onSend(v); setText(''); } catch (e) { toastError(e); } finally { setBusy(false); } };
 return <div className="chat-input">
  {extra}
  <textarea value={text} placeholder={placeholder} disabled={disabled} rows={2} onChange={e => setText(e.target.value)} aria-label={placeholder}
   onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }}/>
  <button className="btn blue" onClick={send} disabled={disabled || busy || !text.trim()} aria-label="Send"><i className="fa fa-paper-plane"/></button>
 </div>;
}

function ThreadView({t, cfg, staffView, reload}: {t: Thread, cfg: any, staffView: boolean, reload: () => void}) {
 const end = useRef<HTMLDivElement>(null);
 const last = t.messages[t.messages.length - 1];
 useEffect(() => { end.current?.scrollIntoView({block: 'end'}); }, [t.messages.length, last?.body.length]);
 const act = async (action: string, params: any, msg?: string) => { try { await api(action, {id: t.conversation.id, ...params}); if (msg) toast(msg); reload(); } catch (e) { toastError(e); } };
 return <div className="chat-scroll">
  {!staffView && <div className="chat-system">{cfg.welcome}</div>}
  {t.messages.map(m => <Bubble key={m.id} m={m} cfg={cfg} staffView={staffView}
   onRate={!staffView && t.mine ? r => act('chat.rate', {messageId: m.id, rating: m.rating === r ? 0 : r}) : undefined}
   onReview={staffView ? (approve, body) => act('chat.review', {messageId: m.id, approve, body}, approve ? 'Answer sent.' : 'Answer discarded.') : undefined}/>)}
  <div ref={end}/>
 </div>;
}

// ---------------- Client chat
export function AssistantChat({id}: {id?: string}) {
 const [cfg, setCfg] = useState<any>(null);
 const [list, setList] = useState<any[] | null>(null);
 const {t, reload} = useThread(id, false);
 const loadList = () => api<any[]>('chat.list').then(setList).catch(toastError);
 useEffect(() => { api('chat.config').then(setCfg).catch(toastError); }, []);
 useEffect(() => { loadList(); }, [id, t?.messages.length]); // eslint-disable-line react-hooks/exhaustive-deps
 if (!cfg) return <Loading/>;
 const start = async (text: string) => { const r = await api('chat.start', {text}); go(`/assistant/${r.id}`); };
 const send = async (text: string) => { await api('chat.send', {id, text}); reload(); };
 const conv = t?.conversation;
 return <>
  <Breadcrumb items={[{label: cfg.name}]} tools={cfg.can_staff ? <button className="btn plain" style={{height: 30}} onClick={() => go('/assistant/inbox')}><i className="fa fa-inbox"/> Client Conversations</button> : undefined}/>
  <div className="chat-wrap">
   <aside className="chat-list">
    <button className="btn blue new-chat" onClick={() => go('/assistant')}><i className="fa fa-plus"/> New conversation</button>
    {(list ?? []).map(c => <a key={c.id} href={`#/assistant/${c.id}`} className={'conv' + (c.id === id ? ' on' : '') + (c.unread ? ' unread' : '')}>
     <div className="title">{c.title}</div><div className="meta">{c.status === 'waiting' ? 'Waiting for WSP · ' : c.status === 'closed' ? 'Closed · ' : !c.agent_on ? 'With WSP · ' : ''}{fmtTime(c.updated_at).slice(5, 16)}</div></a>)}
    {list?.length === 0 && <p className="muted" style={{padding: '0 12px'}}>No conversations yet.</p>}
   </aside>
   <section className="chat-main">
    <div className="chat-head"><i className="fa fa-comments"/> {conv ? conv.title : cfg.name}
     {conv && <span className="tools">
      {conv.status !== 'closed' && conv.agent_on && conv.status !== 'waiting' && <button className="btn plain" onClick={async () => { await api('chat.human', {id}); reload(); }}><i className="fa fa-user"/> Talk to a WSP professional</button>}
      <button className="btn plain" onClick={async () => { if (conv.status === 'closed' || await confirmBox('Close this conversation?')) { await api('chat.close', {id}); reload(); } }}>{conv.status === 'closed' ? 'Reopen' : 'Close'}</button>
     </span>}</div>
    {!cfg.enabled && <div className="notice-bar" style={{margin: 12}}>The assistant is switched off at the moment. WSP professionals will still see and answer your messages.</div>}
    {!id ? <div className="chat-scroll">
     <div className="chat-hello"><i className="fa fa-comments-o"/><h2>{cfg.name}</h2><p>{cfg.welcome}</p>
      <div className="suggestions">{cfg.suggestions.map((s: string) => <button key={s} onClick={() => start(s).catch(toastError)}>{s}</button>)}</div></div>
    </div> : !t ? <Loading/> : <ThreadView t={t} cfg={cfg} staffView={false} reload={reload}/>}
    <Composer placeholder={id ? (conv?.status === 'closed' ? 'This conversation is closed.' : 'Type your message… (Enter to send, Shift+Enter for a new line)') : 'Ask a question…'} disabled={conv?.status === 'closed'} onSend={id ? send : start}/>
    <div className="disclaimer">{cfg.disclaimer}</div>
   </section>
  </div>
 </>;
}

// ---------------- WSP inbox
const FILTERS: [string, string][] = [['attention', 'Needs attention'], ['review', 'To review'], ['waiting', 'Waiting for WSP'], ['mine', 'Assigned to me'], ['clients', 'My clients'], ['open', 'Open'], ['closed', 'Closed'], ['all', 'All']];
export function AssistantInbox({id}: {id?: string}) {
 const [cfg, setCfg] = useState<any>(null);
 const [filter, setFilter] = useState('attention');
 const [inbox, setInbox] = useState<any>(null);
 const [mode, setMode] = useState<'reply' | 'note'>('reply');
 const {t, reload} = useThread(id, true);
 useEffect(() => { api('chat.config').then(setCfg).catch(toastError); }, []);
 useEffect(() => {
  let live = true, timer: any;
  const load = () => api('chat.inbox', {filter}).then(r => { if (live) { setInbox(r); timer = setTimeout(load, 8000); } }).catch(toastError);
  load(); return () => { live = false; clearTimeout(timer); };
 }, [filter, t?.messages.length]);
 if (!cfg) return <Loading/>;
 const conv = t?.conversation;
 const act = async (action: string, params: any, msg: string) => { try { await api(action, {id, ...params}); toast(msg); reload(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: cfg.name, to: '/assistant'}, {label: 'Client Conversations'}]} tools={cfg.can_settings ? <button className="btn plain" style={{height: 30}} onClick={() => go('/assistant/settings')}><i className="fa fa-cog"/> Settings</button> : undefined}/>
  {!cfg.agent_connected && <div className="notice-bar">No agent is connected yet (AGENT_URL is not set). Every question is handed to WSP staff. See docs/aiwsp/assistant.md.</div>}
  <div className="chat-wrap">
   <aside className="chat-list">
    <select value={filter} onChange={e => setFilter(e.target.value)} aria-label="Filter" style={{margin: 10, width: 'calc(100% - 20px)', height: 30}}>
     {FILTERS.map(([k, l]) => <option key={k} value={k}>{l}{inbox && ['attention', 'review', 'waiting'].includes(k) ? ` (${inbox.counts[k]})` : ''}</option>)}</select>
    {(inbox?.rows ?? []).map((c: any) => <a key={c.id} href={`#/assistant/inbox/${c.id}`} className={'conv' + (c.id === id ? ' on' : '') + (c.unread ? ' unread' : '')}>
     <div className="title">{c.title}</div>
     <div className="meta">{c.client} · {c.company}{c.my_client && <span className="ext">My client</span>}</div>
     <div className="meta">{c.review && <span className="status pending">review</span>}{c.status === 'waiting' && <span className="status returned">waiting</span>}{!c.agent_on && c.assigned && <span className="status draft">{c.assigned}</span>} {fmtTime(c.updated_at).slice(5, 16)}</div></a>)}
    {inbox?.rows.length === 0 && <p className="muted" style={{padding: '0 12px'}}>Nothing here.</p>}
   </aside>
   <section className="chat-main">
    <div className="chat-head"><i className="fa fa-inbox"/> {conv ? <>{conv.title} <small className="muted">{conv.client} · {conv.company}</small></> : 'Client Conversations'}
     {conv && <span className="tools">
      {conv.agent_on ? <button className="btn plain" onClick={() => act('chat.assign', {}, 'You have taken over. The assistant stops answering.')}><i className="fa fa-hand-paper-o"/> Take over</button>
       : <button className="btn plain" onClick={() => act('chat.assign', {agent: true}, 'Handed back to the assistant.')}><i className="fa fa-comments-o"/> Hand back to assistant</button>}
      {conv.agent_on && <button className="btn plain" title="Ask the assistant to answer the latest question again" onClick={() => act('chat.retry', {}, 'Asked the assistant again.')}><i className="fa fa-refresh"/></button>}
      <button className="btn plain" onClick={() => act('chat.close', {}, conv.status === 'closed' ? 'Reopened.' : 'Closed.')}>{conv.status === 'closed' ? 'Reopen' : 'Close'}</button>
     </span>}</div>
    {!id ? <div className="chat-scroll"><div className="chat-hello"><i className="fa fa-inbox"/><p>Choose a conversation. Answers waiting for review, and clients waiting for a person, are listed under <b>Needs attention</b>.</p></div></div>
     : !t ? <Loading/> : <ThreadView t={t} cfg={cfg} staffView reload={reload}/>}
    {id && t && <Composer placeholder={mode === 'reply' ? 'Reply to the client as WSP (the assistant stops answering)…' : 'Internal note — only WSP staff see this…'} disabled={conv?.status === 'closed' && mode === 'reply'}
     onSend={async text => { await api(mode === 'reply' ? 'chat.reply' : 'chat.note', {id, text}); reload(); }}
     extra={<div className="mode"><label><input type="radio" checked={mode === 'reply'} onChange={() => setMode('reply')}/> Reply to client</label><label><input type="radio" checked={mode === 'note'} onChange={() => setMode('note')}/> Internal note</label></div>}/>}
   </section>
  </div>
 </>;
}

// ---------------- Settings (System Admin)
export function AssistantSettings() {
 const [f, setF] = useState<any>(null);
 useEffect(() => { api('chat.settings').then(r => setF({...r, suggestions: r.suggestions.join('\n')})).catch(toastError); }, []);
 if (!f) return <Loading/>;
 const save = async () => { try { await api('chat.settings', {...f, save: true, suggestions: f.suggestions.split('\n')}); toast('Saved.'); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'AiWSP Assistant', to: '/assistant'}, {label: 'Client Conversations', to: '/assistant/inbox'}, {label: 'Settings'}]}/>
  <FormPanel title="Assistant Settings" onSave={save} actions={<button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button>}>
   <FieldRow label="Agent connection"><div className="view-value">{f.agent_url ? <>Connected to <code>{f.agent_url}</code> (AGENT_URL)</> : 'Not connected — questions go to WSP staff. Set AGENT_URL, or replace server/agent.ts.'}</div></FieldRow>
   <div className="field checks">
    <label><input type="checkbox" checked={!!f.enabled} onChange={e => setF({...f, enabled: e.target.checked})}/>Assistant answers clients</label>
    <label><input type="checkbox" checked={!!f.review} onChange={e => setF({...f, review: e.target.checked})}/>A WSP professional reviews every answer before the client sees it</label>
    <div className="hint">You can also hold only low-confidence answers for review with AGENT_REVIEW_BELOW (for example 0.7), if your agent reports a confidence.</div>
   </div>
   <FieldRow label="Name shown to clients" req><input type="text" value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <FieldRow label="Welcome message"><textarea value={f.welcome} onChange={e => setF({...f, welcome: e.target.value})}/></FieldRow>
   <FieldRow label="Disclaimer (shown under the chat)"><textarea value={f.disclaimer} onChange={e => setF({...f, disclaimer: e.target.value})}/></FieldRow>
   <FieldRow label="Suggested questions (one per line, up to 6)"><textarea rows={5} value={f.suggestions} onChange={e => setF({...f, suggestions: e.target.value})}/></FieldRow>
  </FormPanel>
 </>;
}
