// JSON API: POST /api/ims {action, ...params}; item attachments at /api/upload and /api/file.
import {connect} from 'node:net';
import QRCode from 'qrcode';
import {get, run, uid, now, tx} from './db';
import {attachments} from './storage';
import {UserError, check, checkOrigin, sessionUser, createSession, endSession, throttle, hashPassword, equal, validPassword, digest, live,
 totpSecret, totpValid, requireAdminMfa} from './auth';
import {context, text, required, log, userLabel, notify, userManagers, companyAdmin, managesUsers, managesConnections, viewsLog, allowed, type Ctx} from './ctx';
import {efile as openEfile, may} from './access';
import {accountActions} from './actions/account';
import {efileActions} from './actions/efile';
import {itemActions} from './actions/item';
import {chatActions} from './actions/chat';
import {clientActions} from './actions/client';
import {reportActions} from './actions/report';
import {searchActions} from './actions/search';
import {runDaily, jobState} from './jobs';
import {deliver, outboxStatus, channelsFor, wecomReady, emailReady, CHANNELS} from './outbox';

const actions: Record<string, (c: Ctx, b: any) => any> = {...accountActions, ...efileActions, ...itemActions, ...chatActions, ...clientActions, ...reportActions, ...searchActions,
 // Run today's reminders now (System Admin). They also run by themselves every morning; each reminder is sent once.
 'jobs.run'(c) { check(c.sys, 'Only a System Admin can run the scheduled jobs.'); return runDaily(); },
 'jobs.state'(c) { check(c.sys); return jobState(); },
 // Notifications by WeCom / email: each person chooses; System Admins see delivery status and can send what is waiting now.
 'notify.prefs'(c) { return {channel: c.user.notify_channel || 'auto', channels: CHANNELS, wecom: wecomReady(), email: emailReady(), wecom_id: !!c.user.wecom_userid, mobile: !!c.user.mobile, has_email: !!c.user.email, now: channelsFor(c.user)}; },
 'notify.prefs.save'(c, b) {
  check(CHANNELS.includes(b.channel), 'Choose how to receive notifications.');
  run('UPDATE user SET notify_channel=? WHERE id=?', b.channel, c.user.id); log(c, 'account', 'modify', `通知方式:${b.channel}`);
  return {now: channelsFor({...c.user, notify_channel: b.channel})};
 },
 'outbox.status'(c) { check(c.sys, 'Only a System Admin can see delivery status.'); return outboxStatus(); },
 async 'outbox.flush'(c) { check(c.sys, 'Only a System Admin can send waiting notifications.'); run(`UPDATE outbox SET next_at=? WHERE status='pending'`, now()); return deliver(); },
};

const json = (data: any, status = 200, headers: Record<string, string> = {}) =>
 Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...headers}});
const isAdmin = (u: any) => ['system', 'chief', 'useradmin'].includes(u.position);

function me(c: Ctx) {
 const company = get('SELECT * FROM company WHERE id=?', c.companyId)!;
 const menu = {
  company: c.sys || companyAdmin(c, c.companyId), user: c.sys || managesUsers(c, c.companyId), role: c.sys || companyAdmin(c, c.companyId),
  group: c.sys || managesUsers(c, c.companyId), connection: c.sys || managesConnections(c, c.companyId), log: viewsLog(c, c.companyId), client: allowed(c, 'client'),
 };
 return {id: c.user.id, username: c.user.username, name: userLabel(c.user), name_en: c.user.name_en || c.user.username, position: c.position, level: c.user.level,
  company: {id: company.id, name_cn: company.name_cn, name_en: company.name_en, operator: !!company.operator}, sys: c.sys, functions: [...c.perms],
  perms: Object.entries(menu).filter(([, v]) => v).map(([k]) => k), chat_staff: !!(chatActions['chat.config'](c, {}) as any).can_staff, mfa: !!c.user.totp_secret, mfa_required: requireAdminMfa() && isAdmin(c.user) && !c.user.totp_secret};
}

// Actions an administrator may use before enrolling an authenticator.
const BEFORE_MFA = new Set(['me', 'logout', 'mfa.setup', 'mfa.enable', 'profile.get', 'profile.password']);

