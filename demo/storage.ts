// The online demo's replacement for server/storage.ts: the database lives in the browser (sql.js), attachments in memory.
import {DatabaseSync} from './sqlite';

export const dataDirectory = 'browser';
export const sql = new DatabaseSync();
sql.exec(`CREATE TABLE IF NOT EXISTS workspace(id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS throttle(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
const files = new Map<string, Uint8Array>();
export const attachments = {
 async put(key: string, body: ArrayBuffer) { files.set(key, new Uint8Array(body)); },
 async get(key: string) { const b = files.get(key); return b ? {body: b} : null; },
 async delete(key: string) { files.delete(key); },
};
export function closeDatabase() {}
