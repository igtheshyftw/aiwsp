// Starts the built server with sample data (npm run demo). Data lives in ./demo-data; delete that folder to start over.
// The demo turns off the administrator authenticator requirement so you can look around; real installations keep it on.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';

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
 const sys = session(); await sys('login', {username: 'wsp-admin', password});
 const lsk = (await sys('company.save', {name_cn: 'LSK 仲诚投资管理有限公司', name_en: 'LSK & Partners Limited', type: 'Communicative', code: 'L002SH', city: 'Shanghai', contact: 'Michael Leong'})).id;
 const add = async (s, username, name_cn, name_en, sex, dept, extra = {}) => (await s('user.save', {companyId: lsk, username, name_cn, name_en, sex, dept, password, level: 3, ...extra})).id;
 const michael = await add(sys, 'Michael', '梁启达', 'Michael Leong', 'M', 'LSK Management,Management', {level: 1});
 await sys('company.chief', {id: lsk, userId: michael});
 // A WSP professional who handles LSK's assistant conversations (designated on the WSP–LSK connection).
 const wsp = (await sys('company.list')).find(c => c.operator).id;
 const staff = (await sys('user.save', {username: 'wsp-staff', name_en: 'WSP Professional', password, level: 2})).id;
 const link = (await sys('connection.request', {companyId: wsp, to: lsk, users: [staff]})).id;
 await sys('logout');
 const mi = session(); await mi('login', {username: 'Michael', password});
 const william = await add(mi, 'William', '梁广鑫', 'William', 'M', 'LSK Management,Management', {level: 2, position: 'useradmin'});
 const michelle = await add(mi, 'Michelle', '袁宝而', 'Michelle', 'F', 'LSK Management');
 const john = await add(mi, 'john', '梁申荣', 'John', 'M', 'LSK Management');
 await mi('user.save', {companyId: lsk, username: 'intern', name_en: 'Summer Intern', password, level: 4, expires: '2099-12-31', responsible_id: william});
 const team = (await mi('group.save', {companyId: lsk, name: 'Management Team', members: [michael, william]})).id;
 const everyone = [michael, william, michelle, john].map(id => ({id, rights: 'edit'}));
 const efile = async (name, color, extra = {}) => (await mi('efile.save', {name, color, participants: everyone, admins: [michael, william], ...extra})).id;
 await efile('DEMO', 'Blue', {highlight: true});
 await efile('Test', '', {highlight: true});
 const claim = await efile('Expense Claim Demo - A', 'Personalised 3', {groups: [{id: team, rights: 'edit'}]});
 await efile('Expense Claim Demo - B', 'Teal');
 const payment = await efile('Payment eFile', 'Green');
 await efile('Project summative', 'Blue', {show_amount: 0});
 await efile("Tasks that need intern's assistance", 'Teal', {show_amount: 0});
 const stages = [await efile('Finance Manager Approval', ''), await efile('WL Approval', ''), await efile('Cashier Submission', ''), await efile('WL Banking Approval', '')];
 await mi('efile.bulk', {op: 'my.remove', ids: stages});
 await mi('efile.steps.save', {id: claim, approval: true, steps: [{title: "Michael's checking", users: [michael]}, {title: "Manager's approval", users: [william]}]});
 await mi('efile.balance.save', {id: claim, balance: '0', balance_alias: 'Amount Payable to A', notional: '0', notional_alias: 'Notional Amount Payable to A'});
 await mi('process.save', {efileId: claim, name: 'Expense Claim Demo - A', stages: [
  {efile_id: claim, executor_id: michael, auto_commit: true}, {efile_id: payment, executor_id: michael}, {efile_id: stages[0], executor_id: william},
  {efile_id: stages[1], executor_id: william}, {efile_id: stages[2], executor_id: michael}, {efile_id: stages[3], executor_id: william, confirm_balance: true}]});
 await mi('invite.create', {companyId: lsk, days: 30});
 await mi('connection.update', {id: link, companyId: lsk, status: 'connected', users: [michael]});
 // WSP's client record for LSK: linked to LSK's account, served by wsp-staff, with a WSP eFile of work for the client.
 await sys('login', {username: 'wsp-admin', password});
 const lskClient = (await sys('client.save', {code: 'L002SH', name_cn: 'LSK 仲诚投资管理有限公司', name_en: 'LSK & Partners Limited', phone: '021-6888 0000',
  introducer: 'Michael Leong', business: 'Investment management', account_company_id: lsk, team_type: 'user', users: [staff]})).id;
 const sysId = (await sys('profile.get')).id;
 const filing = (await sys('efile.save', {name: 'LSK - Annual Filing 2026', client_id: lskClient, participants: [{id: staff, rights: 'edit'}], admins: [sysId]})).id;
 const day = n => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
 await sys('item.save', {efileId: filing, name: 'Collect bank statements', responsible_id: staff, target_date: day(-3)});
 await sys('item.save', {efileId: filing, name: 'Prepare draft return', responsible_id: staff, target_date: day(1)});
 await sys('item.save', {efileId: filing, name: 'Partner review', responsible_id: staff, target_date: day(14)});
 await sys('logout');
 await mi('logout');
 const me = session(); await me('login', {username: 'Michelle', password});
 await me('item.save', {efileId: claim, name: 'A monthly claim - August', amount: '-300', item_date: '2023-09-01'});
 await me('item.save', {efileId: claim, name: 'Entertainment', amount: '200', item_date: '2023-09-01', submit: true});
 await me('item.save', {efileId: claim, name: 'Travel to Diacron office', amount: '100', item_date: '2023-09-01', submit: true});
 await me('chat.start', {text: 'What documents do you need from us for this month?'});
 await me('chat.start', {text: 'When is our next filing deadline?'});
 await me('logout');
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