export async function api(req: Request): Promise<Response> {
 try {
  checkOrigin(req);
  const b = JSON.parse(await req.text() || '{}');
  const action = text(b.action, 60);
  if (action === 'login') {
   await throttle(req, 'login');
   const u = get(`SELECT u.*, c.status AS company_status FROM user u JOIN company c ON c.id=u.company_id WHERE u.username=?`, text(b.username, 60));
   const ok = u && live(u, u.company_status) && equal(await hashPassword(String(b.password ?? ''), u.salt), u.pass);
   check(ok, 'Invalid user name or password.');
   if (u!.totp_secret) { if (!b.code) return json({result: {needCode: true}}); check(await totpValid(u!.totp_secret, b.code), 'The authenticator code is not correct.'); }
   const c = context(u!); log(c, 'login', 'modify', `用户登录:${u!.username}`);
   return json({result: me(c)}, 200, {'Set-Cookie': await createSession(u as {id: string, revision: number})});
  }
  if (action === 'logout') {
   const u = await sessionUser(req); if (u) log(context(u), 'login', 'modify', `用户注销:${u.username}`);
   return json({result: {}}, 200, {'Set-Cookie': await endSession(req)});
  }
  // Company registration QR code: anyone holding a valid code may register; the account works at once with the company's default level.
  if (action === 'register.info') {
   const inv = get(`SELECT i.*, c.name_cn, c.name_en FROM invite i JOIN company c ON c.id=i.company_id WHERE i.token=? AND i.active=1 AND c.status='normal'`, text(b.token, 100));
   check(inv && Date.parse(inv.expires) > Date.now(), 'This registration code has expired or was revoked.');
   return json({result: {company: inv!.name_en || inv!.name_cn, company_cn: inv!.name_cn}});
  }
  if (action === 'register') {
   await throttle(req, 'register');
   const inv = get(`SELECT i.*, c.name_cn FROM invite i JOIN company c ON c.id=i.company_id WHERE i.token=? AND i.active=1 AND c.status='normal'`, text(b.token, 100));
   check(inv && Date.parse(inv.expires) > Date.now(), 'This registration code has expired or was revoked.');
   const username = required(b.username, 'User name', 40);
   check(/^[A-Za-z0-9._-]{2,40}$/.test(username), 'User name may contain 2–40 letters, numbers, dots, hyphens or underscores.');
   check(!get('SELECT id FROM user WHERE username=?', username), 'This user name is already taken.');
   validPassword(b.password); check(b.password === b.confirm, 'The two passwords do not match.');
   const mobile = required(b.mobile, 'WeCom mobile number', 40); check(/^\+?[0-9 -]{6,20}$/.test(mobile), 'Enter a valid mobile number.');
   const id = uid(), salt = uid(), pass = await hashPassword(b.password, salt);
   tx(() => {
    run(`INSERT INTO user(id,company_id,username,name_cn,name_en,mobile,position,level,salt,pass,created_at) VALUES(?,?,?,?,?,?,'member',3,?,?,?)`, id, inv!.company_id, username, text(b.name_cn, 80), text(b.name_en, 80) || username, mobile, salt, pass, now());
    notify(userManagers(inv!.company_id), 'registration', `New user registered: ${username}. They can already use the system at Level 3; review their access when convenient.`);
    const u = get('SELECT * FROM user WHERE id=?', id)!;
    log(context(u), 'account', 'add', `二维码注册:${username}`);
   });
   return json({result: me(context(get('SELECT * FROM user WHERE id=?', id)!))}, 200, {'Set-Cookie': await createSession({id, revision: 0})});
  }
  if (action === 'reset.complete') {
   await throttle(req, 'reset');
   const u = get('SELECT * FROM user WHERE reset_hash=? AND reset_hash<>?', await digest(text(b.token, 100)), '');
   check(u && Date.parse(u.reset_expires) > Date.now() && live(u), 'This reset link has expired.');
   validPassword(b.password); check(b.password === b.confirm, 'The two passwords do not match.');
   if (u!.totp_secret) check(await totpValid(u!.totp_secret, b.code), 'Enter the current authenticator code.');
   const salt = uid(), pass = await hashPassword(b.password, salt);
   run(`UPDATE user SET salt=?,pass=?,reset_hash='',reset_expires='',revision=revision+1 WHERE id=?`, salt, pass, u!.id);
   log(context(u!), 'account', 'modify', `重置密码:${u!.username}`);
   return json({result: {}});
  }
  const u = await sessionUser(req);
  if (action === 'me') return json({result: u ? me(context(u)) : null});
  check(u, 'Please sign in again.');
  const c = context(u!);
  if (requireAdminMfa() && isAdmin(u) && !u!.totp_secret && !BEFORE_MFA.has(action)) return json({error: 'MFA_REQUIRED'}, 403);
  if (action === 'mfa.setup') {
   const secret = totpSecret(); run('UPDATE user SET totp_pending=? WHERE id=?', secret, u!.id);
   const url = `otpauth://totp/IMS:${encodeURIComponent(u!.username)}?secret=${secret}&issuer=IMS`;
   return json({result: {secret, qr: await QRCode.toDataURL(url, {margin: 1, width: 220})}});
  }
  if (action === 'mfa.enable') {
   check(u!.totp_pending && await totpValid(u!.totp_pending, b.code), 'The code does not match. Check your authenticator app and try again.');
   run(`UPDATE user SET totp_secret=totp_pending, totp_pending='' WHERE id=?`, u!.id); log(c, 'account', 'modify', `启用双重验证:${u!.username}`);
   return json({result: me(context(get('SELECT * FROM user WHERE id=?', u!.id)!))});
  }
  if (action === 'profile.password') {
   check(equal(await hashPassword(String(b.current ?? ''), u!.salt), u!.pass), 'Current password is incorrect.');
   validPassword(b.password); check(b.password === b.confirm, 'Passwords do not match.');
   const salt = uid(), pass = await hashPassword(b.password, salt);
   run('UPDATE user SET salt=?,pass=?,revision=revision+1 WHERE id=?', salt, pass, u!.id);
   log(c, 'account', 'modify', `修改密码:${u!.username}`);
   return json({result: {}}, 200, {'Set-Cookie': await createSession({id: u!.id, revision: u!.revision + 1})});
  }
  if (action === 'chat.start' || action === 'chat.send') await throttle(req, 'chat:' + u!.id);
  const fn = actions[action]; check(fn, 'Unknown action.');
  return json({result: await fn(c, b)});
 } catch (e: any) {
  if (e instanceof UserError) return json({error: e.message}, 400);
  if (e instanceof SyntaxError) return json({error: 'Invalid request.'}, 400);
  console.error('API error:', e?.message ?? e);
  return json({error: 'Unable to complete the request.'}, 500);
 }
}

