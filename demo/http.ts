// Plain stand-ins for Request, Response and Headers, used by the server code in the online demo. Browsers drop the Cookie and
// Set-Cookie headers from their own Request and Response objects, so the demo bundle maps those names to these classes.
type Body = string | Uint8Array | ArrayBuffer | null | undefined;
export class DemoHeaders {
 private m = new Map<string, string>();
 constructor(init?: any) {
  if (!init) return;
  const entries: [string, string][] = init instanceof DemoHeaders ? [...init.m] : typeof init.forEach === 'function' && !Array.isArray(init) && typeof init.entries === 'function' ? [...init.entries()] : Array.isArray(init) ? init : Object.entries(init);
  for (const [k, v] of entries) this.set(k, v);
 }
 get(k: string) { return this.m.get(k.toLowerCase()) ?? null; }
 set(k: string, v: unknown) { this.m.set(k.toLowerCase(), String(v)); }
 has(k: string) { return this.m.has(k.toLowerCase()); }
 append(k: string, v: unknown) { const e = this.get(k); this.set(k, e === null ? v : `${e}, ${v}`); }
 delete(k: string) { this.m.delete(k.toLowerCase()); }
 forEach(fn: (v: string, k: string, h: DemoHeaders) => void) { this.m.forEach((v, k) => fn(v, k, this)); }
 entries() { return this.m.entries(); }
 [Symbol.iterator]() { return this.m.entries(); }
}
const bytes = (b: Body) => b == null ? new Uint8Array() : typeof b === 'string' ? new TextEncoder().encode(b) : b instanceof Uint8Array ? b : new Uint8Array(b);
export class DemoRequest {
 url: string; method: string; headers: DemoHeaders; private body: Body;
 constructor(url: string, init: {method?: string, headers?: any, body?: Body} = {}) { this.url = url; this.method = init.method ?? 'GET'; this.headers = new DemoHeaders(init.headers); this.body = init.body; }
 async text() { return typeof this.body === 'string' ? this.body : new TextDecoder().decode(bytes(this.body)); }
 async json() { return JSON.parse(await this.text()); }
 async arrayBuffer() { const b = bytes(this.body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
}
export class DemoResponse {
 status: number; headers: DemoHeaders; body: Body;
 constructor(body?: Body, init: {status?: number, headers?: any} = {}) { this.body = body ?? null; this.status = init.status ?? 200; this.headers = new DemoHeaders(init.headers); }
 get ok() { return this.status >= 200 && this.status < 300; }
 async text() { return typeof this.body === 'string' ? this.body : new TextDecoder().decode(bytes(this.body)); }
 async json() { return JSON.parse(await this.text()); }
 async arrayBuffer() { const b = bytes(this.body); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
 static json(data: unknown, init: {status?: number, headers?: any} = {}) {
  const r = new DemoResponse(JSON.stringify(data), init); if (!r.headers.has('content-type')) r.headers.set('content-type', 'application/json'); return r;
 }
}
