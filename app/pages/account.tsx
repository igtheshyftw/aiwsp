// Account menu: Company, User, Role (authorization levels), User Group, Connection, System Log; registration QR codes; My Profile.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, today, monthAgo, fmtTime, colorClass} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, FormPanel, FieldRow, Tool, ToolMenu, RowMenu, toast, toastError, confirmBox, formBox, pickBox, chooseBox, POSITION, type Me, type MenuItem} from '../ui';

const acct = (label: string) => [{label: 'Account Management'}, {label}];
const PERM_LABEL: Record<string, string> = {createFile: 'Create eFile', createItem: 'Create item', edit: 'Edit items', download: 'Download attachments', export: 'Export',
 submit: 'Submit for approval', approve: 'Approve (Approval User)', efileAdmin: 'Administer eFiles (eFile Admin)', client: 'Client Management'};
const q = (companyId?: string) => companyId ? `?company=${companyId}` : '';
const Back = ({to}: {to: string}) => <button className="btn-sq grey" onClick={() => go(to)} title="Back"><i className="fa fa-undo"/></button>;
const SaveSq = ({onClick}: {onClick: () => void}) => <button className="btn-sq" onClick={onClick} title="Save"><i className="fa fa-check"/></button>;

// ---------------- Company
export function CompanyList({me}: {me: Me}) {
 const {data, error, reload} = useLoad(() => api<any[]>('company.list'), []);
 const [sel, setSel] = useState<string[]>([]);
 const act = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toastError(e); } };
 const assignChief = async (c: any) => {
  const r = await api('company.get', {id: c.id}).catch(toastError); if (!r) return;
  const v = await chooseBox({title: `Chief Admin of ${c.name_cn}`, single: true, selected: r.chief ? [r.chief] : [], options: [{id: 'none', label: '(no Chief Admin — System Admins manage the company)'}, ...r.users.map((u: any) => ({id: u.id, label: `${u.username} ${u.name_en ? '· ' + u.name_en : ''}`}))]});
  if (v) act(() => api('company.chief', {id: c.id, userId: v[0] === 'none' ? '' : v[0]}), 'Chief Admin updated.');
 };
 return <>
  <Breadcrumb items={acct('Company Management')}/>
  <Panel title={<>Company List › {me.company.name_en || me.company.name_cn}</>} tools={me.sys && <Tool icon="fa-plus" title="Add Company" className="boxed" onClick={() => go('/account/company/new')}/>}>
   {data ? <DataTable rows={data} selectable selected={sel} onSelect={setSel}
    columns={[
     {key: 'menu', title: '', width: 60, render: (c: any) => <RowMenu items={[
      {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/company/${c.id}`), disabled: !c.can_edit},
      {icon: 'fa-users', label: 'User List', onClick: () => go(`/account/user?company=${c.id}`), disabled: !c.manages_users},
      {icon: 'fa-key', label: 'Role (Levels)', onClick: () => go(`/account/role?company=${c.id}`), disabled: !c.can_edit},
      {icon: 'fa-link', label: 'Connection', onClick: () => go(`/account/connection?company=${c.id}`)},
      {icon: 'fa-list', label: 'System Log', onClick: () => go(`/account/log?company=${c.id}`), disabled: !me.sys},
      ...(me.sys && !c.operator ? [
       {icon: 'fa-user-secret', label: 'Assign Chief Admin', onClick: () => assignChief(c)},
       {icon: c.status === 'normal' ? 'fa-ban' : 'fa-check', label: c.status === 'normal' ? 'Suspend' : 'Set Normal', onClick: () => act(() => api('company.status', {id: c.id}), 'Status changed.')},
      ] as MenuItem[] : []),
     ]}/>},
     {key: 'name_cn', title: 'Name', sort: (r: any) => r.name_cn, render: (r: any) => <>{r.name_cn}{r.operator ? <span className="ext">Operator</span> : null}</>},
     {key: 'name_en', title: 'English Name', sort: (r: any) => r.name_en},
     {key: 'type', title: 'Type', sort: (r: any) => r.type},
     {key: 'code', title: 'Code', sort: (r: any) => r.code},
     {key: 'city', title: 'City', sort: (r: any) => r.city},
     {key: 'chief', title: 'Chief Admin', sort: (r: any) => r.chief},
     {key: 'status', title: 'Status', sort: (r: any) => r.status, render: (r: any) => r.status === 'normal' ? 'Normal' : 'Suspended'},
    ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}

export function CompanyForm({id}: {id?: string}) {
 const [f, setF] = useState<any>({name_cn: '', name_en: '', type: 'Client', code: '', city: '', address: '', contact: '', email: '', phone: '', sys_manage_users: 0, sys_manage_connections: 0});
 const [meta, setMeta] = useState<any>({types: [], can_settings: false});
 useEffect(() => {
  api<string[]>('company.types').then(types => setMeta((m: any) => ({...m, types}))).catch(toastError);
  if (id) api('company.get', {id}).then(r => { setF(r.company); setMeta({types: r.types, can_settings: r.can_settings || r.is_chief, operator: r.company.operator}); }).catch(toastError);
 }, [id]);
 const save = async () => { try { await api('company.save', {...f, id}); toast('Saved.'); go('/account/company'); } catch (e) { toastError(e); } };
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Company Management', to: '/account/company'}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="Company Setup Adminstration" onSave={save} actions={<><Back to="/account/company"/><SaveSq onClick={save}/></>}>
   <FieldRow label="Name (Chinese)" req><input type="text" value={f.name_cn} onChange={set('name_cn')}/></FieldRow>
   <FieldRow label="English Name" req><input type="text" value={f.name_en} onChange={set('name_en')}/></FieldRow>
   <FieldRow label="Type"><select value={f.type} onChange={set('type')}>{[...new Set([f.type, ...meta.types])].filter(Boolean).map((t: string) => <option key={t}>{t}</option>)}</select></FieldRow>
   <FieldRow label="Code"><input type="text" value={f.code} onChange={set('code')}/></FieldRow>
   <FieldRow label="City"><input type="text" value={f.city} onChange={set('city')}/></FieldRow>
   <FieldRow label="Address"><textarea value={f.address} onChange={set('address')}/></FieldRow>
   <FieldRow label="Contact Person"><input type="text" value={f.contact} onChange={set('contact')}/></FieldRow>
   <FieldRow label="Email"><input type="email" value={f.email} onChange={set('email')}/></FieldRow>
   <FieldRow label="Phone"><input type="text" value={f.phone} onChange={set('phone')}/></FieldRow>
   {id && meta.can_settings && !meta.operator && <>
    <div className="divider"/>
    <div className="field"><label>Company settings (Chief Admin)</label><div className="checks">
     <label><input type="checkbox" checked={!!f.sys_manage_users} onChange={e => setF({...f, sys_manage_users: e.target.checked ? 1 : 0})}/>Allow WSP System Admins to manage our users</label>
     <label><input type="checkbox" checked={!!f.sys_manage_connections} onChange={e => setF({...f, sys_manage_connections: e.target.checked ? 1 : 0})}/>Allow WSP System Admins to manage our connections</label>
    </div><div className="hint">Managing users never gives access to eFiles. Without a Chief Admin, System Admins manage the company.</div></div>
   </>}
  </FormPanel>
 </>;
}

// ---------------- User
export function UserList({me, companyId}: {me: Me, companyId?: string}) {
 const [state, setState] = useState('');
 const [search, setSearch] = useState('');
 const [closed, setClosed] = useState<string[]>([]);
 const {data, error, reload} = useLoad(() => api('user.all', {state}), [state]);
 const pickUser = async (title: string, cid: string) => (await pickBox({title, single: true, companyId: cid, ownOnly: true}))?.users[0];
 const run = async (fn: () => Promise<any>, msg: string) => { try { await fn(); toast(msg); reload(); } catch (e) { toastError(e); } };
 const transfer = (kind: string, title: string, needsTarget = true) => async (u: any) => {
  const to = needsTarget ? await pickUser(`${title}: choose the receiving user`, u.company_id) : null;
  if (needsTarget && !to) return;
  if (!await confirmBox(`${title}: ${u.username}${to ? ' → ' + to.label : ''}?`)) return;
  run(() => api('user.transfer', {id: u.id, to: to?.id, kind}), `${title} done.`);
 };
 const reset = async (u: any) => {
  if (!await confirmBox(`Create a one-time password reset link for ${u.username}? It works for one hour.`)) return;
  try { const r = await api('user.reset', {id: u.id}); await formBox('Send this link to the user', [{name: 'link', label: 'Reset link (valid 1 hour, one use)', value: r.link, type: 'textarea'}]); } catch (e) { toastError(e); }
 };
 const invalid = async (u: any) => { if (await confirmBox(u.state === 'normal' ? `Set ${u.username} as invalid (departed)? Their sessions end immediately; their history stays.` : `Restore ${u.username}?`)) run(async () => { const r = await api('user.state', {id: u.id}); if (r.pending) toast(`${r.pending} pending approval(s) need a new approver. Use eFile List or Replace.`); }, 'Updated.'); };
 const assignLinks = async (u: any) => {
  try {
   const r = await api('user.links.get', {id: u.id});
   const efileIds = await chooseBox({title: `Assign eFile Link: ${u.username}`, options: r.efiles.map((e: any) => ({id: e.id, label: e.name})), selected: r.selected});
   if (efileIds) { await api('user.links.save', {id: u.id, efileIds}); toast(`${efileIds.length} eFile link(s) assigned.`); }
  } catch (e) { toastError(e); }
 };
 const soon = (what: string) => () => toast(`${what} is not available in this version.`);
 const menu = (u: any): MenuItem[] => [
  {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/user/${u.id}`), disabled: u.id === me.id},
  {icon: 'fa-list', label: 'eFile List', onClick: () => go(`/account/user/${u.id}/efiles`)},
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
  ...(u.mfa ? [{icon: 'fa-mobile', label: 'Reset Authenticator', onClick: async () => { if (await confirmBox(`Reset ${u.username}'s authenticator? They must enrol again at next sign-in.`)) run(() => api('user.mfa.reset', {id: u.id}), 'Authenticator reset.'); }}] as MenuItem[] : []),
  {icon: 'fa-times', label: u.state === 'normal' ? 'Invalid' : 'Restore', onClick: () => invalid(u), disabled: u.id === me.id},
  {icon: 'fa-eye-slash', label: 'Replace', onClick: () => transfer('replace', 'Replace (hands everything over, then sets invalid)')(u)},
  {icon: 'fa-wrench', label: 'Insert', onClick: () => transfer('insert', 'Insert (add the chosen user wherever this user is)')(u)},
 ];
 const readOnly: MenuItem[] = [{icon: 'fa-lock', label: 'View only — this company has not authorised WSP to manage its users', disabled: true}];
 const needle = search.trim().toLowerCase();
 const matches = (u: any) => !needle || [u.username, u.name_cn, u.name_en, u.dept, u.email, u.mobile, u.role_label].join(' ').toLowerCase().includes(needle);
 const groups = (data?.groups ?? []).filter((g: any) => !companyId || g.company.id === companyId).map((g: any) => ({...g, shown: g.users.filter(matches)}));
 const total = groups.reduce((n: number, g: any) => n + g.shown.length, 0);
 const toggle = (id: string) => setClosed(closed.includes(id) ? closed.filter(x => x !== id) : [...closed, id]);
 return <>
  <Breadcrumb items={acct('User Management')}/>
  <Panel title={<>User List{companyId && groups[0] ? <> › {groups[0].company.name_cn}</> : <> › All Companies</>}</>} tools={groups.length > 1 && <>
   <button className="tool" title="Expand all" onClick={() => setClosed([])}><i className="fa fa-plus-square-o"/></button>
   <button className="tool" title="Collapse all" onClick={() => setClosed(groups.map((g: any) => g.company.id))}><i className="fa fa-minus-square-o"/></button></>}>
   <div className="filters" style={{margin: '4px 0 12px'}}>
    <label>State: <select value={state} onChange={e => setState(e.target.value)} style={{height: 31, border: '1px solid #ccc', minWidth: 140}}><option value="">All</option><option value="normal">Normal</option><option value="invalid">Invalid</option></select></label>
    <label>Search: <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, email, department…"/></label>
    {companyId && <a className="link" href="#/account/user">Show all companies</a>}
    <span className="muted">{total} account{total === 1 ? '' : 's'} in {groups.length} compan{groups.length === 1 ? 'y' : 'ies'}</span>
   </div>
   {!data ? <Loading error={error}/> : groups.map((g: any) => <div className="user-group" key={g.company.id}>
    <div className="user-group-head" role="button" tabIndex={0} onClick={() => toggle(g.company.id)} onKeyDown={e => { if (e.key === 'Enter') toggle(g.company.id); }}>
     <i className={'fa ' + (closed.includes(g.company.id) ? 'fa-caret-right' : 'fa-caret-down')}/>
     <b>{g.company.name_cn}</b>{g.company.name_en && g.company.name_en !== g.company.name_cn && <span>{g.company.name_en}</span>}
     {g.company.code && <span className="muted">{g.company.code}</span>}
     {g.company.operator && <span className="ext">Operator</span>}{g.company.status !== 'normal' && <span className="special">(Suspended)</span>}
     <span className="muted">· {g.shown.length} user{g.shown.length === 1 ? '' : 's'}{g.company.chief && ` · Chief Admin: ${g.company.chief}`}</span>
     {!g.can_manage && <span className="ext">View only</span>}
     {g.can_manage && <span className="tools" onClick={e => e.stopPropagation()}>
      <button className="btn green" onClick={() => go(`/account/user/new${q(g.company.id)}`)}><i className="fa fa-plus"/> Add User</button>
      <button className="btn plain" onClick={() => go(`/account/invite${q(g.company.id)}`)}><i className="fa fa-qrcode"/> QR Code</button></span>}
    </div>
    {!closed.includes(g.company.id) && <DataTable rows={g.shown} search={false} pageSize={50} rowClass={(u: any) => u.live ? '' : 'muted'} emptyText={needle ? 'No matching users.' : 'No users yet.'}
     columns={[
      {key: 'username', title: 'Name', sort: (r: any) => r.username.toLowerCase()},
      {key: 'name_cn', title: 'CN Name', sort: (r: any) => r.name_cn},
      {key: 'name_en', title: 'EN Name', sort: (r: any) => r.name_en},
      {key: 'sex', title: 'Sex', sort: (r: any) => r.sex},
      {key: 'dept', title: 'Dept/Position', sort: (r: any) => r.dept},
      {key: 'email', title: 'Email', sort: (r: any) => r.email},
      {key: 'mobile', title: 'Mobile (WeCom)', sort: (r: any) => r.mobile},
      {key: 'role_label', title: 'Role', sort: (r: any) => r.role_label, render: (r: any) => <>{r.role_label}{!r.live && <span className="special">({r.state === 'invalid' ? 'Invalid' : 'Expired'})</span>}{['system', 'chief', 'useradmin'].includes(r.position) && !r.mfa && <span className="ext">No authenticator</span>}</>},
     ]}
     menu={(u: any) => g.can_manage ? menu(u) : readOnly}/>}
   </div>)}
  </Panel>
 </>;
}

export function UserEfiles({id}: {id: string}) {
 const {data, error, reload} = useLoad(() => api('user.efiles', {id}), [id]);
 const change = async (e: any, kind: string, replace: boolean) => {
  const to = replace ? (await pickBox({title: `Replace ${data.user.username} (${kind === 'participant' ? 'eFile User' : kind === 'admin' ? 'eFile Admin' : 'Approval User'}) in ${e.name}`, single: true}))?.users[0] : null;
  if (replace && !to) return;
  if (!replace && !await confirmBox(`Remove ${data.user.username} as ${kind === 'participant' ? 'eFile User' : kind === 'admin' ? 'eFile Admin' : 'Approval User'} of ${e.name}?`)) return;
  try { await api('user.efile.change', {id, efileId: e.id, kind, to: to?.id}); toast('Updated.'); reload(); } catch (err) { toastError(err); }
 };
 const Role = ({e, kind, on, label}: {e: any, kind: string, on: any, label: string}) => on ? <span style={{marginRight: 14}}>{label}
  <button className="clear" style={{padding: '0 0 0 6px', fontSize: 14, color: '#2a6fdb'}} title="Replace" onClick={() => change(e, kind, true)}><i className="fa fa-exchange"/></button>
  <button className="clear" style={{padding: '0 0 0 4px', fontSize: 14}} title="Remove" onClick={() => change(e, kind, false)}><i className="fa fa-times-circle-o"/></button></span> : null;
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'User Management', to: '/account/user'}, {label: 'eFile List'}]}/>
  <Panel title={<>eFile List › {data?.user?.username}</>}>{data ? <DataTable rows={data.efiles} columns={[
   {key: 'name', title: 'eFile', sort: (r: any) => r.name},
   {key: 'roles', title: 'Roles', render: (r: any) => <><Role e={r} kind="participant" on={r.is_user} label={`eFile User (${r.rights === 'view' ? 'View' : 'Edit'})`}/><Role e={r} kind="admin" on={r.is_admin} label="eFile Admin"/><Role e={r} kind="approver" on={r.is_approver} label="Approval User"/></>},
   {key: 'pending', title: 'Pending approvals', className: 'num', render: (r: any) => r.pending || ''},
  ]}/> : <Loading error={error}/>}</Panel>
 </>;
}

