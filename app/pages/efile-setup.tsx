// eFile Setup Adminstration (create/edit/view), Set Confirmation, Set Grand Balance/Sum and eFile Process Monitor.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, semi} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, FormPanel, FieldRow, PickedField, toast, toastError, pickBox} from '../ui';

type Ref = {id: string, label: string};
const crumbs = (last: string, id?: string, name?: string) => [{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, ...(id && name ? [{label: name, to: `/ims/efile/${id}`}] : []), {label: last}];

type Member = Ref & {rights?: string, external?: boolean};
// Add a client's service team (users or groups) to the participants of a new eFile, with Edit rights.
const withTeam = (f: any, cl: {users: Ref[], groups: Ref[]}) => ({...f, client_id: (cl as any).id,
 participants: [...f.participants, ...cl.users.filter(u => !f.participants.some((p: Ref) => p.id === u.id)).map(u => ({...u, rights: 'edit'}))],
 groups: [...f.groups, ...cl.groups.filter(g => !f.groups.some((p: Ref) => p.id === g.id)).map(g => ({...g, rights: 'edit'}))]});
// A picked list where each person or group carries a View / Edit right.
function RightsList({list, onChange}: {list: Member[], onChange: (l: Member[]) => void}) {
 if (!list.length) return null;
 return <div className="member-list">{list.map((m, i) => <span key={m.id}>{m.label}{m.external && <span className="ext">external</span>}
  <select className="rights" value={m.rights ?? 'edit'} aria-label={`Right for ${m.label}`} onChange={e => onChange(list.map((x, j) => j === i ? {...x, rights: e.target.value} : x))}>
   <option value="edit">Edit</option><option value="view">View</option></select></span>)}</div>;
}

export function EfileForm({id, clientId}: {id?: string, clientId?: string}) {
 const [f, setF] = useState<any>(null);
 const [meta, setMeta] = useState<{colors: string[], currencies: string[]}>({colors: [], currencies: []});
 const [clients, setClients] = useState<any[]>([]);
 useEffect(() => {
  api('efile.form').then(setMeta).catch(toastError);
  const options = api<any[]>('client.options').then(l => { setClients(l); return l; }).catch(() => [] as any[]);
  if (id) api('efile.get', {id}).then(setF).catch(toastError);
  else api('profile.get').then(me => setF({name: '', tag: '', highlight: false, color: '', report_name: '', currency: 'CNY', show_date: 1, show_amount: 1, approval: 0,
   participants: [{id: me.id, label: me.username, rights: 'edit'}], groups: [], admins: me.effective.includes('efileAdmin') ? [{id: me.id, label: me.username}] : [], wechat_participants: [], wechat_groups: [], client_id: ''}))
   .then(() => options).then(l => { const cl = clientId && l.find((x: any) => x.id === clientId); if (cl) setF((v: any) => withTeam(v, cl)); }).catch(toastError);
 }, [id]);
 if (!f) return <Loading/>;
 const chooseClient = (cid: string) => { const cl = clients.find(x => x.id === cid); setF(!id && cl ? withTeam({...f, client_id: cid}, cl) : {...f, client_id: cid}); };
 const keepRights = (old: Member[], picked: Ref[]) => picked.map(p => ({...p, rights: old.find(o => o.id === p.id)?.rights ?? 'edit'}));
 const pickUsers = (key: string, title: string) => async () => { const p = await pickBox({title, selectedUsers: f[key].map((x: Ref) => x.id)}); if (p) setF({...f, [key]: keepRights(f[key], p.users)}); };
 const pickGroups = (key: string, title: string) => async () => { const p = await pickBox({title, users: false, groups: true, selectedGroups: f[key].map((x: Ref) => x.id)}); if (p) setF({...f, [key]: keepRights(f[key], p.groups)}); };
 const clear = (key: string) => () => setF({...f, [key]: []});
 const ids = (k: string) => f[k].map((x: Ref) => x.id);
 const withRights = (k: string) => f[k].map((x: Member) => ({id: x.id, rights: x.rights ?? 'edit'}));
 const save = async () => {
  try {
   const r = await api('efile.save', {id, version: f.version, name: f.name, tag: f.tag, highlight: f.highlight, color: f.color, report_name: f.report_name, currency: f.currency,
    show_date: f.show_date, show_amount: f.show_amount, approval: f.approval, client_id: f.client_id || '',
    participants: withRights('participants'), groups: withRights('groups'), admins: ids('admins'), wechat_participants: ids('wechat_participants'), wechat_groups: ids('wechat_groups')});
   toast('Saved.'); go(f.approval && !(f.steps?.length) ? `/ims/efile/${r.id}/confirmation` : `/ims/efile/${r.id}`);
  } catch (e) { toastError(e); }
 };
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}]}/>
  <FormPanel title="eFile Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Name" req><textarea value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <FieldRow label="Tag"><textarea value={f.tag} onChange={e => setF({...f, tag: e.target.value})}/></FieldRow>
   {clients.length > 0 && <FieldRow label="Client"><select value={f.client_id ?? ''} onChange={e => chooseClient(e.target.value)}><option value="">—</option>{clients.map(cl => <option key={cl.id} value={cl.id}>{cl.label}</option>)}</select>
    {!id && <div className="hint">Choosing a client adds its service team as participants.</div>}</FieldRow>}
   <FieldRow label="Item Template Folder"><button className="btn-sq" style={{width: 44}} title="Choose folder" onClick={() => toast('Item templates are not set up yet.')}><i className="fa fa-check-square-o"/></button></FieldRow>
   <div className="field"><label>Select Type</label><label style={{display: 'flex', gap: 8, alignItems: 'center'}}><input type="radio" checked readOnly/> User And Group</label></div>
   <PickedField label="Participants" req value={semi(f.participants)} onPick={pickUsers('participants', 'Participants (your staff and approved connection contacts)')} onClear={clear('participants')}/>
   <div className="field" style={{marginTop: -8}}><RightsList list={f.participants} onChange={l => setF({...f, participants: l})}/></div>
   <PickedField label="Group" value={semi(f.groups)} onPick={pickGroups('groups', 'Group')} onClear={clear('groups')}/>
   <div className="field" style={{marginTop: -8}}><RightsList list={f.groups} onChange={l => setF({...f, groups: l})}/></div>
   <div className="divider"/>
   <PickedField label="Administrators (eFile Admin)" req value={semi(f.admins)} onPick={pickUsers('admins', 'eFile Admins')} onClear={clear('admins')}/>
   {f.admin_fallback && <div className="field notice-bar">This eFile has no active eFile Admin; the Chief Admin (or a System Admin) is administering it. Choose a new eFile Admin.</div>}
   <div className="divider"/>
   <div className="field checks"><label>Columns and approval</label>
    <label><input type="checkbox" checked={!!f.show_date} onChange={e => setF({...f, show_date: e.target.checked ? 1 : 0})}/>Show date column</label>
    <label><input type="checkbox" checked={!!f.show_amount} onChange={e => setF({...f, show_amount: e.target.checked ? 1 : 0})}/>Show amount column</label>
    <label><input type="checkbox" checked={!!f.approval} onChange={e => setF({...f, approval: e.target.checked ? 1 : 0})}/>Approval required (steps are set with Set Confirmation)</label>
    <div className="hint">Hiding a column keeps the stored values.</div>
   </div>
   {!!f.show_amount && <FieldRow label="Currency (standard code)"><select value={f.currency} onChange={e => setF({...f, currency: e.target.value})}>{meta.currencies.map(c => <option key={c}>{c}</option>)}</select>
    {id && <div className="hint">Changing the currency applies to new items only; existing amounts keep their own currency.</div>}</FieldRow>}
   <div className="divider"/>
   <PickedField label="Sync With Wechat: Participants" value={semi(f.wechat_participants)} onPick={pickUsers('wechat_participants', 'Sync With Wechat: Participants')} onClear={clear('wechat_participants')}/>
   <PickedField label="Sync With Wechat: Group" value={semi(f.wechat_groups)} onPick={pickGroups('wechat_groups', 'Sync With Wechat: Group')} onClear={clear('wechat_groups')}/>
   <div className="divider"/>
   <div className="field checks"><label><input type="checkbox" checked={!!f.highlight} onChange={e => setF({...f, highlight: e.target.checked})}/>Highlight</label></div>
   <FieldRow label="Color"><select value={f.color} onChange={e => setF({...f, color: e.target.value})}>{meta.colors.map(c => <option key={c} value={c}>{c || '—'}</option>)}</select></FieldRow>
   <FieldRow label="Report Name"><input type="text" value={f.report_name} onChange={e => setF({...f, report_name: e.target.value})}/></FieldRow>
   <FieldRow label="Item Type"><select disabled value="number"><option value="number">Number</option></select></FieldRow>
  </FormPanel>
 </>;
}

