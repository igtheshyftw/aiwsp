import {database,attachments} from '../server/storage';
import {newState,find,check,id,live,projection,type State,type Row} from './model';
export const db=()=>database as any;
export const bucket=()=>attachments;
const configuredOrigin=new URL(process.env.PUBLIC_URL||'http://localhost:3000');
if(configuredOrigin.username||configuredOrigin.password||configuredOrigin.pathname!=='/'||configuredOrigin.search||configuredOrigin.hash)throw Error('PUBLIC_URL must be an origin without a path or credentials.');
if(configuredOrigin.protocol!=='https:'&&!(configuredOrigin.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(configuredOrigin.hostname)))throw Error('Use HTTPS for a public PUBLIC_URL. HTTP is allowed only on localhost.');
export const publicOrigin=configuredOrigin.origin;
export const encode=(v:ArrayBuffer|Uint8Array)=>Array.from(new Uint8Array(v)).map(x=>x.toString(16).padStart(2,'0')).join('');
export async function digest(v:string){return encode(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)))}
export async function password(v:string,salt:string){const k=await crypto.subtle.importKey('raw',new TextEncoder().encode(v),'PBKDF2',false,['deriveBits']);return encode(await crypto.subtle.deriveBits({name:'PBKDF2',hash:'SHA-256',salt:new TextEncoder().encode(salt),iterations:100000},k,256))}
export function equal(a:string,b:string){if(a.length!==b.length)return false;let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);return diff===0}
export function validPassword(p:string){check(typeof p==='string'&&p.length>=12&&p.length<=128,'Use a password between 12 and 128 characters.');}
export function origin(req:Request){const o=req.headers.get('origin');check(o===new URL(req.url).origin,'Request origin could not be verified.');}
export const cookie=(req:Request,key:string)=>req.headers.get('cookie')?.split(';').map(x=>x.trim()).find(x=>x.startsWith(key+'='))?.slice(key.length+1);
export const cookieHeader=(token:string)=>`aiwsp_session=${token}; Path=/; HttpOnly; ${configuredOrigin.protocol==='https:'?'Secure; ':''}SameSite=Lax; Max-Age=${token==='signed-out'?86400:43200}`;
export function response(data:any,status=200,headers:any={}){return Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}})}
export async function initializeWorkspace(){
 if(await db().prepare("SELECT id FROM workspace WHERE id='main'").first())return;
 const adminPassword=process.env.ADMIN_PASSWORD||'';validPassword(adminPassword);
 const username=(process.env.ADMIN_USERNAME||'wsp-admin').toLowerCase();check(/^[a-z0-9._-]{3,40}$/.test(username),'ADMIN_USERNAME must have 3–40 letters, numbers, dots, hyphens or underscores.');
 const s=newState(process.env.ADMIN_EMAIL||'',process.env.ADMIN_NAME||'WSP System Admin');const admin=s.users[0];admin.username=username;admin.salt=id();admin.pass=await password(adminPassword,admin.salt);
 await db().prepare("INSERT OR IGNORE INTO workspace(id,body,version) VALUES('main',?,0)").bind(JSON.stringify(s)).run();
 console.log('Initial WSP System Admin created. Sign in with the configured username and password.');
}
export async function load(_req:Request){const row=await db().prepare("SELECT body,version FROM workspace WHERE id='main'").first();check(row,'Workspace has not been initialized.');return {state:JSON.parse(row.body) as State,version:row.version as number}}
export async function save(s:State,version:number){const json=JSON.stringify(s);check(json.length<8_000_000,'Workspace capacity reached. Export your records and contact support.');const r=await db().prepare("UPDATE workspace SET body=?,version=version+1 WHERE id='main' AND version=?").bind(json,version).run();check(r.meta.changes===1,'Another change was saved first. Refresh and try again.')}
export async function user(req:Request,s:State):Promise<Row|null>{const token=cookie(req,'aiwsp_session');if(token){if(token==='signed-out')return null;const session=await db().prepare('SELECT * FROM sessions WHERE id=? AND expires>?').bind(await digest(token),Date.now()).first();if(!session)return null;return s.users.find(x=>x.id===session.user_id&&x.revision===session.revision&&live(s,x))??null}return null}
export async function session(u:Row){const token=id()+id();await db().prepare('INSERT INTO sessions(id,user_id,expires,revision) VALUES(?,?,?,?)').bind(await digest(token),u.id,Date.now()+43200000,u.revision).run();return cookieHeader(token)}
export async function throttle(req:Request,action:string){const key=await digest((req.headers.get('cf-connecting-ip')??'visitor')+action+Math.floor(Date.now()/60000));const r=await db().prepare('INSERT INTO throttle(id,count,expires) VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET count=count+1 RETURNING count').bind(key,Date.now()+120000).first();check(r.count<=15,'Too many requests. Please try again in a minute.');await db().prepare('DELETE FROM throttle WHERE expires<?').bind(Date.now()).run()}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function secret(){const a=crypto.getRandomValues(new Uint8Array(20));let bits=0,value=0,result='';for(const b of a){value=(value<<8)|b;bits+=8;while(bits>=5){result+=alphabet[(value>>>(bits-5))&31];bits-=5}}return result}
export async function totp(secret:string,code:string){if(!/^\d{6}$/.test(code))return false;let bits=0,value=0;const bytes=[];for(const c of secret){value=(value<<5)|alphabet.indexOf(c);bits+=5;if(bits>=8){bytes.push((value>>>(bits-8))&255);bits-=8}}const key=await crypto.subtle.importKey('raw',new Uint8Array(bytes),{name:'HMAC',hash:'SHA-1'},false,['sign']);for(const off of [-1,0,1]){const buffer=new ArrayBuffer(8);new DataView(buffer).setBigUint64(0,BigInt(Math.floor(Date.now()/30000)+off));const sig=new Uint8Array(await crypto.subtle.sign('HMAC',key,buffer));const o=sig[19]&15;const n=(((sig[o]&127)<<24)|(sig[o+1]<<16)|(sig[o+2]<<8)|sig[o+3])%1000000;if(equal(String(n).padStart(6,'0'),code))return true}return false}
export {projection};
