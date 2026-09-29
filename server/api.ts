// JSON API: POST /api/ims {action, ...params}; item attachments at /api/upload and /api/file.
import {get, run, uid, now, tx} from './db';
import {attachments} from './storage';
import {UserError, check, checkOrigin, sessionUser, createSession, endSession, throttle, hashPassword, equal, validPassword} from './auth';
import {context, can, text, log, userLabel, type Ctx} from './ctx';
import {efile as openEfile} from './access';
import {accountActions} from './actions/account';
import {efileActions} from './actions/efile';
import {itemActions} from './actions/item';

const actions: Record<string, (c: Ctx, b: any) => any> = {...accountActions, ...efileActions, ...itemActions};

const json = (data: any, status = 200, headers: Record<string, string> = {}) =>
 Response.json(data, {status, headers: {'Cache-Control': 'no-store', ...headers}});

function me(c: Ctx) {
 const company = get('SELECT * FROM company WHERE id=?', c.companyId)!;
 return {id: c.user.id, username: c.user.username, name: userLabel(c.user), name_en: c.user.name_en || c.user.username, company: {id: company.id, name_cn: company.name_cn, name_en: company.name_en},
  sys: c.sys, perms: ['company', 'user', 'role', 'group', 'log', 'client', 'efile'].filter(p => can(c, p))};
}

export async function api(req: Request): Promise<Response> {
 try {
  checkOrigin(req);
  const b = JSON.parse(await req.text() || '{}');
  const action = text(b.action, 60);
  if (action === 'login') {
   await throttle(req, 'login');
   const u = get(`SELECT u.* FROM user u JOIN company c ON c.id=u.company_id WHERE u.username=? AND u.state='normal' AND c.status='normal'`, text(b.username, 60));
   const ok = u && equal(await hashPassword(String(b.password ?? ''), u.salt), u.pass);
   check(ok, 'Invalid user name or password.');
   const c = context(u!); log(c, 'login', 'modify', `用户登录:${u!.username}`);
   return json({result: me(c)}, 200, {'Set-Cookie': await createSession(u as {id: string, revision: number})});
  }
  if (action === 'logout') {
   const u = await sessionUser(req); if (u) log(context(u), 'login', 'modify', `用户注销:${u.username}`);
   return json({result: {}}, 200, {'Set-Cookie': await endSession(req)});
  }
  const u = await sessionUser(req);
  if (action === 'me') return json({result: u ? me(context(u)) : null});
  check(u, 'Please sign in again.');
  const c = context(u!);
  if (action === 'profile.password') {
   check(equal(await hashPassword(String(b.current ?? ''), u!.salt), u!.pass), 'Current password is incorrect.');
   validPassword(b.password); check(b.password === b.confirm, 'Passwords do not match.');
   const salt = uid(), pass = await hashPassword(b.password, salt);
   run('UPDATE user SET salt=?,pass=?,revision=revision+1 WHERE id=?', salt, pass, u!.id);
   log(c, 'account', 'modify', `修改密码:${u!.username}`);
   return json({result: {}}, 200, {'Set-Cookie': await createSession({id: u!.id, revision: u!.revision + 1})});
  }
  const fn = actions[action]; check(fn, 'Unknown action.');
  return json({result: await fn(c, b)});
 } catch (e: any) {
  if (e instanceof UserError) return json({error: e.message}, 400);
  if (e instanceof SyntaxError) return json({error: 'Invalid request.'}, 400);
  console.error('API error:', e?.message ?? e);
  return json({error: 'Unable to complete the request.'}, 500);
 }
}

const safeName = (v: string) => v.replace(/[^\w.\- ()一-鿿]/g, '_').slice(0, 150) || 'file';

export async function upload(req: Request): Promise<Response> {
 try {
  checkOrigin(req);
  const u = await sessionUser(req); check(u, 'Please sign in again.'); const c = context(u!);
  const url = new URL(req.url);
  const item = get('SELECT * FROM item WHERE id=?', text(url.searchParams.get('item'), 64)); check(item, 'Item is unavailable.');
  const e = openEfile(c, item!.efile_id);
  const filename = safeName(decodeURIComponent(req.headers.get('x-filename') ?? 'file'));
  const body = await req.arrayBuffer(); check(body.byteLength > 0 && body.byteLength <= 10_000_000, 'Files must be between 1 byte and 10 MB.');
  const id = uid(), key = `items/${item!.id}/${id}`;
  await attachments.put(key, body);
  tx(() => {
   run('INSERT INTO item_attachment(id,item_id,storage_key,filename,size,at) VALUES(?,?,?,?,?,?)', id, item!.id, key, filename, body.byteLength, now());
   log(c, 'item', 'add', `上传附件:${e.name} - ${item!.name.slice(0, 60)} - ${filename}`);
  });
  return json({result: {id}});
 } catch (e: any) {
  if (e instanceof UserError) return json({error: e.message}, 400);
  console.error('Upload error:', e?.message ?? e); return json({error: 'Upload failed.'}, 500);
 }
}

export async function download(req: Request): Promise<Response> {
 const u = await sessionUser(req); if (!u) return new Response('Please sign in.', {status: 401});
 const c = context(u);
 const url = new URL(req.url);
 const a = get('SELECT a.*, i.efile_id FROM item_attachment a JOIN item i ON i.id=a.item_id WHERE a.id=?', text(url.searchParams.get('id'), 64));
 if (!a) return new Response('Not found', {status: 404});
 try { openEfile(c, a.efile_id); } catch { return new Response('Not found', {status: 404}); }
 const file = await attachments.get(a.storage_key); if (!file) return new Response('Not found', {status: 404});
 return new Response(file.body, {headers: {'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(a.filename)}`, 'Cache-Control': 'private, no-store'}});
}

export const attachmentActions: Record<string, (c: Ctx, b: any) => any> = {
 async 'attachment.delete'(c, b) {
  const a = get('SELECT a.*, i.efile_id, i.created_by FROM item_attachment a JOIN item i ON i.id=a.item_id WHERE a.id=?', text(b.id, 64)); check(a, 'Attachment is unavailable.');
  const e = openEfile(c, a!.efile_id); check(e.role === 'admin' || a!.created_by === c.user.id);
  run('DELETE FROM item_attachment WHERE id=?', a!.id); await attachments.delete(a!.storage_key);
  log(c, 'item', 'remove', `删除附件:${e.name} - ${a!.filename}`);
  return {};
 },
};
Object.assign(actions, attachmentActions);