export function UserForm({id, companyId}: {id?: string, companyId?: string}) {
 const [f, setF] = useState<any>({username: '', name_cn: '', name_en: '', sex: 'M', dept: '', email: '', mobile: '', level: 3, position: 'member', perms: {}, expires: '', responsible_id: '', password: ''});
 const [meta, setMeta] = useState<any>(null);
 useEffect(() => {
  (id ? api('user.get', {id}).then(r => { setF({...r.user, expires: r.user.expires?.slice(0, 10) ?? '', responsible_id: r.user.responsible_id ?? '', password: ''}); return r; }) : api('user.form', {companyId})).then(setMeta).catch(toastError);
 }, [id, companyId]);
 if (!meta) return <Loading/>;
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 const back = `/account/user${q(companyId ?? f.company_id)}`;
 const save = async () => { try { await api('user.save', {...f, id, companyId, level: Number(f.level)}); toast('Saved.'); go(back); } catch (e) { toastError(e); } };
 const preset = new Set<string>(meta.levels.find((l: any) => l.level === Number(f.level))?.perms ?? []);
 const effective = (p: string) => typeof f.perms[p] === 'boolean' ? f.perms[p] : preset.has(p);
 const canGrant = (p: string) => meta.sys || meta.my_perms.includes(p);
 const positions = [['member', 'User'], ['useradmin', 'User Admin'], ...(meta.can_appoint_system ? [['system', 'System Admin']] : [])];
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'User Management', to: back}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="User Setup Adminstration" onSave={save} actions={<><Back to={back}/><SaveSq onClick={save}/></>}>
   <FieldRow label="Name (login, unique)" req><input type="text" value={f.username} onChange={set('username')} autoComplete="off"/></FieldRow>
   {!id && <FieldRow label="Password" req><input type="password" value={f.password} onChange={set('password')} autoComplete="new-password"/><div className="hint">At least 8 characters. For your staff, the registration QR code is usually easier.</div></FieldRow>}
   <FieldRow label="CN Name"><input type="text" value={f.name_cn} onChange={set('name_cn')}/></FieldRow>
   <FieldRow label="EN Name"><input type="text" value={f.name_en} onChange={set('name_en')}/></FieldRow>
   <FieldRow label="Sex"><select value={f.sex} onChange={set('sex')}><option value="M">M</option><option value="F">F</option><option value="">—</option></select></FieldRow>
   <FieldRow label="Dept/Position"><input type="text" value={f.dept} onChange={set('dept')} placeholder="Separate several with commas"/></FieldRow>
   <FieldRow label="Email"><input type="email" value={f.email} onChange={set('email')}/></FieldRow>
   <FieldRow label="Mobile (for WeCom)"><input type="text" value={f.mobile} onChange={set('mobile')}/></FieldRow>
   <div className="divider"/>
   {f.position === 'chief' ? <FieldRow label="Position"><div className="view-value">Chief Admin (assigned by a System Admin from the Company list)</div></FieldRow>
    : <FieldRow label="Position"><select value={f.position} onChange={set('position')} disabled={!meta.can_appoint_useradmin && !meta.can_appoint_system}>{positions.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
     <div className="hint">User Admins manage users and groups. Only the Chief Admin appoints them.</div></FieldRow>}
   <FieldRow label="Authorization Level"><select value={f.level} onChange={e => setF({...f, level: Number(e.target.value)})}>{meta.levels.map((l: any) => <option key={l.level} value={l.level} disabled={!meta.sys && l.level < meta.my_level}>{l.name === `Level ${l.level}` ? l.name : `Level ${l.level} — ${l.name}`}</option>)}</select></FieldRow>
   <div className="field"><label>Functions (tick to adjust this user individually)</label><div className="checks">
    {meta.perms.map((p: string) => <label key={p} title={canGrant(p) ? '' : 'You do not hold this function, so you cannot grant it.'}>
     <input type="checkbox" checked={effective(p)} disabled={!canGrant(p) && !effective(p)} onChange={e => setF({...f, perms: {...f.perms, [p]: e.target.checked === preset.has(p) ? undefined : e.target.checked}})}/>
     {PERM_LABEL[p] ?? p}{typeof f.perms[p] === 'boolean' && <span className="ext">adjusted</span>}</label>)}
   </div><div className="hint">Viewing comes from eFile membership. You cannot grant a function or level beyond your own.</div></div>
   {(Number(f.level) === 4 || f.expires) && <>
    <FieldRow label="Expiry date (temporary account)" req><div className="date"><input type="date" value={f.expires} onChange={set('expires')}/></div></FieldRow>
    <FieldRow label="Responsible administrator" req><select value={f.responsible_id} onChange={set('responsible_id')}><option value="">— choose —</option>{meta.admins.map((a: any) => <option key={a.id} value={a.id}>{a.username}</option>)}</select></FieldRow>
   </>}
  </FormPanel>
 </>;
}

