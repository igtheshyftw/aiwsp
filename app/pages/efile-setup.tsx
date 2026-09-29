// eFile Setup Adminstration (create/edit/view), Set Confirmation, Set Grand Balance/Sum and eFile Process Monitor.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, semi} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, FormPanel, FieldRow, PickedField, toast, toastError, pickBox} from '../ui';

type Ref = {id: string, label: string};
const crumbs = (last: string, id?: string, name?: string) => [{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, ...(id && name ? [{label: name, to: `/ims/efile/${id}`}] : []), {label: last}];

export function EfileForm({id}: {id?: string}) {
 const [f, setF] = useState<any>({name: '', tag: '', highlight: false, color: '', report_name: '', currency: 'CNY', participants: [] as Ref[], groups: [] as Ref[], admins: [] as Ref[], wechat_participants: [] as Ref[], wechat_groups: [] as Ref[]});
 const [colors, setColors] = useState<string[]>([]);
 useEffect(() => {
  api('efile.form').then(r => setColors(r.colors)).catch(toastError);
  if (id) api('efile.get', {id}).then(setF).catch(toastError);
  else api('profile.get').then(me => { const self = [{id: me.id, label: me.username}]; setF((x: any) => ({...x, participants: self, admins: self})); }).catch(toastError);
 }, [id]);
 const pickUsers = (key: string, title: string) => async () => { const p = await pickBox({title, selectedUsers: f[key].map((x: Ref) => x.id)}); if (p) setF({...f, [key]: p.users}); };
 const pickGroups = (key: string, title: string) => async () => { const p = await pickBox({title, users: false, groups: true, selectedGroups: f[key].map((x: Ref) => x.id)}); if (p) setF({...f, [key]: p.groups}); };
 const clear = (key: string) => () => setF({...f, [key]: []});
 const ids = (k: string) => f[k].map((x: Ref) => x.id);
 const save = async () => {
  try {
   const r = await api('efile.save', {id, name: f.name, tag: f.tag, highlight: f.highlight, color: f.color, report_name: f.report_name, currency: f.currency,
    participants: ids('participants'), groups: ids('groups'), admins: ids('admins'), wechat_participants: ids('wechat_participants'), wechat_groups: ids('wechat_groups')});
   toast('Saved.'); go(`/ims/efile/${r.id}`);
  } catch (e) { toastError(e); }
 };
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}]}/>
  <FormPanel title="eFile Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Name" req><textarea value={f.name} onChange={e => setF({...f, name: e.target.value})}/></FieldRow>
   <FieldRow label="Tag"><textarea value={f.tag} onChange={e => setF({...f, tag: e.target.value})}/></FieldRow>
   <FieldRow label="Item Template Folder"><button className="btn-sq" style={{width: 44}} title="Choose folder" onClick={() => toast('Item templates are not set up yet.')}><i className="fa fa-check-square-o"/></button></FieldRow>
   <div className="field"><label>Select Type</label><label style={{display: 'flex', gap: 8, alignItems: 'center'}}><input type="radio" checked readOnly/> User And Group</label></div>
   <PickedField label="Participants" req value={semi(f.participants)} onPick={pickUsers('participants', 'Participants')} onClear={clear('participants')}/>
   <PickedField label="Group" value={semi(f.groups)} onPick={pickGroups('groups', 'Group')} onClear={clear('groups')}/>
   <div className="divider"/>
   <PickedField label="Administrators" req value={semi(f.admins)} onPick={pickUsers('admins', 'Administrators')} onClear={clear('admins')}/>
   <div className="divider"/>
   <PickedField label="Sync With Wechat: Participants" value={semi(f.wechat_participants)} onPick={pickUsers('wechat_participants', 'Sync With Wechat: Participants')} onClear={clear('wechat_participants')}/>
   <PickedField label="Sync With Wechat: Group" value={semi(f.wechat_groups)} onPick={pickGroups('wechat_groups', 'Sync With Wechat: Group')} onClear={clear('wechat_groups')}/>
   <div className="divider"/>
   <div className="field checks"><label><input type="checkbox" checked={!!f.highlight} onChange={e => setF({...f, highlight: e.target.checked})}/>Highlight</label></div>
   <FieldRow label="Color"><select value={f.color} onChange={e => setF({...f, color: e.target.value})}>{colors.map(c => <option key={c} value={c}>{c || '—'}</option>)}</select></FieldRow>
   <FieldRow label="Report Name"><input type="text" value={f.report_name} onChange={e => setF({...f, report_name: e.target.value})}/></FieldRow>
   <FieldRow label="Item Type"><select disabled value="number"><option value="number">Number</option></select></FieldRow>
   <FieldRow label="Currency"><input type="text" value={f.currency} maxLength={8} onChange={e => setF({...f, currency: e.target.value})}/></FieldRow>
  </FormPanel>
 </>;
}

