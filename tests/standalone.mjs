// End-to-end check of the built server: accounts, eFiles, confirmations, links, processes, attachments, log.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'ims-test-'));
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
const base = 'http://localhost:' + port;
const adminPassword = 'Test-' + randomBytes(12).toString('hex');
let child;
async function start() {
 child = spawn(process.execPath, ['dist/server.mjs'], {env: {...process.env, PORT: String(port), PUBLIC_URL: base, DATA_DIR: directory, ADMIN_USERNAME: 'Michael', ADMIN_PASSWORD: adminPassword, COMPANY_NAME: 'LSK & Partners Limited', COMPANY_NAME_CN: 'LSK 仲诚投资管理有限公司'}, stdio: ['ignore', 'pipe', 'pipe']});
 await new Promise((resolve, reject) => {
  let logs = ''; const timer = setTimeout(() => reject(Error('Server startup timed out: ' + logs)), 15000);
  child.stderr.on('data', x => logs += x);
  child.stdout.on('data', x => { logs += x; if (logs.includes('listening on port')) { clearTimeout(timer); resolve(); } });
  child.once('exit', code => { clearTimeout(timer); reject(Error('Startup failed: ' + code + ' ' + logs)); });
 });
}
async function stop() { if (child && child.exitCode === null) { const stopped = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await stopped; } }

function session() {
 let cookie = '';
 const call = async (action, body = {}, {ok = true, origin = base} = {}) => {
  const r = await fetch(base + '/api/ims', {method: 'POST', headers: {origin, 'content-type': 'application/json', cookie}, body: JSON.stringify({action, ...body})});
  const set = r.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
  const j = await r.json();
  if (ok) assert.equal(r.status, 200, `${action}: ${j.error}`); else assert.notEqual(r.status, 200, `${action} should fail`);
  return ok ? j.result : j.error;
 };
 call.cookie = () => cookie;
 return call;
}

