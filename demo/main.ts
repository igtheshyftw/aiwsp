// Online demo: runs the real IMS server code inside the browser, so the demo needs no server.
// - The database is SQLite compiled to JavaScript (sql.js), kept in this browser's localStorage.
// - The app's requests to /api/... are answered in the page by server/api.ts.
// - The AiWSP Assistant uses the stand-in agent (scripts/example-agent-logic.mjs).
// Built into one HTML file by scripts/build-demo.mjs.
import {DemoRequest, DemoResponse, DemoHeaders} from './http';
import {seedDemo, DEMO_PASSWORD, DEMO_ACCOUNTS} from '../scripts/demo-seed.mjs';
import {exampleAnswer} from '../scripts/example-agent-logic.mjs';

declare const IMS_DEMO_BUILD: string;
const g = globalThis as any;
const BASE = 'http://localhost:3000';
const AGENT = 'http://demo-agent.localhost/agent';
const KEY = `ims-demo-${IMS_DEMO_BUILD}`;
const NativeResponse = g['Response'];
const nativeFetch = g.fetch.bind(g);

Object.assign(g, {DemoRequest, DemoResponse, DemoHeaders});
g.process = {env: {PUBLIC_URL: BASE, ADMIN_USERNAME: 'wsp-admin', ADMIN_PASSWORD: DEMO_PASSWORD, ADMIN_NAME: 'WSP System Admin', COMPANY_NAME: 'WSP',
 REQUIRE_ADMIN_MFA: 'false', AGENT_URL: AGENT, DISABLE_JOBS: '1'}};
g.IMS_DEMO = {password: DEMO_PASSWORD, accounts: DEMO_ACCOUNTS};
g.Buffer ??= {from: (b: Uint8Array) => ({includes: (s: string) => new TextDecoder('latin1').decode(b).includes(s)})};
if (!g.crypto.randomUUID) g.crypto.randomUUID = () => ([1e7] as any + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, (c: number) => (c ^ g.crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16));

// ---- Saved state (this browser only)
const store = {
 get(k: string) { try { return localStorage.getItem(`${KEY}-${k}`); } catch { return null; } },
 set(k: string, v: string) { try { localStorage.setItem(`${KEY}-${k}`, v); } catch { /* storage full or blocked: the demo still works until reload */ } },
 clear() { try { for (const k of Object.keys(localStorage)) if (k.startsWith('ims-demo-')) localStorage.removeItem(k); } catch { /* ignore */ } },
};
const toB64 = (b: Uint8Array) => { let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
let cookie = store.get('cookie') ?? '';
let saveTimer: any;
function persist() {
 clearTimeout(saveTimer);
 saveTimer = setTimeout(() => { const db = g.__imsDb; store.set('db', toB64(db.export())); db.exec('PRAGMA foreign_keys=ON'); }, 600);
}

// ---- Calling the server code
type Server = typeof import('./server');
async function call(server: Server, path: string, init: {method?: string, headers?: any, body?: any}, jar: {cookie: string}) {
 const headers = new DemoHeaders(init.headers);
 headers.set('origin', BASE); headers.set('x-client-ip', 'demo'); if (jar.cookie) headers.set('cookie', jar.cookie);
 let body = init.body; if (body instanceof Blob) body = new Uint8Array(await body.arrayBuffer());
 const req = new DemoRequest(BASE + path, {method: init.method ?? 'GET', headers, body}) as any;
 const route = path.split('?')[0];
 const res: DemoResponse = route === '/api/ims' ? await server.api(req) as any : route === '/api/upload' ? await server.upload(req) as any
  : route === '/api/file' ? await server.download(req) as any : new DemoResponse('Not found', {status: 404});
 const set = res.headers.get('set-cookie'); if (set) jar.cookie = /Max-Age=0\b/.test(set) ? '' : set.split(';')[0];
 return res;
}
// Sample data: the same as `npm run demo` (scripts/demo-seed.mjs).
const seedSession = (server: Server) => () => {
 const jar = {cookie: ''};
 return async (action: string, body: object = {}) => {
  const r = await call(server, '/api/ims', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({action, ...body})}, jar);
  const j = await r.json(); if (j.error) throw Error(`${action}: ${j.error}`); return j.result;
 };
};

