// API client, hash router and small shared helpers.
import {useEffect, useState, useCallback} from 'react';

export class ApiError extends Error {}
export async function api<T = any>(action: string, params: Record<string, any> = {}): Promise<T> {
 const r = await fetch('/api/ims', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({action, ...params})});
 const j = await r.json().catch(() => ({error: 'Unable to complete the request.'}));
 if (!r.ok || j.error) {
  if (j.error === 'Please sign in again.') window.dispatchEvent(new Event('ims:signed-out'));
  throw new ApiError(j.error ?? 'Unable to complete the request.');
 }
 return j.result as T;
}
export async function uploadFile(itemId: string, file: File) {
 const r = await fetch(`/api/upload?item=${encodeURIComponent(itemId)}`, {method: 'POST', headers: {'x-filename': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream'}, body: file});
 const j = await r.json().catch(() => ({error: 'Upload failed.'}));
 if (!r.ok || j.error) throw new ApiError(j.error ?? 'Upload failed.');
 return j.result;
}

// Hash routes: #/ims/efile/123?view=recent
export function parseHash() {
 const raw = location.hash.replace(/^#/, '') || '/';
 const [path, query = ''] = raw.split('?');
 return {path, parts: path.split('/').filter(Boolean), query: Object.fromEntries(new URLSearchParams(query))};
}
export function useRoute() {
 const [route, setRoute] = useState(parseHash());
 useEffect(() => { const on = () => setRoute(parseHash()); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
 return route;
}
export const go = (path: string) => { location.hash = path; };
export const href = (path: string) => '#' + path;

// Load data for a page and reload on demand.
export function useLoad<T>(fn: () => Promise<T>, deps: any[]) {
 const [data, setData] = useState<T | null>(null);
 const [error, setError] = useState('');
 const [tick, setTick] = useState(0);
 useEffect(() => {
  let live = true; setError('');
  fn().then(d => { if (live) setData(d); }).catch(e => { if (live) setError(e.message); });
  return () => { live = false; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [...deps, tick]);
 const reload = useCallback(() => setTick(t => t + 1), []);
 return {data, error, reload, setData};
}

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const today = () => ymd(new Date());
export const monthAgo = () => { const d = new Date(); d.setMonth(d.getMonth() - 1); return ymd(d); };
export const colorClass = (c?: string) => c ? 'bg-' + c.replace(/ /g, '-') : '';
const pad = (n: number) => String(n).padStart(2, '0');
export const fmtTime = (iso: string) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
export const semi = (list: {label: string}[]) => list.map(x => x.label + ';').join('');