const rightsText = (l: Member[]) => l.map(m => `${m.label}${m.rights === 'view' ? ' (View)' : ''};`).join('');
export function EfileView({id}: {id: string}) {
 const {data: e, error} = useLoad(() => api('efile.get', {id}), [id]);
 if (!e) return <Loading error={error}/>;
 const rows: [string, string][] = [
  ['Name', e.name], ['Tag', e.tag], ['Client', e.client ? `${e.client.code} ${e.client.name_cn}` : ''], ['Select Type', 'User And Group'], ['Participants', rightsText(e.participants)], ['Group', rightsText(e.groups)],
  ['Administrators', semi(e.admins)], ['Highlight', e.highlight ? 'Yes' : 'No'], ['Color', e.color],
  ['Approval', e.approval ? 'Required' : 'No approval required'],
  ...e.steps.map((s: any) => [`Step ${s.position}: ${s.title}`, s.users.map((u: any) => u.label + ';').join('')] as [string, string]),
  ['Report Name', e.report_name], ['Item Type', 'Number'], ['Columns', [e.show_date && 'Date', e.show_amount && 'Amount'].filter(Boolean).join(', ') || 'Name only'],
  ['Balance/Sum', e.balance_open], ['Balance/Sum Alias', e.balance_alias], ['Notional Balance/Sum', e.notional_open], ['Notional Balance/Sum Alias', e.notional_alias],
  ['Currency', e.currency], ['Sync With Wechat: Participants', semi(e.wechat_participants)], ['Sync With Wechat: Group', semi(e.wechat_groups)], ['Password', e.locked ? 'Yes' : 'No'],
 ];
 return <>
  <Breadcrumb items={crumbs('View', e.id, e.name)}/>
  <FormPanel title="eFile Setup Adminstration">
   {rows.map(([k, v]) => <div className="field" key={k} style={{marginBottom: 10}}><div className="label" style={{marginBottom: 6}}>{k}</div><div className="view-value">{v}</div></div>)}
   <div className="field">{e.role === 'admin' && <a className="btn blue" href={href(`/ims/efile/${e.id}/edit`)}><i className="fa fa-edit"/> Edit</a>} <a className="btn plain" href={href(`/ims/efile/${e.id}`)}>Item List</a></div>
  </FormPanel>
 </>;
}

