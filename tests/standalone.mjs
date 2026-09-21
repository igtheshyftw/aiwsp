import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {randomBytes} from 'node:crypto';
const directory=await mkdtemp(join(tmpdir(),'aiwsp-test-'));
const probe=createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));
const base='http://localhost:'+port;const password='Test-'+randomBytes(24).toString('hex');let child,cookie='';
async function start(){child=spawn(process.execPath,['dist/server.mjs'],{env:{...process.env,PORT:String(port),PUBLIC_URL:base,DATA_DIR:directory,ADMIN_USERNAME:'wsp-admin',ADMIN_PASSWORD:password},stdio:['ignore','pipe','pipe']});await new Promise((resolve,reject)=>{let logs='';const timer=setTimeout(()=>reject(Error('Server startup timed out: '+logs)),15000);child.stderr.on('data',x=>logs+=x);child.stdout.on('data',x=>{logs+=x;if(logs.includes('listening on port')){clearTimeout(timer);resolve()}});child.once('exit',code=>{clearTimeout(timer);reject(Error('Startup failed: '+code+' '+logs))})})}
async function stop(){if(child&&child.exitCode===null){const stopped=new Promise(r=>child.once('exit',r));child.kill('SIGTERM');await stopped}}
async function get(session=cookie,headers={}){const r=await fetch(base+'/api/workspace',{headers:{cookie:session,...headers}});return (await r.json()).data}
async function post(action,body={},session=cookie,ok=true){const r=await fetch(base+'/api/workspace',{method:'POST',headers:{origin:base,'content-type':'application/json',cookie:session},body:JSON.stringify({action,...body})});const j=await r.json();if(ok)assert.equal(r.status,200,j.error);else assert.notEqual(r.status,200);return {...j,cookie:r.headers.get('set-cookie')?.split(';')[0]}}
try{
 await start();
 assert.equal((await fetch(base+'/healthz')).status,200);
 assert((await (await fetch(base)).text()).includes('AiWSP'));
 assert.equal(await get('',{'oai-authenticated-user-email':'owner@test.local'}),null,'Spoofed identity must not grant access.');
 await post('owner.login',{},'',false);
 cookie=(await post('login',{username:'wsp-admin',password})).cookie;
 let data=await get();assert.equal(data.me.role,'system');const root=data.me.id;
 const company=(await post('company.save',{name:'Test Company',systemUsers:true,systemConnections:true})).result.id;
 const inv=(await post('invite.create',{companyId:company})).result;
 const registered=await post('register',{token:inv.token,name:'Member',username:'member',phone:'12345',password,confirm:password},'');const memberCookie=registered.cookie;
 data=await get(memberCookie);assert.equal(data.me.level,3);assert.equal(data.me.active,true);const member=data.me.id;
 const file=(await post('file.save',{companyId:company,name:'Invoices',members:{[root]:'admin',[member]:'editor'},groups:[],steps:[],approval:false,dateEnabled:true,amountEnabled:true,currency:'USD'})).result.id;
 const item=(await post('item.save',{fileId:file,name:'Invoice one',date:'2026-09-18',amount:'100',notes:''},memberCookie)).result.id;
 let record=(await get(memberCookie)).items.find(i=>i.id===item);
 const upload=new FormData();upload.set('itemId',item);upload.set('version',String(record.version));upload.set('file',new Blob(['Sample invoice'],{type:'text/plain'}),'invoice.txt');
 let response=await fetch(base+'/api/attachment',{method:'POST',headers:{origin:base,cookie:memberCookie},body:upload});assert.equal(response.status,200,await response.text());
 record=(await get(memberCookie)).items.find(i=>i.id===item);const attachment=record.attachments[0].id;
 response=await fetch(base+'/api/attachment?id='+attachment,{headers:{cookie:memberCookie}});assert.equal(await response.text(),'Sample invoice');
 await post('workspace.organise',{ids:[file],favorite:true,pinned:true,folderId:'accounting'},memberCookie);
 assert.equal((await get(memberCookie)).me.workspacePrefs.files[file].pinned,true);
 await post('item.submit',{id:item,version:record.version},memberCookie);
 record=(await get(memberCookie)).items.find(i=>i.id===item);assert.equal(record.status,'Finalised');
 await post('item.save',{...record,name:'Forbidden edit'},memberCookie,false);
 const csrf=await fetch(base+'/api/workspace',{method:'POST',headers:{origin:'https://wrong.example','content-type':'application/json',cookie},body:JSON.stringify({action:'company.save',name:'Wrong origin'})});assert.notEqual(csrf.status,200);
 await stop();await start();
 assert((await get()).files.some(f=>f.id===file),'Records must survive a server restart.');
 assert.equal(await (await fetch(base+'/api/attachment?id='+attachment,{headers:{cookie:memberCookie}})).text(),'Sample invoice');
 const old=cookie;await post('logout');assert.equal(await get(old),null,'Logout must revoke the server-side session.');
 console.log('PASS: standalone startup, sign-in, spoofed-header rejection, immediate registration, saved records, uploads/downloads, personal organisation, record locking, CSRF rejection, restart persistence and logout revocation.');
}finally{await stop();await rm(directory,{recursive:true,force:true})}
