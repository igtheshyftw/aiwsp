// Schema for IMS screens with AiWSP rules (docs/aiwsp/urgent-functions.md). Money is stored as integer cents; a blank amount is NULL.
import {sql} from './storage';

const SCHEMA_VERSION = 2;
const version = (sql.prepare('PRAGMA user_version').get() as any).user_version as number;
const hasUsers = !!sql.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='user'`).get();
if (hasUsers && version < SCHEMA_VERSION) {
 throw Error('This data directory was created by an earlier test build of IMS. Move it aside (or delete demo-data) and start again with an empty DATA_DIR.');
}

sql.exec(`
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS company(
 id TEXT PRIMARY KEY, name_cn TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT '', code TEXT NOT NULL DEFAULT '',
 city TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', contact TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'normal', operator INTEGER NOT NULL DEFAULT 0,
 sys_manage_users INTEGER NOT NULL DEFAULT 0, sys_manage_connections INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
-- Four authorization levels per company, defined by function checkboxes (Account → Role).
CREATE TABLE IF NOT EXISTS level(company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE, level INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', perms TEXT NOT NULL, PRIMARY KEY(company_id, level));
CREATE TABLE IF NOT EXISTS user(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), username TEXT NOT NULL UNIQUE COLLATE NOCASE,
 name_cn TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '', sex TEXT NOT NULL DEFAULT '', dept TEXT NOT NULL DEFAULT '',
 email TEXT NOT NULL DEFAULT '', mobile TEXT NOT NULL DEFAULT '',
 position TEXT NOT NULL DEFAULT 'member', level INTEGER NOT NULL DEFAULT 3, perms TEXT NOT NULL DEFAULT '{}',
 expires TEXT NOT NULL DEFAULT '', responsible_id TEXT, state TEXT NOT NULL DEFAULT 'normal',
 salt TEXT NOT NULL DEFAULT '', pass TEXT NOT NULL DEFAULT '', totp_secret TEXT NOT NULL DEFAULT '', totp_pending TEXT NOT NULL DEFAULT '',
 reset_hash TEXT NOT NULL DEFAULT '', reset_expires TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS invite(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE, token TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL, expires TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
-- Client-to-client connections: both companies confirm, each designates its staff.
CREATE TABLE IF NOT EXISTS connection(id TEXT PRIMARY KEY, from_company TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE, to_company TEXT NOT NULL REFERENCES company(id) ON DELETE CASCADE, status TEXT NOT NULL DEFAULT 'requested', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS connection_user(connection_id TEXT NOT NULL REFERENCES connection(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, PRIMARY KEY(connection_id, user_id));
CREATE TABLE IF NOT EXISTS user_group(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, share INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS user_group_member(group_id TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, PRIMARY KEY(group_id,user_id));
CREATE TABLE IF NOT EXISTS client(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), code TEXT NOT NULL DEFAULT '', name_cn TEXT NOT NULL DEFAULT '', name_en TEXT NOT NULL DEFAULT '',
 contact TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', remark TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS efile(
 id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, tag TEXT NOT NULL DEFAULT '',
 select_type TEXT NOT NULL DEFAULT 'user_and_group', highlight INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '', report_name TEXT NOT NULL DEFAULT '',
 show_date INTEGER NOT NULL DEFAULT 1, show_amount INTEGER NOT NULL DEFAULT 1, currency TEXT NOT NULL DEFAULT 'CNY', approval INTEGER NOT NULL DEFAULT 0,
 balance INTEGER NOT NULL DEFAULT 0, balance_alias TEXT NOT NULL DEFAULT '', notional INTEGER NOT NULL DEFAULT 0, notional_alias TEXT NOT NULL DEFAULT '',
 password TEXT NOT NULL DEFAULT '', archived INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
-- kind: participant (right: view|edit), admin, wechat
CREATE TABLE IF NOT EXISTS efile_member(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, kind TEXT NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, rights TEXT NOT NULL DEFAULT 'edit', PRIMARY KEY(efile_id,kind,user_id));
CREATE TABLE IF NOT EXISTS efile_group(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, kind TEXT NOT NULL, group_id TEXT NOT NULL REFERENCES user_group(id) ON DELETE CASCADE, rights TEXT NOT NULL DEFAULT 'edit', PRIMARY KEY(efile_id,kind,group_id));
-- Approval ("Confirmation") steps: ordered names and eligible approvers. Changes apply to future submissions only.
CREATE TABLE IF NOT EXISTS efile_step(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, position INTEGER NOT NULL, title TEXT NOT NULL DEFAULT '', PRIMARY KEY(efile_id,position));
CREATE TABLE IF NOT EXISTS efile_step_user(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, position INTEGER NOT NULL, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, PRIMARY KEY(efile_id,position,user_id));
CREATE TABLE IF NOT EXISTS user_efile(
 user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE,
 in_my INTEGER, hidden INTEGER NOT NULL DEFAULT 0, mtt INTEGER NOT NULL DEFAULT 0, link INTEGER NOT NULL DEFAULT 0, color TEXT NOT NULL DEFAULT '', PRIMARY KEY(user_id,efile_id));
CREATE TABLE IF NOT EXISTS efile_share(efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, balance INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(efile_id,user_id));
CREATE TABLE IF NOT EXISTS system_link(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL, url TEXT NOT NULL, created_at TEXT NOT NULL);
-- status: draft | pending | returned | rejected | withdrawn | approved | none (eFile needs no approval)
CREATE TABLE IF NOT EXISTS item(
 id TEXT PRIMARY KEY, seq INTEGER NOT NULL UNIQUE, efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE, name TEXT NOT NULL, amount INTEGER, currency TEXT NOT NULL DEFAULT '',
 item_date TEXT NOT NULL DEFAULT '', target_date TEXT NOT NULL DEFAULT '', highlight INTEGER NOT NULL DEFAULT 0, move_to_top INTEGER NOT NULL DEFAULT 0,
 special_marking INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft', steps TEXT NOT NULL DEFAULT '[]', round INTEGER NOT NULL DEFAULT 0,
 locked INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0, done INTEGER NOT NULL DEFAULT 0, version INTEGER NOT NULL DEFAULT 1,
 editors TEXT NOT NULL DEFAULT '[]', submitted_by TEXT, source_item_id TEXT, source_kind TEXT NOT NULL DEFAULT '',
 created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS item_efile ON item(efile_id);
CREATE INDEX IF NOT EXISTS item_source ON item(source_item_id);
-- Approval steps of each submission round: a snapshot of the step name and eligible approvers at submission time.
CREATE TABLE IF NOT EXISTS item_step(item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, round INTEGER NOT NULL, position INTEGER NOT NULL, title TEXT NOT NULL,
 approvers TEXT NOT NULL, decision TEXT, decided_by TEXT, decided_at TEXT, note TEXT NOT NULL DEFAULT '', PRIMARY KEY(item_id, round, position));
CREATE TABLE IF NOT EXISTS item_version(item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, version INTEGER NOT NULL, snapshot TEXT NOT NULL, by TEXT NOT NULL, at TEXT NOT NULL, PRIMARY KEY(item_id, version));
CREATE TABLE IF NOT EXISTS item_event(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, at TEXT NOT NULL, actor_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', override INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_star(user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, PRIMARY KEY(user_id,item_id));
CREATE TABLE IF NOT EXISTS item_link(
 id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, kind TEXT NOT NULL, target_efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE,
 target_item_id TEXT, change_sign INTEGER NOT NULL DEFAULT 0, split_amount INTEGER NOT NULL DEFAULT 0, step_efile_id TEXT, locked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS item_comment(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, user_id TEXT NOT NULL, body TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS item_attachment(id TEXT PRIMARY KEY, item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, storage_key TEXT NOT NULL, filename TEXT NOT NULL, size INTEGER NOT NULL, content_type TEXT NOT NULL DEFAULT 'application/octet-stream', uploaded_by TEXT NOT NULL DEFAULT '', at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS process(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS process_stage(
 process_id TEXT NOT NULL REFERENCES process(id) ON DELETE CASCADE, position INTEGER NOT NULL, efile_id TEXT NOT NULL REFERENCES efile(id) ON DELETE CASCADE,
 executor_id TEXT NOT NULL REFERENCES user(id), notify TEXT NOT NULL DEFAULT '[]', auto_commit INTEGER NOT NULL DEFAULT 0, confirm_balance INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(process_id,position));
CREATE TABLE IF NOT EXISTS process_run(
 id TEXT PRIMARY KEY, process_id TEXT NOT NULL REFERENCES process(id) ON DELETE CASCADE, origin_item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE,
 stage_item_id TEXT NOT NULL REFERENCES item(id) ON DELETE CASCADE, stage INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notification(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, kind TEXT NOT NULL, title TEXT NOT NULL, efile_id TEXT, item_id TEXT, read_at TEXT, at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS system_log(id TEXT PRIMARY KEY, at TEXT NOT NULL, company_id TEXT NOT NULL, user_id TEXT NOT NULL, user_label TEXT NOT NULL, module TEXT NOT NULL, function TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'Web', content TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS system_log_at ON system_log(company_id,at);
-- AiWSP Assistant: client conversations answered by the agent (server/agent.ts) with WSP staff able to review, take over and reply.
-- status: open (agent answers) | waiting (handed to staff) | closed
CREATE TABLE IF NOT EXISTS chat_conversation(id TEXT PRIMARY KEY, company_id TEXT NOT NULL REFERENCES company(id), user_id TEXT NOT NULL REFERENCES user(id),
 title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', assigned_to TEXT, agent_on INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_conversation_user ON chat_conversation(user_id, updated_at);
-- role: client | agent | staff | note (staff-only) | system. state: sent | thinking | review (agent draft waiting for staff) | discarded
CREATE TABLE IF NOT EXISTS chat_message(id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL REFERENCES chat_conversation(id) ON DELETE CASCADE, role TEXT NOT NULL,
 author_id TEXT, author TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'sent', meta TEXT NOT NULL DEFAULT '{}', rating INTEGER,
 reviewed_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS chat_message_conv ON chat_message(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS chat_read(user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE, conversation_id TEXT NOT NULL REFERENCES chat_conversation(id) ON DELETE CASCADE, at TEXT NOT NULL, PRIMARY KEY(user_id, conversation_id));
CREATE TABLE IF NOT EXISTS assistant_setting(id INTEGER PRIMARY KEY CHECK (id=1), enabled INTEGER NOT NULL DEFAULT 1, review INTEGER NOT NULL DEFAULT 0,
 name TEXT NOT NULL DEFAULT 'AiWSP Assistant', welcome TEXT NOT NULL DEFAULT '', disclaimer TEXT NOT NULL DEFAULT '', suggestions TEXT NOT NULL DEFAULT '[]');
INSERT OR IGNORE INTO assistant_setting(id, welcome, disclaimer, suggestions) VALUES(1,
 'Hello. I can answer questions about your matters with WSP. A WSP professional can join the conversation at any time.',
 'Answers are general information prepared with AI assistance and reviewed by WSP professionals where needed. They are not formal advice until confirmed in writing.',
 '["What documents do you need from us for this month?","What is the status of our latest submission?","Can I speak to someone at WSP?"]');
PRAGMA user_version=${SCHEMA_VERSION};
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
export const nextSeq = () => (get('SELECT COALESCE(MAX(seq),0)+1 AS n FROM item')!.n as number);