// ---------------- Attachments: size/type limits, content checks and malware scanning; every download checks access again.
const MAX_BYTES = 10_000_000;
const TYPES: Record<string, string> = {pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp',
 txt: 'text/plain', csv: 'text/csv', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
 doc: 'application/msword', xls: 'application/vnd.ms-excel', heic: 'image/heic'};
const PREVIEW = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp']);
function inspect(name: string, bytes: Uint8Array) {
 const ext = name.toLowerCase().split('.').pop() ?? '';
 check(TYPES[ext], 'This file type is not allowed. Use PDF, images, Office documents (without macros), text or CSV.');
 const head = (n: number) => Array.from(bytes.slice(0, n));
 const starts = (sig: number[], at = 0) => sig.every((v, i) => bytes[at + i] === v);
 check(!starts([0x4d, 0x5a]) && !starts([0x7f, 0x45, 0x4c, 0x46]), 'Executable files are blocked.');
 const ok: Record<string, () => boolean> = {
  pdf: () => starts([0x25, 0x50, 0x44, 0x46]), png: () => starts([0x89, 0x50, 0x4e, 0x47]), jpg: () => starts([0xff, 0xd8, 0xff]), jpeg: () => starts([0xff, 0xd8, 0xff]),
  gif: () => starts([0x47, 0x49, 0x46]), webp: () => starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8), heic: () => starts([0x66, 0x74, 0x79, 0x70], 4),
  docx: () => starts([0x50, 0x4b, 0x03, 0x04]), xlsx: () => starts([0x50, 0x4b, 0x03, 0x04]), pptx: () => starts([0x50, 0x4b, 0x03, 0x04]),
  doc: () => starts([0xd0, 0xcf, 0x11, 0xe0]), xls: () => starts([0xd0, 0xcf, 0x11, 0xe0]),
  txt: () => !head(4096).includes(0), csv: () => !head(4096).includes(0),
 };
 check(ok[ext](), 'The file content does not match its type, so it was blocked.');
 // Office files carrying macros (vbaProject) are blocked.
 if (['docx', 'xlsx', 'pptx', 'doc', 'xls'].includes(ext)) check(!Buffer.from(bytes).includes('vbaProject'), 'Office files with macros are blocked.');
 return TYPES[ext];
}
// ClamAV (clamd INSTREAM) when CLAMAV_HOST is set. If scanning is configured but unavailable, uploads are refused.
function clamScan(bytes: Uint8Array): Promise<'clean' | 'infected' | 'off'> {
 const host = process.env.CLAMAV_HOST; if (!host) return Promise.resolve('off');
 return new Promise((resolve, reject) => {
  const sock = connect(Number(process.env.CLAMAV_PORT || 3310), host); let reply = '';
  sock.setTimeout(30000, () => { sock.destroy(); reject(Error('Malware scanner timed out.')); });
  sock.on('error', () => reject(Error('Malware scanner unavailable.')));
  sock.on('data', d => { reply += d; });
  sock.on('end', () => resolve(/FOUND/.test(reply) ? 'infected' : /OK/.test(reply) ? 'clean' : (reject(Error('Malware scanner gave no answer.')) as never)));
  sock.write('zINSTREAM\0');
  for (let i = 0; i < bytes.length; i += 65536) { const chunk = bytes.subarray(i, i + 65536); const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length); sock.write(len); sock.write(chunk); }
  sock.end(Buffer.alloc(4));
 });
}
const safeName = (v: string) => v.replace(/[^\w.\- ()一-鿿]/g, '_').slice(0, 150) || 'file';
const ATTACH_LOCKED = ['pending', 'approved', 'rejected'];

