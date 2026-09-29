// Starts the built server with sample data resembling the original IMS (npm run demo).
// Data lives in ./demo-data, separate from real data. Delete that folder to start over.
import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';

const port = Number(process.env.PORT || 3000), base = `http://localhost:${port}`;
const password = 'demo-password';
const fresh = !existsSync('demo-data');
const child = spawn(process.execPath, ['dist/server.mjs'], {stdio: ['ignore', 'pipe', 'inherit'], env: {...process.env, PORT: String(port), PUBLIC_URL: base, DATA_DIR: 'demo-data',
 ADMIN_USERNAME: 'Michael', ADMIN_PASSWORD: password, ADMIN_NAME: 'Michael Leong', COMPANY_NAME: 'LSK & Partners Limited', COMPANY_NAME_CN: 'LSK 仲诚投资管理有限公司', COMPANY_CODE: 'L002SH'}});
for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => child.kill('SIGTERM'));
child.on('exit', code => process.exit(code ?? 0));
await new Promise(r => child.stdout.on('data', d => { process.stdout.write(d); if (String(d).includes('listening')) r(); }));

if (fresh) {
 let cookie = '';
 const api = async (action, body = {}) => {
  const r = await fetch(base + '/api/ims', {method: 'POST', headers: {origin: base, 'content-type': 'application/json', cookie}, body: JSON.stringify({action, ...body})});
  const s = r.headers.get('set-cookie'); if (s) cookie = s.split(';')[0];
  const j = await r.json(); if (j.error) throw Error(`${action}: ${j.error}`); return j.result;
 };
 const me = await api('login', {username: 'Michael', password});
 const [co] = await api('company.list');
 await api('company.save', {...co, type: 'Communicative', code: 'L002SH'});
 const ac = (await api('role.list')).find(r => r.name === 'A/C Administrator').id;
 await api('user.save', {id: me.id, username: 'Michael', name_cn: '梁启达', name_en: 'Michael Leong', sex: 'M', dept: 'LSK Management,Management', level: 'Administrator', roleIds: [ac]});
 const add = async (username, name_cn, name_en, sex, dept, extra = {}) => (await api('user.save', {username, name_cn, name_en, sex, dept, password, roleIds: [], ...extra})).id;
 const john = await add('john', '梁申荣', 'John', 'M', 'LSK Management');
 const michelle = await add('Michelle', '袁宝而', 'Michelle', 'F', 'LSK Management');
 const william = await add('William', '梁广鑫', 'William', 'M', 'LSK Management,Management', {level: 'Administrator', roleIds: [ac]});
 const team = (await api('group.save', {name: 'Management Team', members: [me.id, william]})).id;
 const everyone = [me.id, john, michelle, william];
 const efile = async (name, color, extra = {}) => (await api('efile.save', {name, color, participants: everyone, admins: [me.id, william], ...extra})).id;
 await efile('DEMO', 'Blue', {highlight: true});
 await efile('Test', '', {highlight: true});
 const claim = await efile('Expense Claim Demo - A', 'Personalised 3', {groups: [team]});
 await efile('Expense Claim Demo - B', 'Teal');
 const payment = await efile('Payment eFile', 'Green');
 await efile('Project summative', 'Blue');
 await efile("Tasks that need intern's assistance", 'Teal');
 const stages = [await efile('Finance Manager Approval', ''), await efile('WL Approval', ''), await efile('Cashier Submission', ''), await efile('WL Banking Approval', '')];
 await api('efile.bulk', {op: 'my.remove', ids: stages});
 await api('efile.steps.save', {id: claim, steps: [{title: 'Michelle submission', users: [michelle]}, {title: "Michael's checking", users: [me.id]}, {title: "Manager's approval", users: [william]}, {title: "Cashier (Michael)'s submission of monthly expense claim", users: [me.id]}]});
 await api('efile.balance.save', {id: claim, balance: '0', balance_alias: 'Amount Payable to A', notional: '0', notional_alias: 'Notional Amount Payable to A'});
 await api('process.save', {efileId: claim, name: 'Expense Claim Demo - A', stages: [
  {efile_id: claim, executor_id: me.id, auto_commit: true}, {efile_id: payment, executor_id: me.id}, {efile_id: stages[0], executor_id: william},
  {efile_id: stages[1], executor_id: william}, {efile_id: stages[2], executor_id: me.id}, {efile_id: stages[3], executor_id: william, confirm_balance: true}]});
 await api('item.save', {efileId: claim, name: 'A monthly claim - August', amount: '-300', item_date: '2023-09-01', steps: []});
 await api('item.save', {efileId: claim, name: 'Entertainment', amount: '200', item_date: '2023-09-01', steps: [1, 2, 3, 4]});
 await api('item.save', {efileId: claim, name: 'Travel to Diacron office', amount: '100', item_date: '2023-09-01', steps: [1, 2, 3, 4]});
 await api('logout');
 console.log('Sample data created.');
}
console.log(`\nOpen ${base} and sign in as Michael, john, Michelle or William with the password "${password}". Press Ctrl+C to stop.`);