// ---------------- Registration QR codes
export function Invitations({companyId}: {companyId?: string}) {
 const {data, error, reload} = useLoad(() => api<any[]>('invite.list', {companyId}), [companyId]);
 const create = async () => { const v = await formBox('New registration QR code', [{name: 'days', label: 'Valid for (days, 1–30)', value: '7'}]); if (v) try { await api('invite.create', {companyId, days: Number(v.days)}); reload(); } catch (e) { toastError(e); } };
 const revoke = async (r: any) => { if (await confirmBox('Revoke this QR code? It stops working at once.')) try { await api('invite.revoke', {id: r.id}); reload(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'User Management', to: `/account/user${q(companyId)}`}, {label: 'Registration QR Code'}]}/>
  <Panel title="Registration QR Code" tools={<Tool icon="fa-plus" title="New QR code" className="boxed" onClick={create}/>}>
   <p className="notice-bar">Staff scan the code, choose a unique user name, enter their password twice and their WeCom mobile number. They can use the system straight away at your default level (Level 3); you are notified and can adjust their access any time.</p>
   {!data ? <Loading error={error}/> : data.length === 0 ? <p className="muted">No QR codes yet.</p> : data.map(r => <div className="qr-card" key={r.id}>
    {r.usable ? <img src={r.qr} alt="Registration QR code" width={200} height={200}/> : <div style={{height: 200, display: 'grid', placeItems: 'center'}} className="muted">{r.active ? 'Expired' : 'Revoked'}</div>}
    <div>Valid until {fmtTime(r.expires).slice(0, 16)}</div>
    {r.usable && <small>{r.url}</small>}
    {r.usable && <button className="btn grey" style={{marginTop: 8}} onClick={() => revoke(r)}><i className="fa fa-ban"/> Revoke</button>}
   </div>)}
  </Panel>
 </>;
}

