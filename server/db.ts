// Normalised IMS schema on node:sqlite. All money is stored as integer cents.
import {sql} from './storage';

sql.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS company(
 id TEXT PRIMARY KEY, name_cn TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '',
 code TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'normal', created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS user(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name_cn TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', sex TEXT NOT NULL DEFAULT '', dept TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '', account_type TEXT NOT NULL DEFAULT 'Standard', level TEXT NOT NULL DEFAULT 'Normal User',
 state TEXT NOT NULL DEFAULT 'normal', system_admin INTEGER NOT NULL DEFAULT 0,
 salt TEXT NOT NULL DEFAULT '', pass TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS role(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
 share INTEGER NOT NULL DEFAULT 0, perms TEXT NOT NULL DEFAULT '[]');
CREATE TABLE IF NOT EXISTS user_role(user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, role_id TEXT NOT NULL REFERENCES role(id) ON DELETE CASCADE, PRIMARY KEY(user_id,role_id));
CREATE TABLE IF NOT EXISTS user_group(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, share INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS user_group_member(group_id TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS client(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), code TEXT NOT NULL DEFAULT '', name_cn TEXT NOT NULL DEFAULT '',
 name_en TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '',
 address TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS efile(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '',
 select_type TEXT NOT NULL DEFAULT 'user_and_group', highlight INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '',
 report_name TEXT NOT NULL DEFAULT '', item_type TEXT NOT NULL DEFAULT 'number',
 balance INTEGER NOT NULL DEFAULT 0, balance_alias TEXT NOT NULL DEFAULT '', notional INTEGER NOT NULL DEFAULT 0, notional_alias TEXT NOT NULL DEFAULT '',
 currency TEXT NOT NULL DEFAULT 'CNY', password TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS efile_member(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, kind TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, PRIMARY KEY(efile_id,kind,user_id));
CREATE TABLE IF NOT EXISTS efile_group(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, kind TEXT NOT NULL, group_id TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE, PRIMARY KEY(efile_id,kind,group_id));
CREATE TABLE IF NOT EXISTS efile_step(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', PRIMARY KEY(efile_id,position));
CREATE TABLE IF NOT EXISTS efile_step_user(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, position INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, PRIMARY KEY(efile_id,position,user_id));
CREATE TABLE IF NOT EXISTS user_efile(
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE,
 in_my INTEGER NOT NULL DEFAULT 1, hidden INTEGER NOT NULL DEFAULT 0, mtt INTEGER NOT NULL DEFAULT 0, link INTEGER NOT NULL DEFAULT 0,
 color TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id,efile_id));
CREATE TABLE IF NOT EXISTS efile_share(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, balance INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(efile_id,user_id));
CREATE TABLE IF NOT EXISTS system_link(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item(
 id TEXT PRIMARY KEY, efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, name TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0,
 item_date TEXT NOT NULL DEFAULT '', target_date TEXT NOT NULL DEFAULT '', highlight INTEGER NOT NULL DEFAULT 0, move_to_top INTEGER NOT NULL DEFAULT 0,
 special_marking INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'uncompleted', source_item_id TEXT, source_kind TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS item_efile ON item(efile_id);
CREATE INDEX IF NOT EXISTS item_source ON item(source_item_id);
CREATE TABLE IF NOT EXISTS item_star(user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, PRIMARY KEY(user_id,item_id));
CREATE TABLE IF NOT EXISTS item_step(item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, position INTEGER NOT NULL, confirmed_by TEXT, confirmed_at TEXT, PRIMARY KEY(item_id,position));
CREATE TABLE IF NOT EXISTS item_link(
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, kind TEXT NOT NULL, target_efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE,
 target_item_id TEXT, change_sign INTEGER NOT NULL DEFAULT 0, split_amount INTEGER NOT NULL DEFAULT 0, step_efile_id TEXT, locked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_comment(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, user_id TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item_attachment(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, storage_key TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS process(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS process_stage(
 process_id TEXT NOT NULL REFERENCES process(id) ON DELETE CASCADE, position INTEGER NOT NULL, efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE,
 executor_id TEXT NOT NULL REFERENCES user(id), notify TEXT NOT NULL DEFAULT '[]', auto_commit INTEGER NOT NULL DEFAULT 0, confirm_balance INTEGER NOT NULL DEFAULT 0,
 PRIMARY KEY(process_id,position));
CREATE TABLE IF NOT EXISTS process_run(
 id TEXT PRIMARY KEY, process_id TEXT NOT NULL REFERENCES process(id) ON DELETE CASCADE, origin_item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
 stage_item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, stage INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, efile_id TEXT, item_id TEXT, read_at TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS system_log(id TEXT PRIMARY KEY, at TEXT NOT NULL, company_id TEXT NOT NULL, user_id TEXT NOT NULL, user_label TEXT NOT NULL, module TEXT NOT NULL, function TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'Web', content TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS system_log_at ON system_log(company_id,at);
`);

export type Row = Record<string, any>;
export const all = (q: string, ...a: any[]) => sql.prepare(q).all(...a) as Row[];
export const get = (q: string, ...a: any[]) => (sql.prepare(q).get(...a) as Row | undefined) ?? null;
export const run = (q: string, ...a: any[]) => sql.prepare(q).run(...a);
export function tx<T>(fn: () => T): T {
 sql.exec('BEGIN IMMEDIATE');
 try { const r = fn(); sql.exec('COMMIT'); return r; } catch (e) { sql.exec('ROLLBACK'); throw e; }
}
export const uid = () => crypto.randomUUID();
export const now = () => new Date().toISOString();
