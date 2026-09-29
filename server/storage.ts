import {DatabaseSync} from 'node:sqlite';
import {mkdirSync} from 'node:fs';
import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';

export const dataDirectory=resolve(process.env.DATA_DIR||'data');
mkdirSync(dataDirectory,{recursive:true,mode:0o700});
export const sql=new DatabaseSync(resolve(dataDirectory,'aiwsp.sqlite'));
sql.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS workspace(id TEXT PRIMARY KEY,body TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 0);
 CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,revision INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS throttle(id TEXT PRIMARY KEY,count INTEGER NOT NULL,expires INTEGER NOT NULL);`);
export const database={
 prepare(query:string){
  const statement=sql.prepare(query);let args:any[]=[];
  return {
   bind(...values:any[]){args=values;return this},
   async first(){return statement.get(...args)??null},
   async all(){return {results:statement.all(...args)}},
   async run(){const result=statement.run(...args);return {meta:{changes:Number(result.changes)}}}
  };
 }
};
const uploads=resolve(dataDirectory,'uploads');mkdirSync(uploads,{recursive:true,mode:0o700});
function location(key:string){const path=resolve(uploads,key);if(!path.startsWith(uploads+sep))throw Error('Invalid attachment location.');return path}
export const attachments={async put(key:string,body:ArrayBuffer,_options?:unknown){const path=location(key);await mkdir(dirname(path),{recursive:true,mode:0o700});const temp=path+'.'+crypto.randomUUID()+'.tmp';await writeFile(temp,new Uint8Array(body),{mode:0o600});await rename(temp,path)},async get(key:string){try{return {body:new Uint8Array(await readFile(location(key)))}}catch(e:any){if(e.code==='ENOENT')return null;throw e}},async delete(key:string){try{await unlink(location(key))}catch(e:any){if(e.code!=='ENOENT')throw e}}};
export function closeDatabase(){sql.close()}