// ---------------- Role = authorization levels
export function RoleList({companyId}: {companyId?: string}) {
 const {data, error} = useLoad(() => api('role.list', {companyId}), [companyId]);
 return <>
  <Breadcrumb items={acct('Role Management')}/>
  <Panel title={<>Role List › {data?.company?.name_cn ?? ''}</>}>
   <p className="notice-bar">Each company has four authorization levels made of function checkboxes. Level 3 is the default for new users; Level 4 is for temporary accounts. Users can be adjusted individually.</p>
   {data ? <DataTable rows={data.levels} search={false} sortable={false} columns={[
    {key: 'level', title: 'Level', width: 70},
    {key: 'name', title: 'Role Name'},
    {key: 'description', title: 'Description'},
    {key: 'perms', title: 'Functions', render: (r: any) => r.perms.map((p: string) => PERM_LABEL[p] ?? p).join(', ') || <span className="muted">View only</span>},
    {key: 'users', title: 'Users', className: 'num'},
   ]} menu={(r: any) => [
    {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/account/role/${r.level}${q(data.company.id)}`), disabled: !data.can_edit},
    {icon: 'fa-list', label: 'User List', onClick: () => go(`/account/role/${r.level}/users${q(data.company.id)}`)},
   ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}
export function RoleForm({level, companyId}: {level: string, companyId?: string}) {
 const [f, setF] = useState<any>(null);
 const [perms, setPerms] = useState<string[]>([]);
 useEffect(() => { api('role.list', {companyId}).then(r => { setPerms(r.perms); setF({...r.levels.find((l: any) => String(l.level) === level), companyId: r.company.id}); }).catch(toastError); }, [level, companyId]);
 if (!f) return <Loading/>;
 const back = `/account/role${q(f.companyId)}`;
 const save = async () => { try { await api('role.save', f); toast('Saved.'); go(back); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Role Management', to: back}, {label: `Level ${level}`}]}/>
  <FormPanel title={`Role Setup Adminstration — Level ${level}`} onSave={save} actions={<><Back to={back}/><SaveSq onClick={save}/></>}>
   <FieldRow label="Role Name" req><input type="text" value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <FieldRow label="Description"><textarea value={f.description} onChange={e => setF({...f, description: e.target.value})}/></FieldRow>
   <div className="field"><label>Functions</label><div className="checks">{perms.map(p => <label key={p}><input type="checkbox" checked={f.perms.includes(p)}
    onChange={() => setF({...f, perms: f.perms.includes(p) ? f.perms.filter((x: string) => x !== p) : [...f.perms, p]})}/>{PERM_LABEL[p] ?? p}</label>)}</div>
    <div className="hint">Changes apply to everyone at this level, except their individual adjustments.</div></div>
  </FormPanel>
 </>;
}
function UsersOf({title, crumb, load}: {title: string, crumb: string, load: () => Promise<any>}) {
 const {data, error} = useLoad(load, [title]);
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: crumb}]}/>
  <Panel title={title}>{data ? <DataTable rows={data.users} columns={[
   {key: 'username', title: 'Name', sort: (r: any) => r.username}, {key: 'name_cn', title: 'CN Name', sort: (r: any) => r.name_cn},
   {key: 'name_en', title: 'EN Name', sort: (r: any) => r.name_en}, {key: 'dept', title: 'Dept/Position'}, {key: 'role_label', title: 'Role'}]}/> : <Loading error={error}/>}</Panel>
 </>;
}
export const RoleUsers = ({level, companyId}: {level: string, companyId?: string}) => <UsersOf title={`User List › Level ${level}`} crumb="Role Management" load={() => api('role.users', {level, companyId})}/>;

// ---------------- User Group
export function GroupList() {
 const {data, error, reload} = useLoad(() => api<any[]>('group.list'), []);
 const del = async (g: any) => { if (await confirmBox(`Delete group "${g.name}"? Its members lose the eFile access it gave them.`)) try { await api('group.delete', {id: g.id}); reload(); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={acct('Group Management')}/>
  <Panel title="Group List" tools={<ToolMenu icon="fa-cog" title="Actions" className="boxed" items={[{icon: 'fa-plus', label: 'Add Group', onClick: () => go('/account/group/new')}]}/>}>
   {data ? <DataTable rows={data} columns={[{key: 'name', title: 'Name', sort: r => r.name}, {key: 'members', title: 'Members', className: 'num'}, {key: 'share', title: 'Share', sort: r => r.share, render: r => r.share ? 'Yes' : ''}]}
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
 const [f, setF] = useState<any>({name: '', share: false, members: [], efiles: []});
 useEffect(() => { if (id) api('group.get', {id}).then(setF).catch(toastError); }, [id]);
 const pick = async () => { const p = await pickBox({title: 'Members (your staff and approved connection contacts)', selectedUsers: f.members.map((m: any) => m.id)}); if (p) setF({...f, members: p.users}); };
 const save = async () => { try { await api('group.save', {...f, id, members: f.members.map((m: any) => m.id)}); toast('Saved.'); go('/account/group'); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Group Management', to: '/account/group'}, {label: id ? 'Edit' : 'Add'}]}/>
  <FormPanel title="Group Setup Adminstration" onSave={save} actions={<><Back to="/account/group"/><SaveSq onClick={save}/></>}>
   <FieldRow label="Name" req><input type="text" value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <div className="field"><label>eFiles this group grants access to</label>
    {f.efiles.length ? <div className="member-list">{f.efiles.map((e: any) => <span key={e.id}><i className="fa fa-folder-o"/> {e.name} ({e.rights === 'view' ? 'View' : 'Edit'})</span>)}</div> : <p className="muted" style={{margin: 0}}>{id ? 'None yet.' : 'A new group gives access to no eFiles until an eFile Admin adds it.'}</p>}
    <div className="hint">Everyone you add below gets this access.</div></div>
   <div className="field checks"><label><input type="checkbox" checked={!!f.share} onChange={e => setF({...f, share: e.target.checked})}/>Share</label></div>
   <div className="field"><label>Members</label><div className="picked"><div className="box" role="button" tabIndex={0} onClick={pick}>{f.members.map((m: any) => m.label + ';').join('')}</div>
    <button className="clear" onClick={() => setF({...f, members: []})} aria-label="Clear members"><i className="fa fa-times-circle-o"/></button></div></div>
  </FormPanel>
 </>;
}
export const GroupUsers = ({id}: {id: string}) => <UsersOf title="User List" crumb="Group Management" load={() => api('group.users', {id})}/>;
export function GroupEfiles({id}: {id: string}) {
 const {data, error} = useLoad(() => api('group.efiles', {id}), [id]);
 return <>
  <Breadcrumb items={[{label: 'Account Management'}, {label: 'Group Management', to: '/account/group'}, {label: 'Group eFile'}]}/>
  <Panel title={<>Group eFile › {data?.group?.name}</>}>{data ? <DataTable rows={data.efiles} rowClass={(r: any) => 'efile-row tall' + (r.highlight ? ' hl' : '')}
   columns={[{key: 'name', title: 'Name', sort: (r: any) => r.name, tdClass: (r: any) => 'name ' + colorClass(r.color), render: (r: any) => <a href={href('/ims/efile/' + r.id)}>{r.name}</a>},
    {key: 'rights', title: 'Right', render: (r: any) => r.rights === 'view' ? 'View' : 'Edit'}]}/> : <Loading error={error}/>}</Panel>
 </>;
}

// ---------------- Connection
export function Connections({me, companyId}: {me: Me, companyId?: string}) {
 const {data, error, reload} = useLoad(() => api('connection.list', {companyId}), [companyId]);
 const designate = async (cn: any) => {
  const p = await pickBox({title: 'Our staff designated for this connection', selectedUsers: cn.mine.map((u: any) => u.id), companyId: data.companyId, ownOnly: true});
  if (p) try { await api('connection.update', {id: cn.id, companyId: data.companyId, users: p.users.map(u => u.id)}); reload(); } catch (e) { toastError(e); }
 };
 const request = async () => {
  const to = await chooseBox({title: 'Request a connection with', single: true, options: data.companies.map((c: any) => ({id: c.id, label: `${c.name_cn} ${c.name_en ? '· ' + c.name_en : ''}`}))}); if (!to) return;
  const p = await pickBox({title: 'Our staff designated for this connection', companyId: data.companyId, ownOnly: true}); if (!p) return;
  try { await api('connection.request', {companyId: data.companyId, to: to[0], users: p.users.map(u => u.id)}); toast('Request sent. The other company must accept it.'); reload(); } catch (e) { toastError(e); }
 };
 const update = async (cn: any, status: string) => {
  if (status === 'revoked' && !await confirmBox(`Revoke the connection with ${cn.other}? Their staff can no longer be added to your eFiles or groups.`)) return;
  let users: string[] | undefined;
  if (status === 'connected') { const p = await pickBox({title: 'Our staff designated for this connection', companyId: data.companyId, ownOnly: true}); if (!p) return; users = p.users.map(u => u.id); }
  try { await api('connection.update', {id: cn.id, companyId: data.companyId, status, users}); reload(); } catch (e) { toastError(e); }
 };
 void me;
 return <>
  <Breadcrumb items={acct('Connection Management')}/>
  <Panel title="Connection List" tools={data?.can_manage && <Tool icon="fa-plus" title="Request connection" className="boxed" onClick={request}/>}>
   <p className="notice-bar">Companies are kept separate. A connection needs both companies to confirm, and each side chooses which staff take part. Being connected lets you add those people to eFiles and groups; it never opens your other eFiles.</p>
   {data ? <DataTable rows={data.connections} columns={[
    {key: 'other', title: 'Company', sort: (r: any) => r.other},
    {key: 'status', title: 'Status', render: (r: any) => r.status === 'requested' ? (r.incoming ? 'Waiting for our acceptance' : 'Waiting for them') : r.status === 'connected' ? 'Connected' : 'Revoked'},
    {key: 'mine', title: 'Our staff', render: (r: any) => r.mine.map((u: any) => u.label).join('; ')},
    {key: 'theirs', title: 'Their staff', render: (r: any) => r.theirs.map((u: any) => u.label).join('; ')},
   ]} menu={(r: any) => [
    ...(r.status === 'requested' && r.incoming ? [{icon: 'fa-check', label: 'Accept', onClick: () => update(r, 'connected')}] as MenuItem[] : []),
    {icon: 'fa-users', label: 'Designate Our Staff', onClick: () => designate(r), disabled: r.status === 'revoked' || !data.can_manage},
    {icon: 'fa-ban', label: 'Revoke', onClick: () => update(r, 'revoked'), disabled: r.status === 'revoked' || !data.can_manage},
   ]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}

// ---------------- System Log
export function SystemLog() {
 const company = new URLSearchParams(location.hash.split('?')[1] ?? '').get('company') ?? undefined;
 const [f, setF] = useState({user: '', from: monthAgo(), to: today(), content: ''});
 const [query, setQuery] = useState(f);
 const {data, error} = useLoad(() => api<any[]>('log.list', {...query, companyId: company}), [query, company]);
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
   {data ? <DataTable rows={data} search={false} sortable={false} rowClass={(r: any) => r.function === '管理员覆盖' ? 'item-hl' : ''} columns={[
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
    <b>Company</b><span>{me.company.name_cn}</span><b>Position</b><span>{POSITION[data.position]}</span><b>Role</b><span>{data.role_label}</span>
    <b>Functions</b><span>{data.effective.map((x: string) => PERM_LABEL[x] ?? x).join(', ') || 'View only'}</span>
    <b>Email</b><span>{data.email}</span><b>Mobile (WeCom)</b><span>{data.mobile}</span>
    <b>Authenticator</b><span>{data.mfa ? 'On' : <a className="link" href={href('/mfa')}>Set up</a>}</span>
    {data.expires && <><b>Account expires</b><span>{data.expires.slice(0, 10)}</span></>}
   </div>}
  </Panel>
  <FormPanel title="Change Password" actions={<SaveSq onClick={save}/>}>
   <FieldRow label="Current Password" req><input type="password" autoFocus={changePassword} value={p.current} onChange={e => setP({...p, current: e.target.value})} autoComplete="current-password"/></FieldRow>
   <FieldRow label="New Password" req><input type="password" value={p.password} onChange={e => setP({...p, password: e.target.value})} autoComplete="new-password"/></FieldRow>
   <FieldRow label="Confirm Password" req><input type="password" value={p.confirm} onChange={e => setP({...p, confirm: e.target.value})} autoComplete="new-password"/></FieldRow>
  </FormPanel>
 </>;
}