export function EfileView({id}: {id: string}) {
 const {data: e, error} = useLoad(() => api('efile.get', {id}), [id]);
 if (!e) return <Loading error={error}/>;
 const ord = ['1st', '2nd', '3rd', '4th', '5th'];
 const rows: [string, string][] = [
  ['Name', e.name], ['Tag', e.tag], ['Select Type', 'User And Group'], ['Participants', semi(e.participants)], ['Group', semi(e.groups)],
  ['Administrators', semi(e.admins)], ['Highlight', e.highlight ? 'Yes' : 'No'], ['Color', e.color],
  ...ord.map((o, i) => [`${o} Confirmation`, e.steps.find((s: any) => s.position === i + 1)?.users.map((u: any) => u.label + ';').join('') ?? ''] as [string, string]),
  ['Report Name', e.report_name], ['Item Type', 'Number'], ['Balance/Sum', e.balance_open], ['Balance/Sum Alias', e.balance_alias], ['Notional Balance/Sum', e.notional_open], ['Notional Balance/Sum Alias', e.notional_alias],
  ['Currency', e.currency], ['Sync With Wechat: Participants', semi(e.wechat_participants)], ['Sync With Wechat: Group', semi(e.wechat_groups)], ['Password', e.locked ? 'Yes' : 'No'],
 ];
 return <>
  <Breadcrumb items={crumbs('View', e.id, e.name)}/>
  <FormPanel title="eFile Setup Adminstration">
   {rows.map(([k, v]) => <div className="field" key={k} style={{marginBottom: 10}}><div className="label" style={{marginBottom: 6}}>{k}</div><div className="view-value">{v}</div></div>)}
   <div className="field"><a className="btn blue" href={href(`/ims/efile/${e.id}/edit`)}><i className="fa fa-edit"/> Edit</a> <a className="btn plain" href={href(`/ims/efile/${e.id}`)}>Item List</a></div>
  </FormPanel>
 </>;
}

export function SetConfirmation({id}: {id: string}) {
 const [e, setE] = useState<any>(null);
 const [steps, setSteps] = useState<{title: string, users: Ref[]}[]>([]);
 useEffect(() => { api('efile.get', {id}).then(r => { setE(r); setSteps(Array.from({length: 5}, (_, i) => { const s = r.steps.find((x: any) => x.position === i + 1); return {title: s?.title ?? '', users: s?.users ?? []}; })); }).catch(toastError); }, [id]);
 if (!e) return <Loading/>;
 const ord = ['1st', '2nd', '3rd', '4th', '5th'];
 const set = (i: number, v: any) => setSteps(steps.map((s, j) => j === i ? {...s, ...v} : s));
 const save = async () => { try { await api('efile.steps.save', {id, steps: steps.map(s => ({title: s.title, users: s.users.map(u => u.id)}))}); toast('Saved.'); go(`/ims/efile/${id}`); } catch (err) { toastError(err); } };
 return <>
  <Breadcrumb items={crumbs('Set Confirmation', e.id, e.name)}/>
  <FormPanel title="Set Confirmation" onSave={save} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <div className="field"><div className="label">Name</div><div className="view-value">{e.name}</div></div>
   {steps.map((s, i) => <div key={i}>
    <div className="divider"/>
    <FieldRow label={`${ord[i]} Confirmation: Title`}><input type="text" value={s.title} placeholder={`e.g. ${['Submission', 'Checking', "Manager's approval", 'Cashier', 'Final approval'][i]}`} onChange={ev => set(i, {title: ev.target.value})}/></FieldRow>
    <PickedField label={`${ord[i]} Confirmation`} value={semi(s.users)} onPick={async () => { const p = await pickBox({title: `${ord[i]} Confirmation`, selectedUsers: s.users.map(u => u.id)}); if (p) set(i, {users: p.users}); }} onClear={() => set(i, {users: []})}/>
   </div>)}
   <div className="field hint">Steps are signed in order. A step without users is skipped. Each item chooses which steps it needs.</div>
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
   <div className="field hint">Balance/Sum = opening balance + every item. Notional Balance/Sum = notional opening balance + items not yet completed.</div>
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
