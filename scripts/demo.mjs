// Starts the built server with sample data (npm run demo). Data lives in ./demo-data; delete that folder to start over.
// The demo turns off the administrator authenticator requirement so you can look around; real installations keep it on.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {seedDemo} from './demo-seed.mjs';

const port = Number(process.env.PORT || 3000), base = `http://localhost:${port}`;
const password = 'demo-password';
const fresh = !existsSync('demo-data');
// The stand-in agent (scripts/example-agent.mjs) answers a few FAQ questions so the AiWSP Assistant can be tried.
const agentPort = port + 100;
const agent = spawn(process.execPath, ['scripts/example-agent.mjs'], {stdio: 'ignore', env: {...process.env, EXAMPLE_AGENT_PORT: String(agentPort)}});
const child = spawn(process.execPath, ['dist/server.mjs'], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, PORT: String(port), PUBLIC_URL: base, DATA_DIR: 'demo-data',
 ADMIN_USERNAME: 'wsp-admin', ADMIN_PASSWORD: password, ADMIN_NAME: 'WSP System Admin', COMPANY_NAME: 'WSP', REQUIRE_ADMIN_MFA: 'false', AGENT_URL: process.env.AGENT_URL || `http://127.0.0.1:${agentPort}/agent`}});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { agent.kill(); child.kill('SIGTERM'); });
child.on('exit', code => { agent.kill(); process.exit(code ?? 0); });
await new Promise(r => child.stdout.on('data', d => { process.stdout.write(d); if (String(d).includes('listening')) r(); }));

function session() {
 let cookie = '';
 return async (action, body = {}) => {
  const r = await fetch(base + '/api/ims', {method: 'POST', headers: {origin: base, 'content-type': 'application/json', cookie}, body: JSON.stringify({action, ...body})});
  const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0];
  const j = await r.json(); if (j.error) throw Error(`${action}: ${j.error}`); return j.result;
 };
}
if (fresh) {
 await seedDemo(session, password);
 console.log('Sample data created.');
}
console.log(`\nOpen ${base} and sign in with the password "${password}" as:
  Michael    Chief Admin of LSK (approves step 1)
  William    User Admin (approves step 2)
  Michelle   staff, Level 3 (submits claims)
  john       staff, Level 3
  wsp-staff  WSP professional on LSK's service team (client page, Client Conversations inbox)
  wsp-admin  WSP System Admin (sees companies, not LSK's eFiles; assistant settings)
Press Ctrl+C to stop.`);
