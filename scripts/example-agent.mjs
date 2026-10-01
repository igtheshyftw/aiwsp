// A stand-in agent that shows the AGENT_URL contract (docs/aiwsp/assistant.md). It is NOT the real agent:
// it matches questions against a small FAQ and streams the answer. Replace it with your own service.
//   node scripts/example-agent.mjs            (listens on http://127.0.0.1:3100/agent)
//   AGENT_URL=http://127.0.0.1:3100/agent npm start
import {createServer} from 'node:http';
import {exampleAnswer} from './example-agent-logic.mjs';

const PORT = Number(process.env.EXAMPLE_AGENT_PORT || 3100);
const TOKEN = process.env.AGENT_TOKEN || '';
createServer(async (req, res) => {
 if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
 if (TOKEN && req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); return res.end(); }
 let body = ''; for await (const chunk of req) body += chunk;
 const request = JSON.parse(body); const {question, client, messages} = request;
 const answer = exampleAnswer(request);
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
