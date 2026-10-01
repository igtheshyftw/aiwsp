// The plug-in point for your client-answering agent. See docs/aiwsp/assistant.md.
//
// Two ways to connect an agent:
//  1. Set AGENT_URL (and optionally AGENT_TOKEN). The server POSTs an AgentRequest as JSON and accepts either
//     a JSON AgentReply, or a text/event-stream of `data: {"delta":"..."}` lines ending with `data: {"done":true, ...AgentReply fields}`.
//  2. Replace the body of `answer()` below with your own code (for example, calling your model directly).
// Without either, the assistant tells the client that a WSP professional will reply, and hands the conversation to staff.

export type AgentMessage = {role: 'client' | 'agent' | 'staff', content: string, author: string, at: string};
export type AgentItem = {efile: string, name: string, status: string, target_date: string, overdue: boolean, responsible: string, step: string};
export type AgentRequest = {
 conversation: {id: string, title: string},
 client: {id: string, name: string, company: string, company_id: string},
 // What the assistant may tell this client about their work (open items only; read-only):
 //  - items in eFiles the client user takes part in, and
 //  - items in WSP eFiles for this client whose administrator ticked "Share item status with the client".
 context: {client_record: {code: string, name: string, service_team: string[]} | null, open_items: AgentItem[]},
 messages: AgentMessage[],     // the conversation so far, oldest first (staff-only notes and unapproved drafts are never included)
 question: string,             // the client's latest message
};
export type AgentReply = {
 reply: string,                // the answer shown to the client (plain text; **bold**, bullet lines and links are formatted)
 handoff?: boolean,            // true: hand the conversation to a WSP professional (the reply, if any, is still shown)
 sources?: {title: string, url?: string}[], // optional references shown under the answer
 confidence?: number,          // optional 0–1; below AGENT_REVIEW_BELOW the answer waits for staff review
};

const TIMEOUT_MS = Number(process.env.AGENT_TIMEOUT_MS || 60000);

export async function answer(req: AgentRequest, onDelta: (textSoFar: string) => void): Promise<AgentReply> {
 const url = process.env.AGENT_URL;
 if (!url) return {reply: 'Thank you for your question. A WSP professional will reply here shortly.', handoff: true};
 const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
 try {
  const r = await fetch(url, {method: 'POST', signal: ctrl.signal, headers: {'Content-Type': 'application/json', Accept: 'text/event-stream, application/json',
   ...(process.env.AGENT_TOKEN ? {Authorization: `Bearer ${process.env.AGENT_TOKEN}`} : {})}, body: JSON.stringify(req)});
  if (!r.ok) throw Error(`Agent returned HTTP ${r.status}`);
  if (!(r.headers.get('content-type') ?? '').includes('text/event-stream')) return check(await r.json());
  // Streaming: accumulate deltas and report progress so the client sees the answer as it is written.
  const reader = r.body!.getReader(); const decoder = new TextDecoder(); let buffer = '', text = '', final: any = null;
  for (;;) {
   const {done, value} = await reader.read(); if (done) break;
   buffer += decoder.decode(value, {stream: true});
   let nl;
   while ((nl = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, nl).trim(); buffer = buffer.slice(nl + 1);
    if (!line.startsWith('data:')) continue;
    const payload = line.slice(5).trim(); if (!payload || payload === '[DONE]') continue;
    const ev = JSON.parse(payload);
    if (typeof ev.delta === 'string') { text += ev.delta; onDelta(text); }
    if (ev.done) final = ev;
   }
  }
  return check({...final, reply: final?.reply ?? text});
 } finally { clearTimeout(timer); }
}

function check(r: any): AgentReply {
 if (!r || typeof r.reply !== 'string') throw Error('Agent reply has no "reply" text.');
 return {reply: r.reply.slice(0, 20000), handoff: !!r.handoff,
  sources: Array.isArray(r.sources) ? r.sources.slice(0, 10).map((s: any) => ({title: String(s.title ?? '').slice(0, 200), url: /^https?:\/\//.test(s.url ?? '') ? String(s.url).slice(0, 1000) : undefined})) : undefined,
  confidence: typeof r.confidence === 'number' ? r.confidence : undefined};
}