const ready: Promise<Server> = (async () => {
 const SQL = await g.initSqlJs();
 const saved = store.get('db');
 g.__imsDb = saved ? new SQL.Database(fromB64(saved)) : new SQL.Database();
 const server: Server = await import('./server');
 await server.initialize();
 if (!saved) { await seedDemo(seedSession(server)); server.runDaily(); cookie = ''; store.set('cookie', ''); }
 persist();
 return server;
})();
ready.then(() => document.getElementById('demo-loading')?.remove(), e => {
 console.error(e);
 const el = document.getElementById('demo-loading'); if (el) el.textContent = 'The demo could not start in this browser. Try a current version of Chrome, Edge, Safari or Firefox.';
});

// The app's requests (and the server's call to the agent) are answered here.
g.fetch = async (input: any, init: any = {}) => {
 const url: string = typeof input === 'string' ? input : input.url;
 if (url === AGENT) {
  await new Promise(r => setTimeout(r, 700));
  return new NativeResponse(JSON.stringify({confidence: 0.9, ...exampleAnswer(JSON.parse(init.body))}), {headers: {'content-type': 'application/json'}});
 }
 if (!url.startsWith('/api/')) return nativeFetch(input, init);
 const server = await ready;
 const jar = {cookie};
 const res = await call(server, url, init, jar);
 if (jar.cookie !== cookie) { cookie = jar.cookie; store.set('cookie', cookie); }
 persist();
 return new NativeResponse(res.body ?? null, {status: res.status, headers: {'content-type': res.headers.get('content-type') ?? 'application/json'}});
};

// ---- Demo frame: a loading cover, a small banner with Reset, and a note when an attachment link is followed.
function frame() {
 const css = document.createElement('style');
 css.textContent = `#demo-loading{position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:#f3f3f3;color:#333;font:16px/1.5 system-ui,sans-serif;padding:16px;text-align:center}
 #demo-bar{position:fixed;left:12px;bottom:12px;z-index:90;background:#2f3b4c;color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 10px;display:flex;gap:10px;align-items:center;max-width:calc(100% - 24px);box-shadow:0 2px 8px rgba(0,0,0,.25)}
 #demo-bar button{background:#fff;color:#2f3b4c;border:0;padding:4px 10px;font:inherit;cursor:pointer}
 #demo-bar button:focus-visible{outline:2px solid #6a90ef;outline-offset:2px}
 #demo-note{position:fixed;right:12px;bottom:12px;z-index:91;background:#fff;border:1px solid #ccc;padding:10px 12px;font:13px system-ui,sans-serif;max-width:320px}`;
 document.head.append(css);
 const loading = document.createElement('div'); loading.id = 'demo-loading'; loading.textContent = 'Preparing the IMS demo with sample data…';
 const bar = document.createElement('div'); bar.id = 'demo-bar';
 const label = document.createElement('span'); label.textContent = 'Online demo · changes are kept in this browser only';
 const reset = document.createElement('button'); reset.type = 'button'; reset.textContent = 'Reset demo';
 reset.onclick = () => {
  if (reset.dataset.armed) { store.clear(); location.hash = ''; location.reload(); return; }
  reset.dataset.armed = '1'; reset.textContent = 'Click again to reset'; setTimeout(() => { delete reset.dataset.armed; reset.textContent = 'Reset demo'; }, 4000);
 };
 bar.append(label, reset);
 document.body.append(loading, bar);
 document.addEventListener('click', e => {
  const a = (e.target as Element).closest?.('a[href*="/api/file"]'); if (!a) return;
  e.preventDefault();
  let note = document.getElementById('demo-note');
  if (!note) { note = document.createElement('div'); note.id = 'demo-note'; document.body.append(note); }
  note.textContent = 'Opening and downloading attachments works on the real server; it is not available in this online demo.';
  setTimeout(() => note?.remove(), 5000);
 }, true);
}
if (document.body) frame(); else document.addEventListener('DOMContentLoaded', frame);