export async function upload(req: Request): Promise<Response> {
 try {
  checkOrigin(req);
  const u = await sessionUser(req); check(u, 'Please sign in again.'); const c = context(u!);
  if (requireAdminMfa() && isAdmin(u) && !u!.totp_secret) return json({error: 'MFA_REQUIRED'}, 403);
  const url = new URL(req.url);
  const item = get('SELECT * FROM item WHERE id=?', text(url.searchParams.get('item'), 64)); check(item, 'Item is unavailable.');
  const e = openEfile(c, item!.efile_id, 'edit'); check(may(c, e, 'edit'), 'Your level does not allow editing items.');
  check(!ATTACH_LOCKED.includes(item!.status) && !item!.locked && !item!.archived, 'Attachments are locked while the item is submitted or approved.');
  const filename = safeName(decodeURIComponent(req.headers.get('x-filename') ?? 'file'));
  const bytes = new Uint8Array(await req.arrayBuffer()); check(bytes.byteLength > 0 && bytes.byteLength <= MAX_BYTES, 'Files must be between 1 byte and 10 MB.');
  const type = inspect(filename, bytes);
  const scan = await clamScan(bytes).catch(err => { throw new UserError(err.message + ' Try again later.'); });
  if (scan === 'infected') { log(c, 'item', 'add', `拦截可疑附件:${filename}`, e.company_id); throw new UserError('This file failed the malware check and was blocked.'); }
  const id = uid(), key = `items/${item!.id}/${id}`;
  await attachments.put(key, bytes.buffer as ArrayBuffer);
  tx(() => {
   run('INSERT INTO item_attachment(id,item_id,storage_key,filename,size,content_type,uploaded_by,at) VALUES(?,?,?,?,?,?,?,?)', id, item!.id, key, filename, bytes.byteLength, type, c.user.id, now());
   run('UPDATE item SET version=version+1 WHERE id=?', item!.id);
   log(c, 'item', 'add', `上传附件:${e.name} - #${item!.seq} - ${filename}${scan === 'clean' ? ' (已扫描)' : ''}`, e.company_id);
  });
  return json({result: {id, scanned: scan === 'clean'}});
 } catch (e: any) {
  if (e instanceof UserError) return json({error: e.message}, 400);
  console.error('Upload error:', e?.message ?? e); return json({error: 'Upload failed.'}, 500);
 }
}

export async function download(req: Request): Promise<Response> {
 const u = await sessionUser(req); if (!u) return new Response('Please sign in.', {status: 401});
 const c = context(u);
 const url = new URL(req.url);
 const a = get('SELECT a.*, i.efile_id, i.seq FROM item_attachment a JOIN item i ON i.id=a.item_id WHERE a.id=?', text(url.searchParams.get('id'), 64));
 if (!a) return new Response('Not found', {status: 404});
 let e;
 try { e = openEfile(c, a.efile_id); } catch { return new Response('Not found', {status: 404}); }
 const inline = url.searchParams.get('inline') === '1' && PREVIEW.has(a.content_type);
 if (!inline && !may(c, e, 'download')) return new Response('Your level does not allow downloads.', {status: 403});
 const file = await attachments.get(a.storage_key); if (!file) return new Response('Not found', {status: 404});
 log(c, 'item', inline ? 'view' : 'download', `${inline ? '预览' : '下载'}附件:${e.name} - #${a.seq} - ${a.filename}`, e.company_id);
 return new Response(file.body, {headers: {'Content-Type': inline ? a.content_type : 'application/octet-stream',
  'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(a.filename)}`, 'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox"}});
}

Object.assign(actions, {
 async 'attachment.delete'(c: Ctx, b: any) {
  const a = get('SELECT a.*, i.efile_id, i.created_by, i.status, i.locked, i.seq FROM item_attachment a JOIN item i ON i.id=a.item_id WHERE a.id=?', text(b.id, 64)); check(a, 'Attachment is unavailable.');
  const e = openEfile(c, a!.efile_id, 'edit'); check(e.role === 'admin' || a!.uploaded_by === c.user.id || a!.created_by === c.user.id);
  check(!ATTACH_LOCKED.includes(a!.status) && !a!.locked, 'Attachments are locked while the item is submitted or approved.');
  run('DELETE FROM item_attachment WHERE id=?', a!.id); await attachments.delete(a!.storage_key);
  log(c, 'item', 'remove', `删除附件:${e.name} - #${a!.seq} - ${a!.filename}`, e.company_id);
  return {};
 },
});
