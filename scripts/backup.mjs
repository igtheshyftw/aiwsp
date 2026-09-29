// Consistent backup of the database and attachments while the server keeps running (npm run backup).
// Writes BACKUP_DIR/ims-YYYYMMDD-HHMMSS/{ims.sqlite, uploads/}. Copy that folder off the server (for example to Alibaba Cloud OSS).
import {DatabaseSync} from 'node:sqlite';
import {cp, mkdir, readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve, join} from 'node:path';

const data = resolve(process.env.DATA_DIR || 'data');
const target = join(resolve(process.env.BACKUP_DIR || 'backups'), 'ims-' + new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15));
if (!existsSync(join(data, 'aiwsp.sqlite'))) { console.error(`No database found in ${data}. Set DATA_DIR.`); process.exit(1); }
await mkdir(target, {recursive: true, mode: 0o700});
const db = new DatabaseSync(join(data, 'aiwsp.sqlite'));
db.exec(`VACUUM INTO '${join(target, 'ims.sqlite').replace(/'/g, "''")}'`);
db.close();
if (existsSync(join(data, 'uploads'))) await cp(join(data, 'uploads'), join(target, 'uploads'), {recursive: true});
const count = existsSync(join(target, 'uploads')) ? (await readdir(join(target, 'uploads'), {recursive: true})).length : 0;
console.log(`Backup written to ${target} (database + ${count} attachment entries).`);
