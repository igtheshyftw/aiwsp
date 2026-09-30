// A stand-in agent that shows the AGENT_URL contract (docs/aiwsp/assistant.md). It is NOT the real agent:
// it matches questions against a small FAQ and streams the answer. Replace it with your own service.
//   node scripts/example-agent.mjs            (listens on http://127.0.0.1:3100/agent)
//   AGENT_URL=http://127.0.0.1:3100/agent npm start
import {createServer} from 'node:http';

const PORT = Number(process.env.EXAMPLE_AGENT_PORT || 3100);
const TOKEN = process.env.AGENT_TOKEN || '';
const FAQ = [
 {keys: ['document', 'need', 'provide', '资料'], reply: 'For the monthly bookkeeping we usually need:\n\n- bank statements for the month\n- sales and purchase invoices\n- expense claims with receipts\n\nYou can upload them to the relevant eFile. A WSP professional will confirm anything specific to your company.', sources: [{title: 'Monthly checklist'}]},
 {keys: ['status', 'submission', 'approved', '审批'], reply: 'You can see the status of each item in its eFile: the circled number shows the current approval step, and **C** means approval is complete. If something has been returned, it appears under To Do → My Items.'},
 {keys: ['deadline', 'due', 'when'], reply: 'Deadlines depend on your filing calendar. I will ask a WSP professional to confirm the date for your company.', handoff: true, confidence: 0.4},
];

createServer(async (req, res) => {
 if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
 if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(); }
 let body = ''; for await (const chunk of req) body += chunk;
 const {question, client, messages} = JSON.parse(body);
 const q = question.toLowerCase();
 const hit = FAQ.find(f => f.keys.some(k => q.includes(k)));
 const answer = hit ?? {reply: `Thank you, ${client.name}. I don't have a confident answer to that yet, so I have asked a WSP professional to reply.`, handoff: true, confidence: 0.2};
 console.log(`[example-agent] ${client.company} / ${client.name}: ${question} (${messages.length} earlier messages)`);
 if ((req.headers.accept ?? '').includes('text/event-stream')) {
  // Streaming form: send the text in pieces, then the final fields.
  res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache'});
  for (const piece of answer.reply.match(/.{1,12}/gs)) { res.write(`data: ${JSON.stringify({delta: piece})}\n\n`); await new Promise(r => setTimeout(r, 40)); }
  res.write(`data: ${JSON.stringify({done: true, handoff: !!answer.handoff, sources: answer.sources, confidence: answer.confidence ?? 0.9})}\n\n`);
  return res.end();
 }
 res.writeHead(200, {'Content-Type': 'application/json'});
 res.end(JSON.stringify({confidence: 0.9, ...answer}));
}).listen(PORT, '127.0.0.1', () => console.log(`Example agent listening on http://127.0.0.1:${PORT}/agent`));
