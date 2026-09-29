// Account menu: Company, User, Role, User Group, System Log; and My Profile.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, today, monthAgo, fmtTime, colorClass} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, FormPanel, FieldRow, Tool, ToolMenu, RowMenu, toast, toastError, confirmBox, formBox, pickBox, chooseBox, type Me, type MenuItem} from '../ui';

const acct = (label: string) => [{label: 'Account Management'}, {label}];

// ---------------- Company
export function CompanyList({me}: {me: Me}) {
 const {data, error, reload} = useLoad(() => api<any[]>('company.list'), []);
 const [sel, setSel] = useState<string[]>([]);
 const toggle = async (c: any) => { try { await api('company.save', {...c, status: c.status === 'normal' ? 'suspended' : 'normal'}); reload(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={acct('Company Management')}/>
  <Panel title={<>Company List › {me.company.name_en || me.company.name_cn}</>} tools={me.sys && <Tool icon="fa-plus" title="Add" className="boxed" onClick={() => go('/account/company/new')}/>}>
   {data ? <DataTable rows={data} selectable selected={sel} onSelect={setSel}
    columns={[
     {key: 'menu', title: '', width: 60, sort: undefined, render: c => <RowMenuInline items={[
      {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/company/${c.id}`)},
      {icon: 'fa-users', label: 'User List', onClick: () => go(`/account/user?company=${c.id}`)},
      ...(me.sys && c.id !== me.company.id ? [{icon: c.status === 'normal' ? 'fa-ban' : 'fa-check', label: c.status === 'normal' ? 'Suspend' : 'Set Normal', onClick: () => toggle(c)}] : []),
     ]}/>},
     {key: 'name_cn', title: 'Name', sort: r => r.name_cn},
     {key: 'name_en', title: 'English Name', sort: r => r.name_en},
     {key: 'type', title: 'Type', sort: r => r.type},
     {key: 'code', title: 'Code', sort: r => r.code},
     {key: 'city', title: 'City', sort: r => r.city},
     {key: 'status', title: 'Status', sort: r => r.status, render: r => r.status === 'normal' ? 'Normal' : 'Suspended'},
    ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}
// The purple row button placed inside a normal column (Company list shows it second).
const RowMenuInline = ({items}: {items: MenuItem[]}) => <RowMenu items={items}/>;

export function CompanyForm({id}: {id?: string}) {
 const [f, setF] = useState<any>({name_cn: '', name_en: '', type: 'Communicative', code: '', city: '', status: 'normal'});
 const [types, setTypes] = useState<string[]>([]);
 useEffect(() => {
  api<string[]>('company.types').then(setTypes).catch(toastError);
  if (id) api('company.get', {id}).then(r => setF(r.company)).catch(toastError);
 }, [id]);
 const save = async () => { try { await api('company.save', {...f, id}); toast('Saved.'); go('/account/company'); } catch (e) { toastError(e); } };
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Company Management', to: '/account/company'}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="Company Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={() => go('/account/company')} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Name" req><input type="text" value={f.name_cn} onChange={set('name_cn')}/></FieldRow>
   <FieldRow label="English Name"><input type="text" value={f.name_en} onChange={set('name_en')}/></FieldRow>
   <FieldRow label="Type"><select value={f.type} onChange={set('type')}>{[...new Set([f.type, ...types])].filter(Boolean).map(t => <option key={t}>{t}</option>)}</select></FieldRow>
   <FieldRow label="Code"><input type="text" value={f.code} onChange={set('code')}/></FieldRow>
   <FieldRow label="City"><input type="text" value={f.city} onChange={set('city')}/></FieldRow>
   <FieldRow label="Status"><select value={f.status} onChange={set('status')}><option value="normal">Normal</option><option value="suspended">Suspended</option></select></FieldRow>
  </FormPanel>
 </>;
}

// ---------------- User
export function UserList({me, companyId}: {me: Me, companyId?: string}) {
 const [state, setState] = useState('');
 const {data, error, reload} = useLoad(() => api('user.list', {companyId, state}), [companyId, state]);
 const [sel, setSel] = useState<string[]>([]);
 const pickUser = async (title: string) => (await pickBox({title, single: true}))?.users[0];
 const transfer = (kind: string, title: string, needsTarget = true) => async (u: any) => {
  try {
   const to = needsTarget ? await pickUser(`${title}: choose the receiving user`) : null;
   if (needsTarget && !to) return;
   if (!await confirmBox(`${title}: ${u.username}${to ? ' → ' + to.label : ''}?`)) return;
   const r = await api('user.transfer', {id: u.id, to: to?.id, kind}); toast(`${title}: ${r.count} record(s) updated.`); reload();
  } catch (e) { toastError(e); }
 };
 const reset = async (u: any) => {
  const v = await formBox(`Reset Password: ${u.username}`, [{name: 'password', label: 'New Password', type: 'password', required: true}]);
  if (v) try { await api('user.reset', {id: u.id, password: v.password}); toast('Password reset.'); } catch (e) { toastError(e); }
 };
 const invalid = async (u: any) => { if (await confirmBox(u.state === 'normal' ? `Set ${u.username} as invalid? They will be signed out.` : `Restore ${u.username}?`)) try { await api('user.state', {id: u.id}); reload(); } catch (e) { toastError(e); } };
 const soon = (what: string) => () => toast(`${what} is not available in this version.`);
 return <>
  <Breadcrumb items={acct('User Management')}/>
  <Panel title={<>User List › {data?.company?.name_cn ?? ''}</>} tools={<Tool icon="fa-cog" title="Add User" className="boxed" onClick={() => go(`/account/user/new${companyId ? '?company=' + companyId : ''}`)}/>}>
   <div className="state-filter"><label>State:</label><select value={state} onChange={e => setState(e.target.value)}><option value="">All</option><option value="normal">Normal</option><option value="invalid">Invalid</option></select></div>
   {data ? <DataTable rows={data.users} selectable selected={sel} onSelect={setSel} rowClass={(u: any) => u.state === 'invalid' ? 'muted' : ''}
    columns={[
     {key: 'username', title: 'Name', sort: (r: any) => r.username.toLowerCase()},
     {key: 'name_cn', title: 'CN Name', sort: (r: any) => r.name_cn},
     {key: 'name_en', title: 'EN Name', sort: (r: any) => r.name_en},
     {key: 'sex', title: 'Sex', sort: (r: any) => r.sex},
     {key: 'dept', title: 'Dept/Position', sort: (r: any) => r.dept},
     {key: 'email', title: 'Email', sort: (r: any) => r.email},
     {key: 'mobile', title: 'Mobile', sort: (r: any) => r.mobile},
     {key: 'role_label', title: 'Role', sort: (r: any) => r.role_label, render: (r: any) => <>{r.role_label}{r.state === 'invalid' && <span className="special">(Invalid)</span>}</>},
    ]}
    menu={(u: any) => [
     {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/user/${u.id}`)},
     {icon: 'fa-cog', label: 'eFile Participants Transfer', onClick: () => transfer('participants', 'eFile Participants Transfer')(u)},
     {icon: 'fa-cog', label: 'eFile Admin Transfer', onClick: () => transfer('admins', 'eFile Admin Transfer')(u)},
     {icon: 'fa-cog', label: 'efile Process User Transfer', onClick: () => transfer('process', 'efile Process User Transfer')(u)},
     {icon: 'fa-exchange', label: 'Service Team Transfer', onClick: soon('Service Team')},
     {icon: 'fa-sign-in', label: 'Group Delete', onClick: () => transfer('groupDelete', 'Remove from all groups', false)(u)},
     {icon: 'fa-files-o', label: 'eFile Copy', onClick: () => transfer('copy', 'eFile Copy')(u)},
     {icon: 'fa-share-square-o', label: 'Service Team Copy', onClick: soon('Service Team')},
     {icon: 'fa-arrow-circle-right', label: 'qChat Transfer', onClick: soon('qChat')},
     {icon: 'fa-scissors', label: 'qChat Delete', onClick: soon('qChat')},
     {icon: 'fa-files-o', label: 'Assign eFile Link', onClick: () => assignLinks(u)},
     {icon: 'fa-key', label: 'Reset Password', onClick: () => reset(u)},
     {icon: 'fa-times', label: u.state === 'normal' ? 'Invalid' : 'Restore', onClick: () => invalid(u), disabled: u.id === me.id},
     {icon: 'fa-eye-slash', label: 'Replace', onClick: () => transfer('replace', 'Replace (moves everything, then sets invalid)')(u)},
     {icon: 'fa-wrench', label: 'Insert', onClick: () => transfer('insert', 'Insert (add the chosen user wherever this user is)')(u)},
    ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}
async function assignLinks(u: any) {
 try {
  const r = await api('user.links.get', {id: u.id});
  const efileIds = await chooseBox({title: `Assign eFile Link: ${u.username}`, options: r.efiles.map((e: any) => ({id: e.id, label: e.name})), selected: r.selected});
  if (!efileIds) return;
  await api('user.links.save', {id: u.id, efileIds}); toast(`${efileIds.length} eFile link(s) assigned.`);
 } catch (e) { toastError(e); }
}

export function UserForm({id, companyId}: {id?: string, companyId?: string}) {
 const [f, setF] = useState<any>({username: '', name_cn: '', name_en: '', sex: 'M', dept: '', email: '', mobile: '', level: 'Normal User', role_ids: [], password: ''});
 const [roles, setRoles] = useState<any[]>([]);
 const [levels, setLevels] = useState<string[]>([]);
 useEffect(() => {
  (id ? api('user.get', {id}).then(r => { setF({...r.user, password: ''}); return r; }) : api('user.form', {companyId})).then(r => { setRoles(r.roles); setLevels(r.levels); }).catch(toastError);
 }, [id, companyId]);
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 const back = () => go('/account/user' + (companyId ? '?company=' + companyId : ''));
 const save = async () => { try { await api('user.save', {...f, id, companyId, roleIds: f.role_ids}); toast('Saved.'); back(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'User Management', to: '/account/user'}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="User Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={back} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Name (login)" req><input type="text" value={f.username} onChange={set('username')} autoComplete="off"/></FieldRow>
   {!id && <FieldRow label="Password" req><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password"/><div className="hint">At least 8 characters.</div></FieldRow>}
   <FieldRow label="CN Name"><input type="text" value={f.name_cn} onChange={set('name_cn')}/></FieldRow>
   <FieldRow label="EN Name"><input type="text" value={f.name_en} onChange={set('name_en')}/></FieldRow>
   <FieldRow label="Sex"><select value={f.sex} onChange={set('sex')}><option value="M">M</option><option value="F">F</option><option value="">—</option></select></FieldRow>
   <FieldRow label="Dept/Position"><input type="text" value={f.dept} onChange={set('dept')} placeholder="Separate several with commas"/></FieldRow>
   <FieldRow label="Email"><input type="email" value={f.email} onChange={set('email')}/></FieldRow>
   <FieldRow label="Mobile"><input type="text" value={f.mobile} onChange={set('mobile')}/></FieldRow>
   <FieldRow label="Account Level"><select value={f.level} onChange={set('level')}>{levels.map(l => <option key={l}>{l}</option>)}</select>
    <div className="hint">Administrators can open every eFile of the company.</div></FieldRow>
   <div className="field"><label>Role</label><div className="checks">{roles.map(r => <label key={r.id}><input type="checkbox" checked={f.role_ids.includes(r.id)}
    onChange={() => setF({...f, role_ids: f.role_ids.includes(r.id) ? f.role_ids.filter((x: string) => x !== r.id) : [...f.role_ids, r.id]})}/>{r.name}</label>)}</div></div>
  </FormPanel>
 </>;
}

// ---------------- Role
const PERM_LABELS: Record<string, string> = {company: 'Company account setup', user: 'User setup', role: 'Role setup', group: 'User group setup', log: 'View system log', client: 'Client Management', efile: 'Create eFile'};
export function RoleList() {
 const {data, error, reload} = useLoad(() => api<any[]>('role.list'), []);
 const del = async (r: any) => { if (await confirmBox(`Delete role "${r.name}"?`)) try { await api('role.delete', {id: r.id}); reload(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={acct('Role Management')}/>
  <Panel title="Role List" tools={<ToolMenu icon="fa-cog" title="Actions" className="boxed" items={[{icon: 'fa-plus', label: 'Add Role', onClick: () => go('/account/role/new')}]}/>}>
   {data ? <DataTable rows={data} columns={[
    {key: 'name', title: 'Role Name', sort: r => r.name},
    {key: 'description', title: 'Description', sort: r => r.description},
    {key: 'share', title: 'Share', sort: r => r.share, render: r => r.share ? 'Yes' : ''},
    {key: 'company', title: 'Company', sort: r => r.company},
   ]} menu={r => [
    {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/role/${r.id}`)},
    {icon: 'fa-times', label: 'Delete', onClick: () => del(r)},
    {icon: 'fa-list', label: 'User List', onClick: () => go(`/account/role/${r.id}/users`)},
   ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}
export function RoleForm({id}: {id?: string}) {
 const [f, setF] = useState<any>({name: '', description: '', share: false, perms: []});
 const [perms, setPerms] = useState<string[]>(Object.keys(PERM_LABELS));
 useEffect(() => { if (id) api('role.get', {id}).then(r => { setF(r); setPerms(r.permissions); }).catch(toastError); }, [id]);
 const save = async () => { try { await api('role.save', {...f, id}); toast('Saved.'); go('/account/role'); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Role Management', to: '/account/role'}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="Role Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={() => go('/account/role')} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Role Name" req><input type="text" value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <FieldRow label="Description"><textarea value={f.description} onChange={e => setF({...f, description: e.target.value})}/></FieldRow>
   <div className="field checks"><label><input type="checkbox" checked={!!f.share} onChange={e => setF({...f, share: e.target.checked})}/>Share</label></div>
   <div className="field"><label>Authorisation</label><div className="checks">{perms.map(p => <label key={p}><input type="checkbox" checked={f.perms.includes(p)}
    onChange={() => setF({...f, perms: f.perms.includes(p) ? f.perms.filter((x: string) => x !== p) : [...f.perms, p]})}/>{PERM_LABELS[p] ?? p}</label>)}</div></div>
  </FormPanel>
 </>;
}
function UsersOf({title, crumb, load}: {title: string, crumb: string, load: () => Promise<any>}) {
 const {data, error} = useLoad(load, [title]);
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: crumb}]}/>
  <Panel title={title}>{data ? <DataTable rows={data.users} columns={[
   {key: 'username', title: 'Name', sort: (r: any) => r.username}, {key: 'name_cn', title: 'CN Name', sort: (r: any) => r.name_cn},
   {key: 'name_en', title: 'EN Name', sort: (r: any) => r.name_en}, {key: 'dept', title: 'Dept/Position'}, {key: 'email', title: 'Email'}]}/> : <Loading error={error}/>}</Panel>
 </>;
}
export const RoleUsers = ({id}: {id: string}) => <UsersOf title="User List" crumb="Role Management" load={() => api('role.users', {id})}/>;

// ---------------- User Group
export function GroupList() {
 const {data, error, reload} = useLoad(() => api<any[]>('group.list'), []);
 const del = async (g: any) => { if (await confirmBox(`Delete group "${g.name}"?`)) try { await api('group.delete', {id: g.id}); reload(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={acct('Group Management')}/>
  <Panel title="Group List" tools={<ToolMenu icon="fa-cog" title="Actions" className="boxed" items={[{icon: 'fa-plus', label: 'Add Group', onClick: () => go('/account/group/new')}]}/>}>
   {data ? <DataTable rows={data} columns={[{key: 'name', title: 'Name', sort: r => r.name}, {key: 'share', title: 'Share', sort: r => r.share, render: r => r.share ? 'Yes' : ''}]}
    menu={g => [
     {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/group/${g.id}`)},
     {icon: 'fa-times', label: 'Delete', onClick: () => del(g)},
     {icon: 'fa-list', label: 'User List', onClick: () => go(`/account/group/${g.id}/users`)},
     {icon: 'fa-list', label: 'Group eFile', onClick: () => go(`/account/group/${g.id}/efiles`)},
    ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}
export function GroupForm({id}: {id?: string}) {
 const [f, setF] = useState<any>({name: '', share: false, members: []});
 const [labels, setLabels] = useState<string>('');
 useEffect(() => {
  if (id) api('group.get', {id}).then(async g => { setF(g); const d = await api('directory'); setLabels(d.users.filter((u: any) => g.members.includes(u.id)).map((u: any) => u.username + ';').join('')); }).catch(toastError);
 }, [id]);
 const pick = async () => { const p = await pickBox({title: 'Members', selectedUsers: f.members}); if (p) { setF({...f, members: p.users.map(u => u.id)}); setLabels(p.users.map(u => u.label + ';').join('')); } };
 const save = async () => { try { await api('group.save', {...f, id}); toast('Saved.'); go('/account/group'); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Group Management', to: '/account/group'}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="Group Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={() => go('/account/group')} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Name" req><input type="text" value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <div className="field checks"><label><input type="checkbox" checked={!!f.share} onChange={e => setF({...f, share: e.target.checked})}/>Share</label></div>
   <div className="field"><label>Members</label><div className="picked"><div className="box" role="button" tabIndex={0} onClick={pick}>{labels}</div>
    <button className="clear" onClick={() => { setF({...f, members: []}); setLabels(''); }} aria-label="Clear members"><i className="fa fa-times-circle-o"/></button></div></div>
  </FormPanel>
 </>;
}
export const GroupUsers = ({id}: {id: string}) => <UsersOf title="User List" crumb="Group Management" load={() => api('group.users', {id})}/>;
export function GroupEfiles({id}: {id: string}) {
 const {data, error} = useLoad(() => api('group.efiles', {id}), [id]);
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Group Management', to: '/account/group'}, {label: 'Group eFile'}]}/>
  <Panel title={<>Group eFile › {data?.group?.name}</>}>{data ? <DataTable rows={data.efiles} rowClass={(r: any) => 'efile-row tall' + (r.highlight ? ' hl' : '')}
   columns={[{key: 'name', title: 'Name', sort: (r: any) => r.name, tdClass: (r: any) => 'name ' + colorClass(r.color), render: (r: any) => <a href={href('/ims/efile/' + r.id)}>{r.name}</a>}]}/> : <Loading error={error}/>}</Panel>
 </>;
}

// ---------------- System Log
export function SystemLog() {
 const [f, setF] = useState({user: '', from: monthAgo(), to: today(), content: ''});
 const [query, setQuery] = useState(f);
 const {data, error} = useLoad(() => api<any[]>('log.list', query), [query]);
 return <>
  <Breadcrumb items={acct('Log')}/>
  <Panel title="Log List">
   <div className="filters">
    <label>User: <input type="text" value={f.user} onChange={e => setF({...f, user: e.target.value})}/></label>
    <label>Time: <input type="date" value={f.from} onChange={e => setF({...f, from: e.target.value})}/></label>
    <label>To <input type="date" value={f.to} onChange={e => setF({...f, to: e.target.value})}/></label>
    <label>Content: <input type="text" value={f.content} onChange={e => setF({...f, content: e.target.value})}/></label>
    <button className="btn blue" style={{height: 34, padding: '0 14px'}} onClick={() => setQuery({...f})}>Search</button>
   </div>
   {data ? <DataTable rows={data} search={false} sortable={false} columns={[
    {key: 'at', title: 'Time', render: r => fmtTime(r.at)}, {key: 'user_label', title: 'User'}, {key: 'module', title: 'Module'},
    {key: 'function', title: 'Function'}, {key: 'source', title: 'Source'}, {key: 'content', title: 'Content'}]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}

// ---------------- My Profile
export function Profile({me, changePassword}: {me: Me, changePassword: boolean}) {
 const [p, setP] = useState({current: '', password: '', confirm: ''});
 const {data} = useLoad(() => api('profile.get'), []);
 const save = async () => { try { await api('profile.password', p); setP({current: '', password: '', confirm: ''}); toast('Password changed.'); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'My Profile'}]}/>
  <Panel title="My Profile">
   {data && <div className="detail-grid" style={{padding: 10}}>
    <b>Name</b><span>{data.username}</span><b>CN Name</b><span>{data.name_cn}</span><b>EN Name</b><span>{data.name_en}</span>
    <b>Company</b><span>{me.company.name_cn}</span><b>Email</b><span>{data.email}</span><b>Mobile</b><span>{data.mobile}</span><b>Role</b><span>{data.role_label}</span>
   </div>}
  </Panel>
  <FormPanel title="Change Password" actions={<button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button>}>
   <FieldRow label="Current Password" req><input type="password" autoFocus={changePassword} value={p.current} onChange={e => setP({...p, current: e.target.value})} autoComplete="current-password"/></FieldRow>
   <FieldRow label="New Password" req><input type="password" value={p.password} onChange={e => setP({...p, password: e.target.value})} autoComplete="new-password"/></FieldRow>
   <FieldRow label="Confirm Password" req><input type="password" value={p.confirm} onChange={e => setP({...p, confirm: e.target.value})} autoComplete="new-password"/></FieldRow>
  </FormPanel>
 </>;
}
