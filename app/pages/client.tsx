// IMS → Client Management
import {useEffect, useState} from 'react';
import {api, useLoad, go, semi} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, toast, toastError, confirmBox, pickBox} from '../ui';

export function ClientList() {
 const {data, error, reload} = useLoad(() => api<any[]>('client.list'), []);
 const del = async (r: any) => { if (await confirmBox(`Delete client ${r.code}?`)) try { await api('client.delete', {id: r.id}); reload(); } catch (e) { toastError(e); } };
 const exportCsv = () => {
  const rows = [['Code', 'CN Name', 'EN Name', 'Telephone', 'Fax', 'Introducer', 'Website', 'Address', 'Business', 'Note'],
   ...(data ?? []).map(r => [r.code, r.name_cn, r.name_en, r.phone, r.fax, r.introducer, r.website, r.address, r.business, r.remark])];
  const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = 'clients.csv'; a.click(); URL.revokeObjectURL(a.href);
 };
 return <>
  <Breadcrumb items={[{label: 'Client Management'}, {label: 'Client List'}]}/>
  <Panel title="Client List" tools={<><button className="btn green" onClick={() => go('/ims/client/new')}><i className="fa fa-plus"/> Add</button><button className="tool boxed" title="Export" onClick={exportCsv}><i className="fa fa-cog"/></button></>}>
   {data ? <DataTable rows={data} unit="items" columns={[
    {key: 'code', title: 'Code', sort: r => r.code}, {key: 'name_cn', title: 'CN Name', sort: r => r.name_cn}, {key: 'name_en', title: 'EN Name'}]}
    menu={r => [{icon: 'fa-edit', label: 'Edit', onClick: () => go('/ims/client/' + r.id)}, {icon: 'fa-times', label: 'Delete', onClick: () => del(r)}]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}

const STEPS = ['Basic Info', 'Background Info', 'Service Team'];
type Ref = {id: string, label: string};

// Client Info, as in IMS: three steps with a progress bar, Continue/Back, and Save on the last step.
export function ClientForm({id}: {id?: string}) {
 const [f, setF] = useState<any>(id ? null : {code: '', name_cn: '', name_en: '', phone: '', fax: '', introducer: '', website: '', address: '', business: '', remark: '', team_type: 'group', users: [], groups: []});
 const [step, setStep] = useState(0);
 const [open, setOpen] = useState(true);
 const [treeOpen, setTreeOpen] = useState(true);
 const {data: dir} = useLoad(() => api('directory'), []);
 useEffect(() => { if (id) api('client.get', {id}).then(setF).catch(toastError); }, [id]);
 if (!f) return <Loading/>;
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 const input = (k: string, label: string, req?: boolean) =>
  <div className="wz-field" key={k}><label className={req ? 'req' : ''} htmlFor={'c-' + k}>{label}</label><input id={'c-' + k} type="text" value={f[k]} onChange={set(k)}/></div>;
 const next = () => {
  if (step === 0) { const miss = [['code', 'Code'], ['name_cn', 'CN Name'], ['name_en', 'EN Name']].find(([k]) => !f[k].trim()); if (miss) return toastError(`${miss[1]} is required.`); }
  setStep(step + 1); window.scrollTo(0, 0);
 };
 const save = async () => {
  try { await api('client.save', {...f, id, users: f.users.map((u: Ref) => u.id), groups: f.groups.map((g: Ref) => g.id)}); toast('Saved.'); go('/ims/client'); } catch (e) { toastError(e); }
 };
 const pickUsers = async () => { const p = await pickBox({title: 'Service Team: Participants', selectedUsers: f.users.map((u: Ref) => u.id)}); if (p) setF({...f, users: p.users}); };
 const toggleGroup = (g: Ref) => setF({...f, groups: f.groups.some((x: Ref) => x.id === g.id) ? f.groups.filter((x: Ref) => x.id !== g.id) : [...f.groups, g]});
 const allGroups: Ref[] = (dir?.groups ?? []).map((g: any) => ({id: g.id, label: g.name}));
 const byUser = f.team_type === 'user';
 return <>
  <h1 className="page-title">Client<small>——Client Info</small></h1>
  <Breadcrumb items={[{label: 'Client Management', to: '/ims/client'}, {label: 'Client List', to: '/ims/client'}, {label: id ? 'Edit' : 'Add'}]}/>
  <section className="panel wizard">
   <div className="panel-head blue" role="button" tabIndex={0} onClick={() => setOpen(!open)} onKeyDown={e => { if (e.key === 'Enter') setOpen(!open); }}>
    <i className="fa fa-bars"/> Client Info - Step {step + 1} of 3<div className="tools"><i className={'fa ' + (open ? 'fa-angle-down' : 'fa-angle-up')} style={{fontSize: 24}}/></div></div>
   {open && <>
    <div className="wz-steps">{STEPS.map((t, i) => <div key={t} className={'wz-step' + (i < step ? ' done' : i === step ? ' on' : '')}>
     <span className="num">{i + 1}</span><span className="t">{i < step && <i className="fa fa-check"/>} {t}</span></div>)}</div>
    <div className="wz-bar"><div style={{width: `${(step + 1) / 3 * 100}%`}}/></div>
    <div className="wz-body">
     {step === 0 && <>
      <h2>1:Basic Info</h2>
      <h3>Client basic Info</h3>
      <div className="wz-grid">{input('code', 'Code', true)}<span/>{input('name_cn', 'CN Name', true)}{input('name_en', 'EN Name', true)}{input('phone', 'Telephone')}{input('fax', 'Fax')}</div>
      <h3>Introducer Info</h3>
      <div className="wz-grid">{input('introducer', 'Introducer')}</div>
     </>}
     {step === 1 && <>
      <h2>2:Profile</h2>
      <div className="wz-single">{input('website', 'Website')}{input('address', 'Address')}{input('business', 'Business')}
       <div className="wz-field"><label htmlFor="c-remark">Note</label><textarea id="c-remark" rows={4} value={f.remark} onChange={set('remark')}/></div></div>
     </>}
     {step === 2 && <>
      <h2>3:Service Team</h2>
      <div className="wz-single">
       <div className="wz-field"><label>Select Type</label><label className="radio"><input type="radio" name="team" checked={byUser} onChange={() => setF({...f, team_type: 'user'})}/> User</label></div>
       <div className="wz-field"><label>Participants</label><div className="picked">
        <div className={'box' + (byUser ? '' : ' off')} role="button" tabIndex={byUser ? 0 : -1} aria-disabled={!byUser} onClick={() => byUser && pickUsers()} onKeyDown={e => { if (byUser && e.key === 'Enter') pickUsers(); }}>{semi(f.users)}</div>
        <button className="clear" aria-label="Clear Participants" onClick={() => setF({...f, users: []})}><i className="fa fa-times-circle-o"/></button></div></div>
       <div className="wz-field"><label>Select Type</label><label className="radio"><input type="radio" name="team" checked={!byUser} onChange={() => setF({...f, team_type: 'group'})}/> Group</label></div>
       <div className="wz-field"><label>Group</label><div>
        <div className="picked"><div className={'box' + (byUser ? ' off' : '')}>{semi(f.groups)}</div>
         <button className="clear" aria-label="Clear Group" onClick={() => setF({...f, groups: []})}><i className="fa fa-times-circle-o"/></button></div>
        <div className="tree">
         <label><button className="twisty" aria-label={treeOpen ? 'Collapse' : 'Expand'} onClick={() => setTreeOpen(!treeOpen)}><i className={'fa ' + (treeOpen ? 'fa-minus-square-o' : 'fa-plus-square-o')}/></button> User Group</label>
         {treeOpen && (allGroups.length ? allGroups.map(g => <label key={g.id} className="leaf"><input type="checkbox" disabled={byUser} checked={f.groups.some((x: Ref) => x.id === g.id)} onChange={() => toggleGroup(g)}/>{g.label}</label>)
          : <div className="leaf muted">No user groups yet. Add them under Account → User Group.</div>)}
        </div></div></div>
       <div className="hint">The service team is the WSP users or groups responsible for this client. Only the selected type is saved.</div>
      </div>
     </>}
    </div>
    <div className="wz-foot">
     {step > 0 && <button className="btn grey" onClick={() => setStep(step - 1)}><i className="fa fa-arrow-circle-o-left"/> Back</button>}
     {step < 2 ? <button className="btn blue" onClick={next}>Continue <i className="fa fa-arrow-circle-o-right"/></button>
      : <button className="btn green" onClick={save}>Save <i className="fa fa-arrow-circle-o-right"/></button>}
    </div>
   </>}
  </section>
 </>;
}
