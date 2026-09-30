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

// A user can act only while the account is normal, not expired, and the company is active.
export const live = (u: any, companyStatus = 'normal') => u && u.state === 'normal' && companyStatus === 'normal' && (!u.expires || Date.parse(u.expires) > Date.now());
export async function sessionUser(req: Request) {
 const token = readCookie(req); if (!token) return null;
 const s = get('SELECT * FROM sessions WHERE id=? AND expires>?', await digest(token), Date.now()); if (!s) return null;
 const u = get(`SELECT u.*, c.status AS company_status FROM user u JOIN company c ON c.id=u.company_id WHERE u.id=? AND u.revision=?`, s.user_id, s.revision);
 return live(u, u?.company_status) ? u : null;
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

// Function checkboxes that make up an authorization level. Viewing is implied by eFile membership.
export const PERMS = ['createFile', 'createItem', 'edit', 'download', 'export', 'submit', 'approve', 'efileAdmin', 'client', 'clientChat'] as const;
export const DEFAULT_LEVELS: [number, string, string, string[]][] = [
 [1, 'Level 1', 'Full functions', [...PERMS]],
 [2, 'Level 2', 'All functions except client management', PERMS.filter(p => p !== 'client')],
 [3, 'Level 3', 'Default for new users', ['createFile', 'createItem', 'edit', 'download', 'submit', 'approve']],
 [4, 'Level 4', 'Temporary account: view only, needs an expiry date and a responsible administrator', []],
];
export function seedLevels(companyId: string) {
 for (const [level, name, description, perms] of DEFAULT_LEVELS) run('INSERT OR IGNORE INTO level(company_id,level,name,description,perms) VALUES(?,?,?,?,?)', companyId, level, name, description, JSON.stringify(perms));
}

// First start: create the operator (WSP) company and its first named System Admin from the environment.
export async function initialize() {
 if (get('SELECT id FROM user LIMIT 1')) return;
 const pw = process.env.ADMIN_PASSWORD || ''; validPassword(pw);
 const username = (process.env.ADMIN_USERNAME || 'admin').trim();
 check(/^[A-Za-z0-9._-]{2,40}$/.test(username), 'ADMIN_USERNAME must have 2–40 letters, numbers, dots, hyphens or underscores.');
 const company = uid(), admin = uid(), salt = uid(), t = now();
 run(`INSERT INTO company(id,name_cn,name_en,code,status,operator,created_at) VALUES(?,?,?,?,'normal',1,?)`, company, process.env.COMPANY_NAME_CN || process.env.COMPANY_NAME || 'WSP', process.env.COMPANY_NAME || 'WSP', process.env.COMPANY_CODE || '', t);
 seedLevels(company);
 run(`INSERT INTO user(id,company_id,username,name_cn,name_en,email,position,level,salt,pass,created_at) VALUES(?,?,?,?,?,?,'system',1,?,?,?)`, admin, company, username, process.env.ADMIN_NAME || username, process.env.ADMIN_NAME || username, process.env.ADMIN_EMAIL || '', salt, await hashPassword(pw, salt), t);
 console.log('Initial System Admin created. Sign in with the configured username and password.');
}

// Time-based one-time passwords (RFC 6238) for administrator multi-factor authentication.
const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function totpSecret() { const a = crypto.getRandomValues(new Uint8Array(20)); let bits = 0, value = 0, out = ''; for (const b of a) { value = (value << 8) | b; bits += 8; while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; } } return out; }
export async function totpValid(secret: string, code: any) {
 if (!secret || !/^\d{6}$/.test(String(code ?? ''))) return false;
 let bits = 0, value = 0; const bytes: number[] = [];
 for (const ch of secret) { value = (value << 5) | B32.indexOf(ch); bits += 5; if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; } }
 const key = await crypto.subtle.importKey('raw', new Uint8Array(bytes), {name: 'HMAC', hash: 'SHA-1'}, false, ['sign']);
 for (const off of [-1, 0, 1]) {
  const buf = new ArrayBuffer(8); new DataView(buf).setBigUint64(0, BigInt(Math.floor(Date.now() / 30000) + off));
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, buf)); const o = sig[19] & 15;
  const n = (((sig[o] & 127) << 24) | (sig[o + 1] << 16) | (sig[o + 2] << 8) | sig[o + 3]) % 1000000;
  if (equal(String(n).padStart(6, '0'), String(code))) return true;
 }
 return false;
}
export const requireAdminMfa = () => process.env.REQUIRE_ADMIN_MFA !== 'false';
