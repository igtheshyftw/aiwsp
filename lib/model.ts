export type Row = {id:string;[key:string]:any};
export type State = {ownerEmail:string;companies:Row[];users:Row[];groups:Row[];files:Row[];items:Row[];invites:Row[];connections:Row[];notices:Row[];audit:Row[]};
export const permissions=['createFile','createItem','edit','download','export','submit','approve'];
export const defaults:any={1:permissions,2:permissions,3:['createFile','createItem','edit','download','submit','approve'],4:[]};
export function id(){return crypto.randomUUID()}
export function now(){return new Date().toISOString()}
export function fail(message:string):never{throw new Error(message)}
export function check(v:any,message='You do not have permission for this action.'):asserts v{if(!v)fail(message)}
export function text(v:any,max=200){return String(v??'').trim().slice(0,max)}
export function required(v:any,label='Name'){const s=text(v);check(s,`${label} is required.`);return s}
export function find(rows:Row[],v:string,label='Record'){return rows.find(x=>x.id===v)??fail(`${label} is unavailable.`)}
export function live(s:State,u:Row){return u.active&&(!u.expires||Date.parse(u.expires)>Date.now())&&s.companies.some(c=>c.id===u.companyId&&c.active)}
export function chief(s:State,u:Row,cid:string){return u.role==='system'||(u.companyId===cid&&u.role==='chief')}
export function manage(s:State,u:Row,cid:string,scope='users'){
 const c=find(s.companies,cid);if(u.role==='system')return c[scope==='users'?'systemUsers':'systemConnections']||!s.users.some(x=>x.companyId===cid&&x.role==='chief'&&live(s,x));
 return u.companyId===cid&&['chief','useradmin'].includes(u.role);
}
export function allowed(s:State,u:Row,key:string){if(['system','chief'].includes(u.role))return true;return u.permissions?.[key]??(find(s.companies,u.companyId).levels?.[u.level]??defaults[u.level]).includes(key)}
export function connection(s:State,owner:string,user:Row){
 if(owner===user.companyId)return true;
 return s.connections.some(c=>c.status==='connected'&&((c.from===owner&&c.to===user.companyId&&c.toUsers.includes(user.id))||(c.to===owner&&c.from===user.companyId&&c.fromUsers.includes(user.id))));
}
export function fileRole(s:State,u:Row,f:Row){
 if(!live(s,u)||!s.companies.some(c=>c.id===f.companyId&&c.active))return '';
 if(chief(s,u,f.companyId))return 'admin';
 if(!connection(s,f.companyId,u))return '';
 const roles=[f.members[u.id],...(f.groups??[]).filter((g:any)=>s.groups.some(x=>x.id===g.id&&x.members.includes(u.id))).map((g:any)=>g.role)];
 return ['admin','editor','viewer'].find(r=>roles.includes(r))??'';
}
export function can(s:State,u:Row,f:Row,key:string){const r=fileRole(s,u,f);return !!r&&(!f.archived||['view','download','export'].includes(key))&&(key==='view'||(key==='admin'?r==='admin':allowed(s,u,key)&&(['download','export','approve'].includes(key)||r!=='viewer')))}
export function audit(s:State,u:Row,action:string,target:string,cid:string,detail=''){s.audit.push({id:id(),at:now(),actor:u.id,actorName:u.name,action,target,companyId:cid,detail})}
export function notify(s:State,ids:string[],title:string,fileId='',itemId=''){for(const uid of new Set(ids))s.notices.push({id:id(),userId:uid,title,fileId,itemId,at:now(),read:false})}
export function admins(s:State,cid:string){return s.users.filter(u=>live(s,u)&&manage(s,u,cid)).map(u=>u.id)}
export function newState(email:string,name:string):State{const uid=id();return {ownerEmail:email,companies:[{id:'wsp',name:'WSP',chineseName:'',address:'',contact:name,email,phone:'',active:true,systemUsers:true,systemConnections:true,levels:defaults}],users:[{id:uid,name,username:'wsp-admin',companyId:'wsp',role:'system',level:1,permissions:{},active:true,expires:'',revision:0,email,owner:true}],groups:[],files:[],items:[],invites:[],connections:[],notices:[],audit:[]}}
export const starterFolders=[
 {id:'general',name:'General Administration',parentId:''},{id:'common',name:'Common data sharing',parentId:'general'},
 {id:'finance',name:'Accounting and Finance',parentId:''},{id:'cashier',name:'Cashier management',parentId:'finance'},{id:'accounting',name:'Accounting',parentId:'finance'},
 {id:'hr',name:'HR management',parentId:''},{id:'sales',name:'Sales management',parentId:''},{id:'customers',name:'Customers account setting',parentId:'sales'},{id:'customer-list',name:'Customers list',parentId:'customers'},{id:'receivables',name:'Accounts receivable',parentId:'sales'},
 {id:'procurement',name:'Procurement management',parentId:''},{id:'manufacturing',name:'Manufacturing',parentId:''}
];
export function workspacePreferences(u:Row){return u.workspacePrefs??{folders:structuredClone(starterFolders),files:{},items:{},search:{locked:false,query:'',field:'name'}}}
export function projection(s:State,u:Row){
 const fs=s.files.filter(f=>fileRole(s,u,f)); const cs=s.companies.filter(c=>u.role==='system'||c.id===u.companyId||fs.some(f=>f.companyId===c.id)||s.connections.some(x=>(x.from===u.companyId&&x.to===c.id&&(manage(s,u,u.companyId,'connections')||x.fromUsers.includes(u.id)))||(x.to===u.companyId&&x.from===c.id&&(manage(s,u,u.companyId,'connections')||x.toUsers.includes(u.id)))));
 const coids=cs.map(c=>c.id);
 const us=s.users.filter(x=>x.id===u.id||x.companyId===u.companyId||u.role==='system'||s.connections.some(c=>c.status==='connected'&&((c.from===u.companyId&&(manage(s,u,u.companyId,'connections')||c.fromUsers.includes(u.id))&&c.toUsers.includes(x.id))||(c.to===u.companyId&&(manage(s,u,u.companyId,'connections')||c.toUsers.includes(u.id))&&c.fromUsers.includes(x.id)))));
 const prefs=workspacePreferences(u);const visible=new Set(fs.map(f=>f.id));
 const personal={...prefs,files:Object.fromEntries(Object.entries(prefs.files).filter(([k])=>visible.has(k))),items:Object.fromEntries(Object.entries(prefs.items).filter(([k])=>s.items.some(i=>i.id===k&&visible.has(i.fileId))))};
 return {me:{...safeUser(u),workspacePrefs:personal,actions:permissions.filter(p=>allowed(s,u,p))},companies:cs.map(c=>({...c,canManage:manage(s,u,c.id),canConnect:manage(s,u,c.id,'connections'),canEdit:chief(s,u,c.id)})),users:us.map(x=>{const out=safeUser(x);if(!manage(s,u,x.companyId)&&x.id!==u.id){delete out.email;delete out.phone;delete out.username;delete out.permissions}return out}),groups:s.groups.filter(g=>g.companyId===u.companyId||u.role==='system'),files:fs.map(f=>({...f,access:fileRole(s,u,f),actions:['admin',...permissions,'view'].filter(k=>can(s,u,f,k))})),items:s.items.filter(i=>fs.some(f=>f.id===i.fileId)).map(i=>({...i,paused:i.status==='Pending'&&!s.users.some(a=>a.id===i.steps[i.step]?.userId&&live(s,a)&&can(s,a,find(s.files,i.fileId),'approve'))})),connections:s.connections.filter(c=>u.role==='system'||(c.from===u.companyId&&(manage(s,u,u.companyId,'connections')||c.fromUsers.includes(u.id)))||(c.to===u.companyId&&(manage(s,u,u.companyId,'connections')||c.toUsers.includes(u.id)))),invites:s.invites.filter(i=>manage(s,u,i.companyId)),notices:s.notices.filter(n=>n.userId===u.id).map(n=>n.fileId&&!fs.some(f=>f.id===n.fileId)?{...n,title:'Your access to a work item has changed.',fileId:'',itemId:''}:n),audit:s.audit.filter(a=>u.role==='system'||u.companyId===a.companyId&&['chief','useradmin'].includes(u.role)).slice(-300).reverse()};
}
export function safeUser(u:Row):Row{const {pass,salt,totpSecret,pendingTotp,resetHash,resetExpires,workspacePrefs,...v}=u;return {...v,hasPassword:!!pass,mfaEnabled:!!totpSecret}}
function participants(i:Row){return [i.createdBy,i.submittedBy,...i.steps.map((x:any)=>x.userId)].filter(Boolean)}
function cleanSteps(s:State,steps:any[],f:Row){check(Array.isArray(steps)&&steps.length<=100,'Use up to 100 steps per workflow.');return steps.map(x=>{const u=find(s.users,x.userId,'Approver');check(live(s,u)&&can(s,u,f,'approve'),'Each approver needs active access and approval permission.');return {name:required(x.name,'Step name'),userId:u.id,userName:u.name}})}
function snapshot(i:Row){return JSON.parse(JSON.stringify({...i,history:undefined}))}
export function mutate(s:State,u:Row,a:string,b:any):any{
 check(live(s,u),'This account is suspended or expired.');
 if(a==='workspace.search'){
  const p=workspacePreferences(u);p.search={locked:!!b.locked,query:text(b.query,200),field:b.field==='user'?'user':'name'};u.workspacePrefs=p;return {};
 }
 if(a==='workspace.organise'){
  const p=workspacePreferences(u);check(Array.isArray(b.ids)&&b.ids.length>0&&b.ids.length<=500,'Select between 1 and 500 records.');
  if(b.kind==='item'){
   check(typeof b.favorite==='boolean');for(const key of b.ids){const i=find(s.items,key);check(can(s,u,find(s.files,i.fileId),'view'));p.items[key]={favorite:b.favorite}}
  }else{
   for(const key of b.ids){const f=find(s.files,key);check(can(s,u,f,'view'));const v={...p.files[key]};
    if(typeof b.favorite==='boolean')v.favorite=b.favorite;
    if(typeof b.pinned==='boolean')v.pinned=b.pinned;
    if(typeof b.folderId==='string'){check(!b.folderId||p.folders.some((d:Row)=>d.id===b.folderId),'Folder is unavailable.');v.folderId=b.folderId}
    p.files[key]=v;
   }
  }
  u.workspacePrefs=p;return {};
 }
 if(a==='folder.save'){
  const p=workspacePreferences(u);check(p.folders.length<250||b.id,'Use up to 250 folders.');const folder=b.id?find(p.folders,b.id,'Folder'):{id:id()};const parentId=text(b.parentId);const name=required(b.name,'Folder name');
  check(!p.folders.some((x:Row)=>x.id!==folder.id&&x.parentId===parentId&&x.name.toLowerCase()===name.toLowerCase()),'This folder name already exists here.');
  let ancestor=parentId,depth=0;while(ancestor){check(ancestor!==folder.id,'A folder cannot contain itself.');ancestor=find(p.folders,ancestor,'Parent folder').parentId;check(++depth<=20,'Use up to 20 folder levels.')}
  folder.name=name;folder.parentId=parentId;if(!b.id)p.folders.push(folder);u.workspacePrefs=p;return {id:folder.id};
 }
 if(a==='folder.delete'){
  const p=workspacePreferences(u);find(p.folders,b.id,'Folder');check(!p.folders.some((x:Row)=>x.parentId===b.id),'Move or remove the subfolders first.');p.folders=p.folders.filter((x:Row)=>x.id!==b.id);for(const v of Object.values(p.files) as any[])if(v.folderId===b.id)v.folderId='';u.workspacePrefs=p;return {};
 }
 if(a==='company.save'){
  const existing=b.id?s.companies.find(c=>c.id===b.id):null;check(existing?chief(s,u,existing.id):u.role==='system');
  const c=existing??{id:id(),active:true,levels:structuredClone(defaults)};
  for(const k of ['name','chineseName','address','contact','email','phone'])c[k]=text(b[k]);required(c.name,'Company name');
  c.systemUsers=!!b.systemUsers;c.systemConnections=!!b.systemConnections;
  if(b.levels){check([1,2,3,4].every(l=>Array.isArray(b.levels[l])&&b.levels[l].every((p:string)=>permissions.includes(p))),'Invalid permission defaults.');c.levels=b.levels}
  if(!existing)s.companies.push(c);audit(s,u,existing?'Updated company':'Created company',c.name,c.id);return {id:c.id};
 }
 if(a==='company.status'){const c=find(s.companies,b.id);check(u.role==='system'&&c.id!=='wsp');c.active=!!b.active;audit(s,u,c.active?'Activated company':'Suspended company',c.name,c.id);return {}}
 if(a==='user.save'){
  const t=find(s.users,b.id);check(manage(s,u,t.companyId));check(t.id!==u.id,'Use Account settings for your own profile.');check(t.role!=='system'||u.role==='system');
  const role=b.role??t.role;check(['system','chief','useradmin','member'].includes(role));check(role!=='system'||u.role==='system');check(role!=='chief'||u.role==='system');check(t.role!=='chief'||u.role==='system');
  if(u.role==='useradmin'){check(role==='member'&&t.role==='member','Only a Chief Admin can appoint a User Admin.');for(const p of permissions)if(b.permissions?.[p])check(allowed(s,u,p),'You cannot grant a permission you do not hold.');check(Number(b.level)>=Number(u.level),'You cannot grant a higher level.');}
  if(t.role==='system'&&(role!=='system'||b.active===false))check(s.users.some(x=>x.id!==t.id&&x.role==='system'&&live(s,x)),'Keep at least one active System Admin.');
  if(role==='chief')for(const x of s.users)if(x.companyId===t.companyId&&x.role==='chief'&&x.id!==t.id){x.role='member';x.level=3;x.revision++}
  t.name=required(b.name);t.role=role;t.level=['system','chief'].includes(role)?1:Number(b.level);check([1,2,3,4].includes(t.level));t.active=b.active!==false;t.permissions=Object.fromEntries(permissions.filter(k=>typeof b.permissions?.[k]==='boolean').map(k=>[k,b.permissions[k]]));t.expires=text(b.expires);if(t.level===4)check(t.expires&&Date.parse(t.expires)>Date.now(),'Temporary accounts need a future expiry date.');t.revision++;
  audit(s,u,'Changed user access',t.name,t.companyId);notify(s,[t.id],'Your account access has changed.');return {};
 }
 if(a==='group.save'){const c=find(s.companies,b.companyId);check(manage(s,u,c.id));const g=b.id?find(s.groups,b.id):{id:id(),companyId:c.id};check(g.companyId===c.id);g.name=required(b.name);g.members=[...new Set<string>(b.members??[])];check(g.members.every((uid:string)=>s.users.some(x=>x.id===uid&&x.companyId===c.id)),'Groups contain users of their own company.');if(!b.id)s.groups.push(g);audit(s,u,'Updated group',g.name,c.id);return {}}
 if(a==='invite.create'){const c=find(s.companies,b.companyId);check(manage(s,u,c.id));const inv={id:id(),token:id()+id(),companyId:c.id,expires:new Date(Date.now()+7*86400000).toISOString(),active:true};s.invites.push(inv);audit(s,u,'Created registration invitation',c.name,c.id);return inv}
 if(a==='invite.revoke'){const inv=find(s.invites,b.id);check(manage(s,u,inv.companyId));inv.active=false;audit(s,u,'Revoked registration invitation','Invitation',inv.companyId);return {}}
 if(a==='connection.request'){
  check(b.from!==b.to);check(manage(s,u,b.from,'connections'));find(s.companies,b.to);check(!s.connections.some(c=>[c.from,c.to].includes(b.from)&&[c.from,c.to].includes(b.to)&&c.status!=='revoked'),'A connection already exists.');
  const x={id:id(),from:b.from,to:b.to,status:'requested',fromUsers:(b.users??[]).filter((v:string)=>s.users.some(z=>z.id===v&&z.companyId===b.from)),toUsers:[]};s.connections.push(x);notify(s,admins(s,b.to),'A company connection needs your response.');audit(s,u,'Requested company connection',find(s.companies,b.to).name,b.from);return {};
 }
 if(a==='connection.update'){const x=find(s.connections,b.id);const cid=b.companyId;check([x.from,x.to].includes(cid)&&manage(s,u,cid,'connections'));if(b.status==='connected')check(cid===x.to&&x.status==='requested','Only the receiving company can accept.');if(b.status){check(['connected','revoked'].includes(b.status));x.status=b.status}const k=cid===x.from?'fromUsers':'toUsers';x[k]=(b.users??[]).filter((v:string)=>s.users.some(z=>z.id===v&&z.companyId===cid));audit(s,u,'Updated connection',find(s.companies,cid).name,cid);return {}}
 if(a==='file.save'){
  const prev=b.id?find(s.files,b.id):null;const cid=prev?.companyId??b.companyId;find(s.companies,cid);check(prev?can(s,u,prev,'admin'):(chief(s,u,cid)||(u.companyId===cid&&allowed(s,u,'createFile'))));
  const f=prev??{id:id(),companyId:cid,createdBy:u.id,createdAt:now(),version:0,archived:false};if(prev)check(b.version===f.version,'This eFile changed. Refresh and try again.');
  const members:any=b.members??{};check(Object.values(members).every(r=>['viewer','editor','admin'].includes(String(r))));for(const uid of Object.keys(members)){const t=find(s.users,uid);check(live(s,t)&&(t.role==='system'||connection(s,cid,t)),'A selected user is not an approved company contact.');if(t.companyId!==cid&&members[uid]==='admin')check(chief(s,u,cid),'Only Chief Admin can appoint an external eFile Admin.')}
  if(!prev)members[u.id]='admin';f.name=required(b.name,'eFile name');check(!s.files.some(x=>x.id!==f.id&&x.companyId===cid&&!x.archived&&x.name.toLowerCase()===f.name.toLowerCase()),'An active eFile already has this name.');
  const curr=text(b.currency).toUpperCase();if(b.amountEnabled)check(/^[A-Z]{3}$/.test(curr),'Select a currency.');if(prev&&s.items.some(i=>i.fileId===f.id&&i.amount!==''))check(f.currency===curr,'Currency cannot change after amounts are recorded.');
  f.members=members;f.groups=(b.groups??[]).map((g:any)=>{check(s.groups.some(x=>x.id===g.id&&x.companyId===cid));return {id:g.id,role:['admin','editor','viewer'].includes(g.role)?g.role:'viewer'}});f.dateEnabled=!!b.dateEnabled;f.amountEnabled=!!b.amountEnabled;f.currency=curr||'USD';f.steps=cleanSteps(s,b.steps??[],f);f.approval=!!b.approval;if(f.approval)check(f.steps.length,'Add at least one approval step.');f.version++;f.updatedAt=now();if(!prev){s.files.push(f);const p=workspacePreferences(u);p.files[f.id]={favorite:true};u.workspacePrefs=p}audit(s,u,prev?'Updated eFile':'Created eFile',f.name,cid);return {id:f.id};
 }
 if(a==='file.export'){const f=find(s.files,b.id);check(can(s,u,f,'export'));audit(s,u,'Exported records',f.name,f.companyId);return {eFile:f,items:s.items.filter(i=>i.fileId===f.id),exportedAt:now()}}
 if(a==='file.archive'){const f=find(s.files,b.id);check(can(s,u,f,'admin')||chief(s,u,f.companyId));check(!s.items.some(i=>i.fileId===f.id&&i.status==='Pending'),'Resolve pending approvals before archiving.');f.archived=!!b.archived;f.version++;audit(s,u,f.archived?'Archived eFile':'Restored eFile',f.name,f.companyId);return {}}
 if(a==='user.replace'){
  const from=find(s.users,b.from),to=find(s.users,b.to);check(manage(s,u,from.companyId)&&from.companyId===to.companyId&&from.id!==to.id&&live(s,to));
  let count=0;for(const fid of b.fileIds??[]){const f=find(s.files,fid);check(can(s,u,f,'admin'),'You need eFile administration rights to transfer these roles.');check(connection(s,f.companyId,to));if(f.members[from.id]){f.members[to.id]=f.members[from.id];delete f.members[from.id]}for(const st of f.steps)if(st.userId===from.id){check(can(s,to,f,'approve'));st.userId=to.id;st.userName=to.name}for(const i of s.items.filter(x=>x.fileId===fid&&x.status==='Pending'))for(let k=i.step;k<i.steps.length;k++)if(i.steps[k].userId===from.id){check(can(s,to,f,'approve')&&!i.editors.includes(to.id),'Replacement is not an eligible independent approver.');i.steps[k].userId=to.id;i.steps[k].userName=to.name;i.version++;i.events.push({at:now(),actor:u.name,action:'Reassigned approval',note:`${from.name} to ${to.name}`})}f.version++;count++}audit(s,u,'Transferred eFile duties',`${from.name} → ${to.name}`,from.companyId,`${count} eFiles`);return {count};
 }
 if(a==='notice.read'){for(const n of s.notices)if(n.userId===u.id&&(!b.id||n.id===b.id))n.read=true;return {}}
 const f=b.fileId?find(s.files,b.fileId):b.id&&s.items.some(x=>x.id===b.id)?find(s.files,find(s.items,b.id).fileId):null;
 if(a==='item.save'){
  check(f&&can(s,u,f,'createItem'));const old=b.id?find(s.items,b.id):null;if(old){check(old.fileId===f.id&&old.status==='Draft'&&!old.locked&&can(s,u,f,'edit'));check(old.createdBy===u.id||can(s,u,f,'admin'),'Only its creator or eFile Admin can edit this draft.');check(old.version===b.version,'This item changed. Refresh before editing.')}
  const i=old??{id:id(),fileId:f.id,createdBy:u.id,createdAt:now(),status:'Draft',locked:false,revision:1,version:0,attachments:[],history:[],events:[],steps:[],step:0,editors:[]};
  i.name=required(b.name,'Item name');i.notes=text(b.notes,5000);i.amount=f.amountEnabled?text(b.amount,30):'';if(i.amount)check(/^-?\d{1,12}(\.\d{1,2})?$/.test(i.amount),'Enter an amount with up to two decimal places.');i.date=f.dateEnabled?text(b.date):'';if(i.date)check(/^\d{4}-\d{2}-\d{2}$/.test(i.date)&&!isNaN(Date.parse(i.date)),'Invalid date.');i.currency=f.currency;i.editors=[...new Set([...i.editors,u.id])];i.version++;i.updatedAt=now();if(!old)s.items.push(i);audit(s,u,old?'Edited draft':'Created item',i.name,f.companyId);return {id:i.id};
 }
 if(a.startsWith('item.')){
  check(f&&can(s,u,f,'view'));const i=find(s.items,b.id);check(i.version===b.version,'This item has changed. Refresh and try again.');const note=text(b.note,1000);const admin=can(s,u,f,'admin');
  if(a==='item.submit'){
   check(can(s,u,f,'submit')&&i.status==='Draft'&&!i.locked);check(i.createdBy===u.id||admin);i.steps=f.approval?cleanSteps(s,f.steps,f):[];if(f.approval)check(i.steps.length,'Approval steps are missing.');check(i.steps.every((st:any)=>!i.editors.includes(st.userId)&&st.userId!==u.id&&st.userId!==i.createdBy),'Choose an independent approver. A creator, submitter or editor cannot approve their own item.');i.status=f.approval?'Pending':'Finalised';i.step=0;i.locked=true;i.submittedBy=u.id;i.submittedAt=now();if(i.steps[0])notify(s,[i.steps[0].userId],`Approval needed: ${i.name}`,f.id,i.id);
  }else if(a==='item.decide'){
   check(i.status==='Pending'&&i.steps[i.step]?.userId===u.id&&can(s,u,f,'approve')&&!i.editors.includes(u.id)&&i.submittedBy!==u.id&&i.createdBy!==u.id);check(['Approve','Return','Reject'].includes(b.decision));if(b.decision!=='Approve')required(note,'Reason');const step=i.steps[i.step];step.decision=b.decision;step.at=now();step.note=note;step.actor=u.name;
   if(b.decision==='Approve'){i.step++;if(i.step===i.steps.length)i.status='Approved';else notify(s,[i.steps[i.step].userId],`Approval needed: ${i.name}`,f.id,i.id)}else i.status=b.decision==='Return'?'Returned':'Rejected';
   if(i.status!=='Pending')notify(s,participants(i),`${i.name}: ${i.status}`,f.id,i.id);
  }else if(a==='item.withdraw'){check(i.status==='Pending'&&i.submittedBy===u.id);required(note,'Reason');i.status='Withdrawn';notify(s,participants(i),`${i.name}: Withdrawn`,f.id,i.id)
  }else if(a==='item.revise'){check(['Returned','Rejected','Withdrawn','Approved','Finalised','Overridden'].includes(i.status));check((['Returned','Rejected','Withdrawn'].includes(i.status)&&i.createdBy===u.id&&can(s,u,f,'edit'))||admin);required(note,'Reason');i.history.push(snapshot(i));i.revision++;i.status='Draft';i.locked=false;i.steps=[];i.step=0;i.submittedBy='';i.editors=[u.id];
  }else if(a==='item.lock'){check(admin&&i.status==='Draft');i.locked=!i.locked;
  }else if(a==='item.reassign'){check(admin&&i.status==='Pending');required(note,'Reason');const t=find(s.users,b.userId);check(live(s,t)&&can(s,t,f,'approve')&&!i.editors.includes(t.id)&&i.createdBy!==t.id&&i.submittedBy!==t.id,'Choose an eligible independent approver.');i.steps[i.step].userId=t.id;i.steps[i.step].userName=t.name;notify(s,participants(i),`Approver changed: ${i.name}`,f.id,i.id);
  }else if(a==='item.override'){check(u.role==='system'&&i.status==='Pending');required(note,'Reason');i.status='Overridden';notify(s,participants(i),`Administrative override: ${i.name}`,f.id,i.id);
  }else if(a==='item.comment'){required(note,'Comment');
  }else fail('Unknown action.');
  i.version++;i.updatedAt=now();i.events.push({at:now(),actor:u.name,action:a==='item.decide'?b.decision:a.slice(5),note});audit(s,u,a==='item.decide'?b.decision:a.slice(5),i.name,f.companyId,note);return {id:i.id};
 }
 fail('Unknown action.');
}