try {
 await start();
 assert.equal((await fetch(base + '/healthz')).status, 200);
 assert((await (await fetch(base)).text()).includes('id="root"'));

 const admin = session();
 assert.equal(await admin('me'), null);
 await admin('login', {username: 'Michael', password: 'wrong-password'}, {ok: false});
 await admin('login', {username: 'Michael', password: adminPassword}, {ok: false, origin: 'http://evil.example'});
 const me = await admin('login', {username: 'Michael', password: adminPassword});
 assert.equal(me.sys, true);
 assert.deepEqual(me.perms.sort(), ['client', 'company', 'efile', 'group', 'log', 'role', 'user']);

 // Accounts
 const companies = await admin('company.list'); assert.equal(companies.length, 1); assert.equal(companies[0].name_cn, 'LSK 仲诚投资管理有限公司');
 await admin('company.save', {id: companies[0].id, name_cn: companies[0].name_cn, name_en: 'LSK & Partners Limited', type: 'Communicative', code: 'L002SH', city: 'Shanghai'});
 const roles = await admin('role.list'); assert.deepEqual(roles.map(r => r.name).sort(), ['A/C Administrator', 'Standard users']);
 const standard = roles.find(r => r.name === 'Standard users');
 const pw = 'Passw0rd-' + randomBytes(4).toString('hex');
 const michelle = (await admin('user.save', {username: 'Michelle', name_cn: '袁宝而', name_en: 'Michelle', sex: 'F', dept: 'LSK Management', password: pw, roleIds: [standard.id]})).id;
 const william = (await admin('user.save', {username: 'William', name_cn: '梁广鑫', name_en: 'William', sex: 'M', dept: 'LSK Management,Management', password: pw, roleIds: [standard.id], level: 'Administrator'})).id;
 await admin('user.save', {username: 'michelle', password: pw}, {ok: false}); // names are unique regardless of case
 const users = (await admin('user.list')).users;
 assert.equal(users.length, 3);
 assert.equal(users.find(u => u.username === 'William').role_label, 'Standard users,Standard - Administrator');
 const group = (await admin('group.save', {name: 'Management Team', members: [michelle, william]})).id;
 assert.equal((await admin('group.users', {id: group})).users.length, 2);
 await admin('client.save', {code: 'C001', name_cn: '客户一', name_en: 'Client One'});
 assert.equal((await admin('client.list')).length, 1);

 // Standard users cannot open the Account menu
 const mi = session(); await mi('login', {username: 'Michelle', password: pw});
 assert.deepEqual((await mi('me')).perms.sort(), ['client', 'efile']);
 await mi('user.list', {}, {ok: false});
 await mi('log.list', {}, {ok: false});

 // eFiles: an expense claim, its payable ledger, and a payment process
 const claim = (await admin('efile.save', {name: 'Expense Claim Demo - A', color: 'Personalised 3', participants: [michelle, william], admins: [], groups: []})).id;
 const payable = (await admin('efile.save', {name: 'Payable to A', color: 'Blue', participants: [michelle], admins: []})).id;
 const payment = (await admin('efile.save', {name: 'Payment eFile', color: 'Green', participants: [william], admins: []})).id;
 const banking = (await admin('efile.save', {name: 'WL Banking Approval', participants: [william], admins: []})).id;
 await admin('efile.steps.save', {id: claim, steps: [{title: 'Michelle submission', users: [michelle]}, {title: "Michael's checking", users: [me.id]}, {title: "Manager's approval", users: [william]}]});
 await admin('efile.balance.save', {id: payable, balance: '0', balance_alias: 'Amount Payable to A', notional: '0', notional_alias: 'Notional Amount Payable to A'});
 await admin('process.save', {efileId: claim, name: 'Expense Claim Demo - A', stages: [
  {efile_id: claim, executor_id: me.id, auto_commit: true},
  {efile_id: payment, executor_id: william},
  {efile_id: banking, executor_id: william, confirm_balance: true},
 ]});
 const myList = await admin('efile.list', {view: 'my'});
 assert.equal(myList.length, 4); assert.equal(myList.find(e => e.id === claim).in_process, 1);
 assert.equal((await mi('efile.list', {view: 'my'})).length, 2, 'Michelle sees only eFiles she takes part in');

 // Item with confirmations and an auto link that flips the sign into the payable ledger
 const entertainment = (await mi('item.save', {efileId: claim, name: 'Entertainment', amount: '200', item_date: '2023-09-01', steps: [1, 2, 3],
  links: [{kind: 'auto_link', efile_id: payable, change_sign: true}]})).id;
 let payableItems = await admin('item.list', {efileId: payable, filter: 'all'});
 assert.equal(payableItems.items.length, 1); assert.equal(payableItems.items[0].amount, '-200.00');
 assert.equal(payableItems.balances[0].name, 'Amount Payable to A'); assert.equal(payableItems.balances[0].amount, '-200.00');
 await mi('item.save', {id: entertainment, name: 'Entertainment', amount: '250', item_date: '2023-09-01', steps: [1, 2, 3], links: (await mi('item.get', {id: entertainment})).item && (await mi('item.get', {id: entertainment})).links.map(l => ({id: l.id, kind: l.kind, efile_id: l.target_efile_id, change_sign: l.change_sign}))});
 payableItems = await admin('item.list', {efileId: payable, filter: 'all'});
 assert.equal(payableItems.items[0].amount, '-250.00', 'Linked item follows the source');

 // Confirmations are sequential: Michael cannot sign step 2 before Michelle signs step 1
 await admin('item.confirm', {id: entertainment}, {ok: false});
 assert.equal((await mi('todo.confirm')).length, 1);
 await mi('item.confirm', {id: entertainment});
 assert.equal((await admin('todo.confirm')).length, 1);
 await admin('item.confirm', {id: entertainment});
 const wi = session(); await wi('login', {username: 'William', password: pw});
 // A company administrator cannot take over the system administrator's account
 await admin('user.save', {id: william, username: 'William', name_cn: '梁广鑫', name_en: 'William', sex: 'M', dept: 'LSK Management,Management', level: 'Administrator', roleIds: [roles.find(r => r.name === 'A/C Administrator').id]});
 await wi('user.reset', {id: me.id, password: 'taken-over-123'}, {ok: false});
 await wi('user.state', {id: me.id}, {ok: false});
 let monitor = await admin('efile.monitor', {id: claim});
 assert.deepEqual(monitor.stages.map(s => s.items), [1, 0, 0]);
 await wi('item.confirm', {id: entertainment}); // last step signed → Auto Commit moves it to Payment eFile
 monitor = await admin('efile.monitor', {id: claim});
 assert.deepEqual(monitor.stages.map(s => s.items), [0, 1, 0]);
 const paymentItems = await wi('item.list', {efileId: payment, filter: 'process'});
 assert.equal(paymentItems.items.length, 1); assert.equal(paymentItems.items[0].can_commit, true);
 assert.equal((await wi('todo.executor')).find(e => e.id === payment).waiting, 1);
 await admin('process.commit', {id: paymentItems.items[0].id}, {ok: false}); // only the executor commits
 await wi('process.commit', {id: paymentItems.items[0].id});
 const bankItems = await wi('item.list', {efileId: banking, filter: 'process'});
 await wi('process.commit', {id: bankItems.items[0].id});
 monitor = await admin('efile.monitor', {id: claim});
 assert.deepEqual(monitor.stages.map(s => s.items), [0, 0, 0]);
 assert.equal((await admin('item.list', {efileId: claim, filter: 'completed'})).items.length, 1);

 // Split links must add up; bulk eFile actions; password protection
 await mi('item.save', {efileId: claim, name: 'Travel', amount: '100', links: [{kind: 'split_link', efile_id: payable, split_amount: '60'}]}, {ok: false});
 await admin('efile.bulk', {op: 'password', ids: [payable], password: 'ledger-secret'});
 assert.equal(await admin('item.list', {efileId: payable}, {ok: false}), 'PASSWORD_REQUIRED');
 assert.equal((await admin('item.list', {efileId: payable, filter: 'all', password: 'ledger-secret'})).items.length, 1);
 await admin('efile.bulk', {op: 'mtt', ids: [payment]});
 assert.equal((await admin('efile.list', {view: 'my'}))[0].id, payment, 'MTT moves the eFile to the top');
 await admin('efile.bulk', {op: 'hide', ids: [banking]});
 assert.equal((await admin('efile.list', {view: 'hidden'})).length, 1);

 // Attachments
 const up = await fetch(`${base}/api/upload?item=${entertainment}`, {method: 'POST', headers: {origin: base, cookie: mi.cookie(), 'x-filename': encodeURIComponent('receipt.txt')}, body: 'receipt'});
 assert.equal(up.status, 200);
 const att = (await mi('item.get', {id: entertainment})).attachments[0];
 assert.equal(await (await fetch(`${base}/api/file?id=${att.id}`, {headers: {cookie: mi.cookie()}})).text(), 'receipt');
 assert.equal((await fetch(`${base}/api/file?id=${att.id}`)).status, 401);

 // System log records logins, views and changes
 const log = await admin('log.list', {});
 assert(log.some(l => l.content === '用户登录:Michael'));
 assert(log.some(l => l.content.startsWith('访问eFile:')));
 assert(log.some(l => l.content.startsWith('新增eFile:Expense Claim Demo - A')));

 // Deactivated users are signed out; restart keeps data; logout ends the session
 await admin('user.state', {id: michelle});
 await mi('efile.list', {}, {ok: false});
 await stop(); await start();
 assert.equal((await admin('efile.list', {view: 'explorer'})).length, 4);
 await admin('logout');
 await admin('efile.list', {}, {ok: false});
 console.log('PASS: IMS server — accounts, roles, eFiles, sequential confirmations, auto links with change sign, processes with auto commit and executors, split validation, passwords, bulk actions, attachments, system log, deactivation, restart persistence and logout.');
} finally {
 await stop();
 await rm(directory, {recursive: true, force: true});
}
