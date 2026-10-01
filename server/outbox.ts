// Notifications outside IMS: every in-app notification is also sent to the person by WeCom (企业微信 app message) or email,
// when the server is configured for it and the person's preference allows (My Profile → Notifications).
//  - WeCom: WECOM_CORP_ID, WECOM_SECRET, WECOM_AGENT_ID (WECOM_API_BASE for tests). The recipient is the user's WeCom user ID,
//    set by an administrator, or looked up once from their mobile number.
//  - Email: SMTP_URL (e.g. smtps://user:password@smtp.exmail.qq.com:465) and SMTP_FROM.
// Messages carry only the notification title and a link; the content stays in IMS behind sign-in.
// They are queued in the same transaction as the notification and delivered in the background with retries.
import nodemailer from 'nodemailer';
import {all, get, run, uid, now, type Row} from './db';
import {publicOrigin} from './auth';

const wecomBase = () => (process.env.WECOM_API_BASE || 'https://qyapi.weixin.qq.com').replace(/\/$/, '');
export const wecomReady = () => !!(process.env.WECOM_CORP_ID && process.env.WECOM_SECRET && process.env.WECOM_AGENT_ID);
export const emailReady = () => !!(process.env.SMTP_URL && process.env.SMTP_FROM);
export const CHANNELS = ['auto', 'wecom', 'email', 'both', 'none'];
const MAX_ATTEMPTS = 5;

// Which channels a user's notification goes to. "auto": WeCom when possible, otherwise email.
export function channelsFor(u: Row): string[] {
 const wecom = wecomReady() && !!(u.wecom_userid || u.mobile), email = emailReady() && !!u.email;
 const pref = CHANNELS.includes(u.notify_channel) ? u.notify_channel : 'auto';
 if (pref === 'none') return [];
 if (pref === 'auto') return wecom ? ['wecom'] : email ? ['email'] : [];
 return [...(pref !== 'email' && wecom ? ['wecom'] : []), ...(pref !== 'wecom' && email ? ['email'] : [])];
}
export function enqueue(userId: string, kind: string, subject: string, efileId?: string | null, itemId?: string | null) {
 if (!wecomReady() && !emailReady()) return;
 const u = get(`SELECT * FROM user WHERE id=? AND state='normal'`, userId); if (!u) return;
 const operator = !!get('SELECT operator FROM company WHERE id=?', u.company_id)?.operator;
 const path = itemId && efileId ? `/ims/efile/${efileId}/item/${itemId}` : efileId ? `/ims/efile/${efileId}` : kind === 'chat' ? (operator ? '/assistant/inbox' : '/assistant') : '/';
 for (const ch of channelsFor(u)) run('INSERT INTO outbox(id,user_id,channel,subject,link,next_at,created_at) VALUES(?,?,?,?,?,?,?)', uid(), userId, ch, subject.slice(0, 300), `${publicOrigin}/#${path}`, now(), now());
}

// ---- WeCom
let token: {value: string, until: number} | null = null;
async function wecom(path: string, body?: unknown, retry = true): Promise<Row> {
 if (!token || token.until < Date.now()) {
  const r = await (await fetch(`${wecomBase()}/cgi-bin/gettoken?corpid=${encodeURIComponent(process.env.WECOM_CORP_ID!)}&corpsecret=${encodeURIComponent(process.env.WECOM_SECRET!)}`, {signal: AbortSignal.timeout(10000)})).json() as Row;
  if (r.errcode) throw Error(`WeCom token: ${r.errcode} ${r.errmsg ?? ''}`);
  token = {value: r.access_token, until: Date.now() + (Number(r.expires_in || 7200) - 300) * 1000};
 }
 const res = await (await fetch(`${wecomBase()}/cgi-bin/${path}?access_token=${encodeURIComponent(token.value)}`, {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(body), signal: AbortSignal.timeout(10000)})).json() as Row;
 if ([40014, 42001, 40001].includes(res.errcode) && retry) { token = null; return wecom(path, body, false); }
 return res;
}
async function sendWecom(u: Row, m: Row) {
 let to = u.wecom_userid;
 if (!to) {
  const r = await wecom('user/getuserid', {mobile: u.mobile});
  if (r.errcode || !r.userid) throw Error(`WeCom has no member with mobile ${u.mobile} (${r.errcode} ${r.errmsg ?? ''})`);
  to = r.userid; run('UPDATE user SET wecom_userid=? WHERE id=?', to, u.id);
 }
 const r = await wecom('message/send', {touser: to, msgtype: 'textcard', agentid: Number(process.env.WECOM_AGENT_ID),
  textcard: {title: 'IMS', description: m.subject, url: m.link, btntxt: '打开 Open'}});
 if (r.errcode) throw Error(`WeCom send: ${r.errcode} ${r.errmsg ?? ''}`);
}
// ---- Email
let mailer: ReturnType<typeof nodemailer.createTransport> | null = null;
async function sendEmail(u: Row, m: Row) {
 mailer ??= nodemailer.createTransport(process.env.SMTP_URL!);
 await mailer.sendMail({from: process.env.SMTP_FROM, to: u.email, subject: `[IMS] ${m.subject}`,
  text: `${m.subject}\n\nOpen in IMS: ${m.link}\n\nThis is an automatic message from IMS. Change how you receive these under My Profile → Notifications.`});
}

// Deliver what is due. Failures are retried after 1, 2, 4, 8 minutes, then marked failed.
let busy = false;
export async function deliver(): Promise<{sent: number, failed: number}> {
 if (busy) return {sent: 0, failed: 0};
 busy = true; let sent = 0, failed = 0;
 try {
  for (const m of all(`SELECT * FROM outbox WHERE status='pending' AND next_at<=? ORDER BY created_at LIMIT 100`, now())) {
   const u = get('SELECT * FROM user WHERE id=?', m.user_id);
   try {
    if (!u || u.state !== 'normal') throw Error('The account is no longer active.');
    if (m.channel === 'wecom') await sendWecom(u, m); else await sendEmail(u, m);
    run(`UPDATE outbox SET status='sent', sent_at=?, attempts=attempts+1, error='' WHERE id=?`, now(), m.id); sent++;
   } catch (e) {
    const attempts = m.attempts + 1, error = (e instanceof Error ? e.message : String(e)).slice(0, 300);
    run(`UPDATE outbox SET attempts=?, error=?, status=?, next_at=? WHERE id=?`, attempts, error, attempts >= MAX_ATTEMPTS || !u ? 'failed' : 'pending',
     new Date(Date.now() + 60000 * 2 ** (attempts - 1)).toISOString(), m.id);
    failed++;
   }
  }
 } finally { busy = false; }
 return {sent, failed};
}
export function startDelivery() {
 const tick = () => { deliver().catch(e => console.error('Notification delivery failed:', e instanceof Error ? e.message : e)); };
 return setInterval(tick, 30000).unref();
}
export function outboxStatus() {
 const since = new Date(Date.now() - 7 * 86400000).toISOString();
 return {wecom: wecomReady(), email: emailReady(),
  counts: Object.fromEntries(all('SELECT status, COUNT(*) AS n FROM outbox WHERE created_at>=? GROUP BY status', since).map(r => [r.status, r.n])),
  failures: all(`SELECT o.channel, o.subject, o.error, o.created_at, u.username FROM outbox o LEFT JOIN user u ON u.id=o.user_id WHERE o.status='failed' ORDER BY o.created_at DESC LIMIT 10`)};
}