// Set Confirmation = the approval steps: ordered names and eligible approvers. Changes apply to future submissions only.
export function SetConfirmation({id}: {id: string}) {
 const [e, setE] = useState<any>(null);
 const [approval, setApproval] = useState(false);
 const [steps, setSteps] = useState<{title: string, users: Ref[]}[]>([]);
 useEffect(() => { api('efile.get', {id}).then(r => { setE(r); setApproval(!!r.approval || !r.steps.length); setSteps(r.steps.length ? r.steps.map((s: any) => ({title: s.title, users: s.users})) : [{title: '', users: []}]); }).catch(toastError); }, [id]);
 if (!e) return <Loading/>;
 const set = (i: number, v: any) => setSteps(steps.map((s, j) => j === i ? {...s, ...v} : s));
 const move = (i: number, d: number) => { const n = [...steps]; [n[i], n[i + d]] = [n[i + d], n[i]]; setSteps(n); };
 const save = async () => { try { await api('efile.steps.save', {id, approval, steps: steps.map(s => ({title: s.title, users: s.users.map(u => u.id)}))}); toast('Saved.'); go(`/ims/efile/${id}`); } catch (err) { toastError(err); } };
 return <>
  <Breadcrumb items={crumbs('Set Confirmation', e.id, e.name)}/>
  <FormPanel title="Set Confirmation" onSave={save} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <div className="field"><div className="label">Name</div><div className="view-value">{e.name}</div></div>
   <div className="field checks"><label><input type="checkbox" checked={approval} onChange={ev => setApproval(ev.target.checked)}/>Approval required for items in this eFile</label>
    <div className="hint">Approvers act step by step. Nobody can approve an item they created, submitted or edited. Changes here apply to future submissions; items already submitted keep their steps.</div></div>
   {steps.map((s, i) => <div key={i}>
    <div className="divider"/>
    <FieldRow label={<>Step {i + 1}: name <span style={{float: 'right'}}>
     {i > 0 && <button className="clear" style={{padding: 0, color: '#333', fontSize: 14}} title="Move up" onClick={() => move(i, -1)}><i className="fa fa-arrow-up"/></button>}{' '}
     {i < steps.length - 1 && <button className="clear" style={{padding: 0, color: '#333', fontSize: 14}} title="Move down" onClick={() => move(i, 1)}><i className="fa fa-arrow-down"/></button>}{' '}
     <button className="clear" style={{padding: 0, fontSize: 14}} title="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}><i className="fa fa-times"/></button></span></>}>
     <input type="text" value={s.title} placeholder={`e.g. ${["Michelle's submission check", "Manager's approval", 'Finance approval', 'Cashier', 'Final approval'][i % 5]}`} onChange={ev => set(i, {title: ev.target.value})}/></FieldRow>
    <PickedField label={`Step ${i + 1}: eligible approvers`} value={semi(s.users)} onPick={async () => { const p = await pickBox({title: `Step ${i + 1} approvers (must hold the approval function)`, selectedUsers: s.users.map(u => u.id)}); if (p) set(i, {users: p.users}); }} onClear={() => set(i, {users: []})}/>
   </div>)}
   <div className="field"><button className="btn blue" onClick={() => setSteps([...steps, {title: '', users: []}])}><i className="fa fa-plus"/> Add step</button></div>
  </FormPanel>
 </>;
}

export function SetBalance({id}: {id: string}) {
 const [f, setF] = useState<any>(null);
 useEffect(() => { api('efile.get', {id}).then(r => setF({name: r.name, balance: r.balance_open, balance_alias: r.balance_alias, notional: r.notional_open, notional_alias: r.notional_alias, total: r.balance_total, ntotal: r.notional_total, currency: r.currency})).catch(toastError); }, [id]);
 if (!f) return <Loading/>;
 const save = async () => { try { await api('efile.balance.save', {id, ...f}); toast('Saved.'); go(`/ims/efile/${id}`); } catch (e) { toastError(e); } };
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 return <>
  <Breadcrumb items={crumbs('Set Grand Balance/Sum', id, f.name)}/>
  <FormPanel title="Set Grand Balance/Sum" onSave={save} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label={`Balance/Sum (opening, ${f.currency})`}><div className="inline"><input type="text" value={f.balance} onChange={set('balance')}/><span className="muted">Current total: {f.total}</span></div></FieldRow>
   <FieldRow label="Balance/Sum Alias"><input type="text" value={f.balance_alias} onChange={set('balance_alias')} placeholder="e.g. Amount Payable to A"/></FieldRow>
   <FieldRow label={`Notional Balance/Sum (opening, ${f.currency})`}><div className="inline"><input type="text" value={f.notional} onChange={set('notional')}/><span className="muted">Current total: {f.ntotal}</span></div></FieldRow>
   <FieldRow label="Notional Balance/Sum Alias"><input type="text" value={f.notional_alias} onChange={set('notional_alias')} placeholder="e.g. Notional Amount Payable to A"/></FieldRow>
   <div className="field hint">Balance/Sum = opening balance + every entered amount (blank amounts count as nothing). Notional Balance/Sum = notional opening balance + items not yet approved, rejected or moved on.</div>
  </FormPanel>
 </>;
}

export function ProcessMonitor({id, tab = 'monitor'}: {id: string, tab?: string}) {
 const {data, error} = useLoad(() => api('efile.monitor', {id}), [id]);
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}]}/>
  <div className="tabs">
   <button className={tab === 'monitor' ? 'on' : ''} onClick={() => go(`/ims/efile/${id}/monitor`)}>eFile Process Monitor</button>
   <button className={tab === 'relevant' ? 'on' : ''} onClick={() => go(`/ims/efile/${id}/monitor?tab=relevant`)}>Relevant eFile List</button>
  </div>
  {!data ? <Loading error={error}/> : tab === 'relevant'
   ? <Panel color="blue" title={data.efile.name}><DataTable rows={data.relevant} search={false} sortable={false} pageSizes={[50]}
     columns={[{key: 'n', title: '', width: 160, render: (r: any) => data.relevant.indexOf(r) + 1}, {key: 'name', title: 'Process Name', render: (r: any) => <a className="link" href={href(`/ims/efile/${r.first_efile_id}/process`)}>{r.name}</a>},
      {key: 'first_efile', title: '1st eFile Name'}, {key: 'items', title: 'Item'}]}/></Panel>
   : <>
    <Panel title={data.efile.name}><DataTable rows={data.stages.map((s: any) => ({...s, id: String(s.position)}))} search={false} sortable={false} pageSizes={[50]} emptyText="This eFile is not part of a process."
     columns={[{key: 'position', title: '', width: 160}, {key: 'name', title: 'Name', render: (r: any) => <a href={href(`/ims/efile/${r.efile_id}?filter=process`)}>{r.name}</a>}, {key: 'items', title: 'Item'}]}/></Panel>
    <div className="gauge" title="Performance"><div style={{textAlign: 'center'}}><i className="fa fa-tachometer"/><div>性能</div></div></div>
   </>}
 </>;
}
