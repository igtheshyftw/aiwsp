// End-to-end check of the built server against docs/aiwsp/urgent-functions.md and the IMS workflow.
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes, createHmac} from 'node:crypto';

const directory = await mkdtemp(join(tmpdir(), 'ims-test-'));
const probe = createServer(); await new Promise(r => probe.listen(0, '127.0.0.1', r)); const port = probe.address().port; await new Promise(r => probe.close(r));
const base = 'http://localhost:' + port;
const adminPassword = 'Test-' + randomBytes(12).toString('hex');
let child;
async function start() {
 child = spawn(process.execPath, ['dist/server.mjs'], {env: {...process.env, PORT: String(port), PUBLIC_URL: base, DATA_DIR: directory, ADMIN_USERNAME: 'wsp-admin', ADMIN_PASSWORD: adminPassword, COMPANY_NAME: 'WSP', REQUIRE_ADMIN_MFA: 'true', CLAMAV_HOST: ''}, stdio: ['ignore', 'pipe', 'pipe']});
 await new Promise((resolve, reject) => {
  let logs = ''; const timer = setTimeout(() => reject(Error('Server startup timed out: ' + logs)), 15000);
  child.stderr.on('data', x => logs += x);
  child.stdout.on('data', x => { logs += x; if (logs.includes('listening on port')) { clearTimeout(timer); resolve(); } });
  child.once('exit', code => { clearTimeout(timer); reject(Error('Startup failed: ' + code + ' ' + logs)); });
 });
}
async function stop() { if (child && child.exitCode === null) { const stopped = new Promise(r => child.once('exit', r)); child.kill('SIGTERM'); await stopped; } }
function totp(secret) {
 const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0, value = 0; const bytes = [];
 for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
 const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
 const h = createHmac('sha1', Buffer.from(bytes)).update(buf).digest(); const o = h[19] & 15;
 return String((((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3]) % 1000000).padStart(6, '0');
}
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
// Sign in; administrators enrol an authenticator on first use and give its code afterwards.
const secrets = {};
async function signIn(s, username, password) {
 let r = await s('login', {username, password});
 if (r.needCode) r = await s('login', {username, password, code: totp(secrets[username])});
 if (r.mfa_required) {
  assert.equal(await s('efile.list', {}, {ok: false}), 'MFA_REQUIRED', 'Administrators must enrol an authenticator first');
  const {secret} = await s('mfa.setup'); secrets[username] = secret;
  await s('mfa.enable', {code: '000000'}, {ok: false});
  r = await s('mfa.enable', {code: totp(secret)});
 }
 return r;
}
async function upload(s, item, name, body) {
 const r = await fetch(`${base}/api/upload?item=${item}`, {method: 'POST', headers: {origin: base, cookie: s.cookie(), 'x-filename': encodeURIComponent(name)}, body});
 return {status: r.status, ...(await r.json())};
}

try {
 await start();
 assert.equal((await fetch(base + '/healthz')).status, 200);

 // ---- Companies account
 const sys = session();
 await sys('login', {username: 'wsp-admin', password: 'wrong'}, {ok: false});
 await sys('login', {username: 'wsp-admin', password: adminPassword}, {ok: false, origin: 'http://evil.example'});
 const sysMe = await signIn(sys, 'wsp-admin', adminPassword);
 assert.equal(sysMe.position, 'system');
 assert.equal((await sys('login', {username: 'wsp-admin', password: adminPassword})).needCode, true, 'Administrators sign in with a code once enrolled');
 await signIn(sys, 'wsp-admin', adminPassword);
 const lsk = (await sys('company.save', {name_cn: 'LSK 仲诚投资管理有限公司', name_en: 'LSK & Partners Limited', address: 'Shanghai', contact: 'Michael', email: 'office@lsk.example', phone: '021-0000'})).id;
 const pw = 'Passw0rd-' + randomBytes(4).toString('hex');
 // With no Chief Admin yet, the System Admin manages the company's users.
 const michael = (await sys('user.save', {companyId: lsk, username: 'Michael', name_cn: '梁启达', name_en: 'Michael Leong', password: pw, level: 1})).id;
 await sys('company.chief', {id: lsk, userId: michael});
 // A second, named System Admin (no shared login).
 await sys('user.save', {username: 'wsp-ops', name_en: 'WSP Ops', password: pw, level: 1, position: 'system'});
 const mi = session(); const miMe = await signIn(mi, 'Michael', pw);
 assert.equal(miMe.position, 'chief');
 // Chief Admin decides whether System Admins manage the company's users.
 await mi('company.save', {id: lsk, name_cn: 'LSK 仲诚投资管理有限公司', name_en: 'LSK & Partners Limited', sys_manage_users: false, sys_manage_connections: false});
 await sys('user.list', {companyId: lsk}, {ok: false});
 await mi('company.save', {id: lsk, name_cn: 'LSK 仲诚投资管理有限公司', name_en: 'LSK & Partners Limited', sys_manage_users: true, sys_manage_connections: false});
 assert.equal((await sys('user.list', {companyId: lsk})).users.length, 1);
 await mi('company.save', {id: lsk, name_cn: 'LSK 仲诚投资管理有限公司', name_en: 'LSK & Partners Limited', sys_manage_users: false, sys_manage_connections: false});

 // ---- Users: QR registration works at once with the default Level 3; the managers are notified.
 await mi('invite.create', {companyId: lsk, days: 7});
 const [invite] = await mi('invite.list', {companyId: lsk});
 assert(invite.qr.startsWith('data:image/png'));
 const token = new URL(invite.url.replace('#/', '')).searchParams.get('token');
 const anon = session();
 assert.equal((await anon('register.info', {token})).company, 'LSK & Partners Limited');
 await anon('register', {token, username: 'Michelle', password: pw, confirm: pw + 'x', mobile: '13800000001'}, {ok: false});
 await anon('register', {token, username: 'michael', password: pw, confirm: pw, mobile: '13800000001'}, {ok: false}); // globally unique, any case
 const michelleMe = await anon('register', {token, username: 'Michelle', name_cn: '袁宝而', name_en: 'Michelle', password: pw, confirm: pw, mobile: '13800000001'});
 assert.equal(michelleMe.level, 3);
 const michelle = michelleMe.id; const ch = anon;
 assert((await mi('notifications')).some(n => n.kind === 'registration'));
 await mi('invite.revoke', {id: invite.id});
 await session()('register.info', {token}, {ok: false});

 const users = await mi('user.form', {companyId: lsk});
 assert.deepEqual(users.levels.map(l => l.level), [1, 2, 3, 4]);
 const william = (await mi('user.save', {companyId: lsk, username: 'William', name_en: 'William', password: pw, level: 2, position: 'useradmin'})).id;
 const john = (await mi('user.save', {companyId: lsk, username: 'john', name_en: 'John', password: pw, level: 3})).id;
 // Temporary accounts need an expiry date and a responsible administrator.
 await mi('user.save', {companyId: lsk, username: 'temp1', password: pw, level: 4}, {ok: false});
 const temp = (await mi('user.save', {companyId: lsk, username: 'temp1', password: pw, level: 4, expires: '2099-01-01', responsible_id: william})).id;
 // A User Admin cannot grant beyond their own authority or change the Chief Admin.
 const wi = session(); await signIn(wi, 'William', pw);
 await wi('user.save', {id: john, username: 'john', level: 1}, {ok: false});
 await wi('user.save', {id: john, username: 'john', level: 3, perms: {client: true}}, {ok: false});
 await wi('user.save', {id: michael, username: 'Michael', level: 1}, {ok: false});
 await wi('user.save', {id: john, username: 'john', level: 3, position: 'useradmin'}, {ok: false});
 await wi('user.save', {id: john, username: 'john', name_en: 'John', level: 3, perms: {export: true}}); // William holds export at Level 2
 // Password reset is a one-time link; stored passwords are never shown.
 const {link} = await wi('user.reset', {id: john});
 const resetToken = new URL(link.replace('#/', '')).searchParams.get('token');
 const newPw = 'New-' + pw;
 await session()('reset.complete', {token: resetToken, password: newPw, confirm: newPw});
 await session()('reset.complete', {token: resetToken, password: newPw, confirm: newPw}, {ok: false});
 const jo = session(); await signIn(jo, 'john', newPw);

 // ---- eFiles: access comes only from membership; System Admins do not inherit it.
 const claim = (await ch('efile.save', {name: 'Expense Claim Demo - A', participants: [{id: michelle, rights: 'edit'}, {id: john, rights: 'view'}], admins: [michael], approval: false, currency: 'CNY'})).id;
 await ch('efile.save', {name: 'No admin', participants: [michelle], admins: []}, {ok: false}); // Level 3 cannot be an eFile Admin itself
 assert.equal((await sys('efile.list', {view: 'explorer'})).length, 0, 'System Admin sees no client eFiles');
 await sys('item.list', {efileId: claim}, {ok: false});
 await mi('efile.steps.save', {id: claim, approval: true, steps: [{title: 'Manager check', users: [william]}, {title: 'Chief approval', users: [michael]}]});
 await mi('efile.steps.save', {id: claim, steps: [{title: 'Temp', users: [temp]}]}, {ok: false}); // Level 4 cannot approve
 assert.equal((await mi('efile.get', {id: claim})).approval, 1);

 // ---- Items: blank amount stays blank; zero is an entered zero; unique IDs; columns hide when empty.
 const blank = (await ch('item.save', {efileId: claim, name: 'Blank amount'})).id;
 let list = await ch('item.list', {efileId: claim, filter: 'all'});
 assert.equal(list.items[0].amount, ''); assert.equal(list.columns.amount, false); assert.equal(list.columns.date, false);
 const zero = (await ch('item.save', {efileId: claim, name: 'Zero amount', amount: '0'})).id;
 list = await ch('item.list', {efileId: claim, filter: 'all'});
 assert.equal(list.items.find(i => i.id === zero).amount, '0.00'); assert.equal(list.columns.amount, true);
 assert.notEqual(list.items[0].seq, list.items[1].seq);
 // Default order: dated items newest first, then undated by name.
 await ch('item.save', {efileId: claim, name: 'Older', item_date: '2023-01-01', amount: '5'});
 await ch('item.save', {efileId: claim, name: 'Newer', item_date: '2023-09-01', amount: '6'});
 list = await ch('item.list', {efileId: claim, filter: 'all'});
 assert.deepEqual(list.items.map(i => i.name), ['Newer', 'Older', 'Blank amount', 'Zero amount']);
 // Viewers cannot create items; simultaneous edits are detected.
 await jo('item.save', {efileId: claim, name: 'Not allowed'}, {ok: false});
 const v = list.items.find(i => i.id === zero).version;
 await ch('item.save', {id: zero, version: v, name: 'Zero amount', amount: '0'});
 await ch('item.save', {id: zero, version: v, name: 'Stale edit', amount: '1'}, {ok: false});

 // ---- Approval: step by step, locks, return with reason restarts at step 1, versions kept.
 const claimItem = (await ch('item.save', {efileId: claim, name: 'Entertainment', amount: '200', item_date: '2023-09-02'})).id;
 let it = (await ch('item.get', {id: claimItem})).item;
 await ch('item.submit', {id: claimItem, version: it.version});
 it = (await ch('item.get', {id: claimItem})).item;
 assert.equal(it.status, 'pending'); assert.equal(it.step.position, 1);
 await ch('item.save', {id: claimItem, version: it.version, name: 'Changed'}, {ok: false}); // locked while pending
 assert.equal((await upload(ch, claimItem, 'late.pdf', '%PDF-1.4 x')).status, 400); // attachments locked too
 await mi('item.decide', {id: claimItem, decision: 'approve'}, {ok: false}); // not the active step
 assert.equal((await wi('todo.confirm')).length, 1);
 await wi('item.decide', {id: claimItem, decision: 'approve', version: it.version});
 await wi('item.decide', {id: claimItem, decision: 'approve'}, {ok: false}); // no duplicate decisions
 await mi('item.decide', {id: claimItem, decision: 'return'}, {ok: false}); // a reason is required
 await mi('item.decide', {id: claimItem, decision: 'return', note: 'Attach the receipt'});
 it = (await ch('item.get', {id: claimItem})).item; assert.equal(it.status, 'returned');
 assert.equal((await upload(ch, claimItem, 'setup.exe', 'MZ\x90\x00')).status, 400, 'Executables are blocked');
 assert.equal((await upload(ch, claimItem, 'receipt.pdf', 'MZ fake pdf')).status, 400, 'Content must match the type');
 assert.equal((await upload(ch, claimItem, 'macro.xlsm', 'PK')).status, 400, 'Macro files are blocked');
 assert.equal((await upload(ch, claimItem, 'receipt.pdf', '%PDF-1.4 receipt')).status, 200);
 it = (await ch('item.get', {id: claimItem})).item;
 await ch('item.save', {id: claimItem, version: it.version, name: 'Entertainment', amount: '250', item_date: '2023-09-02', submit: true});
 let detail = await ch('item.get', {id: claimItem});
 assert.equal(detail.item.round, 2); assert.equal(detail.item.step.position, 1, 'Correction restarts approval from step 1');
 assert.equal(detail.versions.length, 2); assert.equal(detail.versions[1].snapshot.amount, 20000);
 assert(detail.rounds.some(s => s.round === 1 && s.decision === 'return'), 'Earlier decisions are preserved');
 await wi('item.decide', {id: claimItem, decision: 'approve'});
 await mi('item.decide', {id: claimItem, decision: 'approve'});
 detail = await ch('item.get', {id: claimItem});
 assert.equal(detail.item.status, 'approved');
 assert((await ch('notifications')).some(n => n.title.startsWith('Approval complete')));
 await ch('item.delete', {id: claimItem}, {ok: false}); // approval history is never deleted
 await ch('item.archive', {id: claimItem});
 // Attachments: download needs the download function and access; views and downloads are logged.
 const att = detail.attachments[0];
 assert.equal(await (await fetch(`${base}/api/file?id=${att.id}`, {headers: {cookie: ch.cookie()}})).text(), '%PDF-1.4 receipt');
 assert.equal((await fetch(`${base}/api/file?id=${att.id}`, {headers: {cookie: sys.cookie()}})).status, 404);

 // Self-approval is blocked: an editor of the item cannot approve it.
 const selfItem = (await wi('item.save', {efileId: claim, name: 'William edits'}, {ok: false})); void selfItem; // William is not a member yet
 await mi('efile.save', {id: claim, version: (await mi('efile.get', {id: claim})).version, name: 'Expense Claim Demo - A', participants: [{id: michelle, rights: 'edit'}, {id: john, rights: 'view'}, {id: william, rights: 'edit'}], admins: [michael], approval: true, currency: 'CNY'});
 const own = (await wi('item.save', {efileId: claim, name: 'William edits', amount: '1', submit: true})).id;
 await wi('item.decide', {id: own, decision: 'approve'}, {ok: false});
 // With no eligible approver the step pauses until an administrator assigns one; steps are never skipped.
 detail = await mi('item.get', {id: own}); assert.equal(detail.item.step.paused, true);
 assert.equal((await mi('todo.paused')).length, 1);
 await mi('item.reassign', {id: own, to: william}, {ok: false});
 await mi('item.reassign', {id: own, to: michael});
 await mi('item.decide', {id: own, decision: 'reject'}, {ok: false});
 await mi('item.decide', {id: own, decision: 'reject', note: 'Duplicate'});
 assert.equal((await mi('item.get', {id: own})).item.status, 'rejected');
 // Withdraw needs a reason; System Admin override is recorded separately (the System Admin needs no eFile access for it).
 const w = (await ch('item.save', {efileId: claim, name: 'Withdraw me', submit: true})).id;
 await ch('item.withdraw', {id: w}, {ok: false});
 await ch('item.withdraw', {id: w, note: 'Wrong month'});
 assert.equal((await ch('item.get', {id: w})).item.status, 'withdrawn');
 await ch('item.submit', {id: w});
 await mi('item.override', {id: w, mode: 'approve', note: 'x'}, {ok: false});
 await sys('item.override', {id: w, mode: 'approve'}, {ok: false});
 await sys('item.override', {id: w, mode: 'approve', note: 'Year-end closing'});
 detail = await ch('item.get', {id: w});
 assert.equal(detail.item.status, 'approved'); assert(detail.events.some(e => e.override === 1 && e.note === 'Year-end closing'));
 assert(detail.rounds.some(s => s.decision === 'override'));
 // Departing staff: sessions end at once and their pending approvals move to a replacement.
 const pend = (await ch('item.save', {efileId: claim, name: 'Pending at William', submit: true})).id;
 const rep = (await mi('user.save', {companyId: lsk, username: 'Wendy', name_en: 'Wendy', password: pw, level: 2})).id;
 await mi('user.transfer', {id: william, kind: 'replace', to: temp}, {ok: false}); // Level 4 cannot take over approvals
 await mi('user.transfer', {id: william, kind: 'replace', to: rep});
 await wi('efile.list', {}, {ok: false});
 detail = await mi('item.get', {id: pend});
 assert(detail.rounds[0].approvers.some(a => a.id === rep));

 // ---- Connections: both companies confirm; only designated staff are visible; finding a contact grants no eFile.
 const other = (await sys('company.save', {name_cn: '客户乙', name_en: 'Client B'})).id;
 const bob = (await sys('user.save', {companyId: other, username: 'Bob', name_en: 'Bob', password: pw, level: 3})).id;
 await mi('efile.save', {id: claim, version: (await mi('efile.get', {id: claim})).version, name: 'Expense Claim Demo - A', participants: [{id: michelle, rights: 'edit'}, {id: bob, rights: 'view'}], admins: [michael], approval: true}, {ok: false});
 const conn = (await mi('connection.request', {companyId: lsk, to: other, users: [michael]})).id;
 await mi('connection.update', {id: conn, companyId: lsk, status: 'connected'}, {ok: false}); // only the receiving company accepts
 await sys('connection.update', {id: conn, companyId: other, status: 'connected', users: [bob]});
 assert((await mi('directory')).users.some(u => u.id === bob && u.external));
 assert(!(await jo('directory')).users.some(u => u.id === bob), 'Staff not designated for the connection do not see the contact');
 const bo = session(); await signIn(bo, 'Bob', pw);
 assert.equal((await bo('efile.list', {view: 'explorer'})).length, 0);
 await mi('efile.save', {id: claim, version: (await mi('efile.get', {id: claim})).version, name: 'Expense Claim Demo - A', participants: [{id: michelle, rights: 'edit'}, {id: john, rights: 'view'}, {id: bob, rights: 'view'}], admins: [michael], approval: true});
 assert.equal((await bo('efile.list', {view: 'explorer'})).length, 1, 'Sharing one eFile exposes only that eFile');

 // ---- IMS process: the executor commits approved items; Auto Commit moves them on by itself.
 const payment = (await mi('efile.save', {name: 'Payment eFile', participants: [michael], admins: [michael], approval: false})).id;
 await mi('process.save', {efileId: claim, name: 'Claims', stages: [{efile_id: claim, executor_id: michael, auto_commit: true}, {efile_id: payment, executor_id: michael}]});
 const flow = (await ch('item.save', {efileId: claim, name: 'Taxi', amount: '88.50', item_date: '2023-09-03', submit: true})).id;
 await session()('login', {username: 'Wendy', password: pw}); const we = session(); await signIn(we, 'Wendy', pw);
 await we('item.decide', {id: flow, decision: 'approve'});
 await mi('item.decide', {id: flow, decision: 'approve'});
 const pay = await mi('item.list', {efileId: payment, filter: 'process'});
 assert.equal(pay.items.length, 1); assert.equal(pay.items[0].status, 'none'); assert.equal(pay.items[0].can_commit, true);
 await mi('process.commit', {id: pay.items[0].id});
 assert.deepEqual((await mi('efile.monitor', {id: claim})).stages.map(s => s.items), [0, 0]);

 // ---- System log records user/permission changes, approvals, overrides, downloads and logins.
 const logs = await mi('log.list', {companyId: lsk});
 for (const f of ['新增用户', '二维码注册', '审批', '管理员覆盖', '下载附件', '用户移交']) assert(logs.some(l => l.content.includes(f) || l.function === f), `log has ${f}`);
 await jo('log.list', {companyId: lsk}, {ok: false});

 // Restart keeps data; logout ends the session.
 await stop(); await start();
 assert.equal((await mi('efile.list', {view: 'explorer'})).length, 2);
 await mi('logout'); await mi('efile.list', {}, {ok: false});
 console.log('PASS: IMS + AiWSP rules — admin MFA, named System Admins, Chief Admin delegation, QR registration, levels and grant limits, temporary accounts, reset links, membership-only eFile access, blank vs zero amounts, ordering, edit conflicts, approval (lock, return/restart, versions, reject, withdraw, pause/reassign, no self-approval, override), attachment safety, departing staff hand-over, connections, processes, system log, restart and logout.');
} finally {
 await stop();
 await rm(directory, {recursive: true, force: true});
}
