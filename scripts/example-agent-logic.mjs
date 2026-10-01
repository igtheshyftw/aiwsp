// The stand-in agent's answers (docs/aiwsp/assistant.md). Used by scripts/example-agent.mjs (over HTTP) and by the online demo.
// It is NOT the real agent: it answers status questions from request.context and matches a small FAQ.
export const FAQ = [
 {keys: ['document', 'need', 'provide', '资料'], reply: 'For the monthly bookkeeping we usually need:\n\n- bank statements for the month\n- sales and purchase invoices\n- expense claims with receipts\n\nYou can upload them to the relevant eFile. A WSP professional will confirm anything specific to your company.', sources: [{title: 'Monthly checklist'}]},
 {keys: ['status', 'submission', 'approved', '审批'], reply: 'You can see the status of each item in its eFile: the circled number shows the current approval step, and **C** means approval is complete. If something has been returned, it appears under To Do → My Items.'},
 {keys: ['deadline', 'due', 'when'], reply: 'Deadlines depend on your filing calendar. I will ask a WSP professional to confirm the date for your company.', handoff: true, confidence: 0.4},
];


export function exampleAnswer({question, client, context}) {
 const q = question.toLowerCase();
 // Status questions are answered from context.open_items (the client's open work that IMS lets the agent see).
 const items = context?.open_items ?? [];
 const statusHit = /open|status|progress|outstanding|进度|状态/.test(q) && items.length ? {reply: `Here is what is open for ${client.company}:\n\n` +
  items.slice(0, 8).map(i => `- **${i.name}** (${i.efile}): ${i.status}${i.target_date ? `, target ${i.target_date}${i.overdue ? ' — overdue' : ''}` : ''}${i.responsible ? `, with ${i.responsible}` : ''}`).join('\n') +
  (context.client_record?.service_team?.length ? `\n\nYour WSP team: ${context.client_record.service_team.join(', ')}.` : ''), sources: [{title: 'IMS open items'}]} : null;
 const hit = statusHit ?? FAQ.find(f => f.keys.some(k => q.includes(k)));
 return hit ?? {reply: `Thank you, ${client.name}. I don't have a confident answer to that yet, so I have asked a WSP professional to reply.`, handoff: true, confidence: 0.2};
}
