// Password hashing, sessions, request checks and first-run setup.
import {get, run, uid, now} from './db';

const configuredOrigin = new URL(process.env.PUBLIC_URL || 'http://localhost:3000');
if (configuredOrigin.username || configuredOrigin.password || configuredOrigin.pathname !== '/' || configuredOrigin.search || configuredOrigin.hash) throw Error('PUBLIC_URL must be an origin without a path or credentials.');
if (configuredOrigin.protocol !== 'https:' && !(configuredOrigin.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(configuredOrigin.hostname))) throw Error('Use HTTPS for a public PUBLIC_URL. HTTP is allowed only on localhost.');
export const publicOrigin = configuredOrigin.origin;

export class UserError extends Error {}
export function fail(message: string): never { throw new UserError(message); }
export function check(v: any, message = 'You do not have permission for this action.'): asserts v { if (!v) fail(message); }

const hex = (v: ArrayBuffer | Uint8Array) => Array.from(new Uint8Array(v)).map(x => x.toString(16).padStart(2, '0')).join('');
export async function digest(v: string) { return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))); }
export async function hashPassword(v: string, salt: string) {
 const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(v), 'PBKDF2', false, ['deriveBits']);
 return hex(await crypto.subtle.deriveBits({name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000}, k, 256));
}
export function equal(a: string, b: string) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i); return d === 0; }
export function validPassword(p: any) { check(typeof p === 'string' && p.length >= 8 && p.length <= 128, 'Use a password between 8 and 128 characters.'); }

export function checkOrigin(req: Request) { check(req.headers.get('origin') === new URL(req.url).origin, 'Request origin could not be verified.'); }
const cookieName = 'ims_session';
const readCookie = (req: Request) => req.headers.get('cookie')?.split(';').map(x => x.trim()).find(x => x.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
export const cookieHeader = (token: string, maxAge = 43200) => `${cookieName}=${token}; Path=/; HttpOnly; ${configuredOrigin.protocol === 'https:' ? 'Secure; ' : ''}SameSite=Lax; Max-Age=${maxAge}`;

export async function sessionUser(req: Request) {
 const token = readCookie(req); if (!token) return null;
 const s = get('SELECT * FROM sessions WHERE id=? AND expires>?', await digest(token), Date.now()); if (!s) return null;
 const u = get(`SELECT u.* FROM user u JOIN company c ON c.id=u.company_id WHERE u.id=? AND u.revision=? AND u.state='normal' AND c.status='normal'`, s.user_id, s.revision);
 return u;
}
export async function createSession(u: {id: string, revision: number}) {
 const token = uid() + uid();
 run('INSERT INTO sessions(id,user_id,expires,revision) VALUES(?,?,?,?)', await digest(token), u.id, Date.now() + 43200000, u.revision);
 return cookieHeader(token);
}
export async function endSession(req: Request) { const t = readCookie(req); if (t) run('DELETE FROM sessions WHERE id=?', await digest(t)); return cookieHeader('', 0); }

export async function throttle(req: Request, action: string) {
 const key = await digest((req.headers.get('x-client-ip') ?? 'visitor') + action + Math.floor(Date.now() / 60000));
 const r = get('INSERT INTO throttle(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count', key, Date.now() + 120000);
 check(r && r.count <= 15, 'Too many attempts. Please try again in a minute.');
 run('DELETE FROM throttle WHERE expires<?', Date.now());
}

export const ALL_PERMS = ['company', 'user', 'role', 'group', 'log', 'client', 'efile'] as const;

// First start: create the operating company, its two standard roles and the administrator from the environment.
export async function initialize() {
 if (get('SELECT id FROM user LIMIT 1')) return;
 const pw = process.env.ADMIN_PASSWORD || ''; validPassword(pw);
 const username = (process.env.ADMIN_USERNAME || 'admin').trim();
 check(/^[A-Za-z0-9._-]{2,40}$/.test(username), 'ADMIN_USERNAME must have 2–40 letters, numbers, dots, hyphens or underscores.');
 const company = uid(), admin = uid(), acAdmin = uid(), standard = uid(), salt = uid(), t = now();
 run('INSERT INTO company(id,name_cn,name_en,type,code,city,status,created_at) VALUES(?,?,?,?,?,?,?,?)', company, process.env.COMPANY_NAME_CN || process.env.COMPANY_NAME || 'IMS', process.env.COMPANY_NAME || 'IMS', 'Communicative', process.env.COMPANY_CODE || '', '', 'normal', t);
 run('INSERT INTO role(id,company_id,name,description,perms) VALUES(?,?,?,?,?)', acAdmin, company, 'A/C Administrator', 'Company account administrator - with all authorisation', JSON.stringify(ALL_PERMS));
 run('INSERT INTO role(id,company_id,name,description,perms) VALUES(?,?,?,?,?)', standard, company, 'Standard users', 'Without authorisation to set up company account, user, role, user group and view system log', JSON.stringify(['client', 'efile']));
 run(`INSERT INTO user(id,company_id,username,name_cn,name_en,email,level,system_admin,salt,pass,created_at) VALUES(?,?,?,?,?,?,'Administrator',1,?,?,?)`, admin, company, username, process.env.ADMIN_NAME || username, process.env.ADMIN_NAME || username, process.env.ADMIN_EMAIL || '', salt, await hashPassword(pw, salt), t);
 run('INSERT INTO user_role(user_id,role_id) VALUES(?,?)', admin, acAdmin);
 console.log('Initial administrator created. Sign in with the configured username and password.');
}
