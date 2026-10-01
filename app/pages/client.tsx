// IMS → Client Management
import {useEffect, useState} from 'react';
import {api, useLoad, go, semi, fmtTime} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, toast, toastError, confirmBox, pickBox} from '../ui';

export function ClientList({mine}: {mine?: boolean}) {
 const {data, error, reload} = useLoad(() => api('client.list', {mine: !!mine}), [mine]);
 const rows: any[] = data?.rows ?? [];
 const del = async (r: any) => { if (await confirmBox(`Delete client ${r.code}? Its eFiles stay; they are no longer marked with this client.`)) try { await api('client.delete', {id: r.id}); reload(); } catch (e) { toastError(e); } };
 const exportCsv = () => {
  const out = [['Code', 'CN Name', 'EN Name', 'Company Account', 'Telephone', 'Fax', 'Introducer', 'Website', 'Address', 'Business', 'Note'],
   ...rows.map(r => [r.code, r.name_cn, r.name_en, r.account, r.phone, r.fax, r.introducer, r.website, r.address, r.business, r.remark])];
  const csv = '\ufeff' + out.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = 'clients.csv'; a.click(); URL.revokeObjectURL(a.href);
 };
 return <>
  <Breadcrumb items={[{label: 'Client Management'}, {label: 'Client List'}]}/>
  <Panel title={mine ? 'Client List › My clients' : 'Client List'} tools={<>{data?.can_manage && <button className="btn green" onClick={() => go('/ims/client/new')}><i className="fa fa-plus"/> Add</button>}
   <button className="tool boxed" title="Export" onClick={exportCsv}><i className="fa fa-cog"/></button></>}>
   {data?.can_manage && <div className="filters" style={{margin: '0 0 10px'}}>
    <label><input type="checkbox" checked={!!mine} onChange={e => go(e.target.checked ? '/ims/client?mine=1' : '/ims/client')}/> Only clients I serve (Service Team)</label></div>}
   {data ? <DataTable rows={rows} unit="items" emptyText={mine ? 'You are not on any client\'s service team.' : undefined} columns={[
    {key: 'code', title: 'Code', sort: r => r.code, render: r => <a className="link" href={`#/ims/client/${r.id}`}>{r.code}</a>},
    {key: 'name_cn', title: 'CN Name', sort: r => r.name_cn, render: r => <>{r.name_cn}{r.mine && <span className="ext">My client</span>}</>},
    {key: 'name_en', title: 'EN Name', sort: r => r.name_en},
    {key: 'account', title: 'Company Account', sort: r => r.account},
    {key: 'efiles', title: 'eFiles', className: 'num', sort: r => r.efiles}]}
    menu={r => [{icon: 'fa-eye', label: 'View', onClick: () => go('/ims/client/' + r.id)},
     ...(data.can_manage ? [{icon: 'fa-edit', label: 'Edit', onClick: () => go(`/ims/client/${r.id}/edit`)}, {icon: 'fa-times', label: 'Delete', onClick: () => del(r)}] : [])]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}

// One page per client: details, service team, linked company account, its eFiles with open and overdue work, and its conversations.
export function ClientView({id}: {id: string}) {
 const {data, error} = useLoad(() => api('client.view', {id}), [id]);
 const {data: chats} = useLoad(() => data?.client.account_company_id ? api('chat.inbox', {companyId: data.client.account_company_id, filter: 'all'}).catch(() => null) : Promise.resolve(null), [data?.client.account_company_id]);
 if (!data) return <Loading error={error}/>;
 const cl = data.client;
 const row = (label: string, value: any) => value ? <div className="cv-row"><span>{label}</span><div>{value}</div></div> : null;
 return <>
  <h1 className="page-title">Client<small>——{cl.code} {cl.name_cn}</small></h1>
  <Breadcrumb items={[{label: 'Client Management', to: '/ims/client'}, {label: 'Client List', to: '/ims/client'}, {label: cl.code}]}
   tools={data.can_manage && <button className="btn blue" onClick={() => go(`/ims/client/${id}/edit`)}><i className="fa fa-edit"/> Edit</button>}/>
  <div className="cv-grid">
   <Panel title="Client Info">
    {row('Code', cl.code)}{row('CN Name', cl.name_cn)}{row('EN Name', cl.name_en)}{row('Telephone', cl.phone)}{row('Fax', cl.fax)}{row('Introducer', cl.introducer)}
    {row('Website', cl.website)}{row('Address', cl.address)}{row('Business', cl.business)}{cl.remark && row('Note', <span style={{whiteSpace: 'pre-wrap'}}>{cl.remark}</span>)}
    {row('Company Account', data.account ? <>{data.account.label} <span className="muted">· {data.account.users} active user{data.account.users === 1 ? '' : 's'}</span>{data.account.status !== 'normal' && <span className="special">(Suspended)</span>}</>
     : <span className="muted">Not linked. Link it under Edit so the client's own users and conversations show here.</span>)}
   </Panel>
   <Panel title="Service Team">
    {row(cl.team_type === 'user' ? 'Users' : 'Groups', semi(cl.team_type === 'user' ? cl.users : cl.groups) || <span className="muted">None chosen</span>)}
    {row('Serving now', data.team_now.join('; ') || <span className="muted">No active members</span>)}
    <p className="hint">The service team is offered as participants when an eFile is created for this client, and is notified first about the client's AiWSP Assistant conversations.</p>
   </Panel>
  </div>
  <Panel title="eFiles" tools={data.can_create_efile && <button className="btn green" onClick={() => go(`/ims/efile/new?client=${id}`)}><i className="fa fa-plus"/> New eFile for this client</button>}>
   <DataTable rows={data.efiles} search={false} unit="eFiles" emptyText="No eFiles for this client that you take part in." columns={[
    {key: 'name', title: 'eFile', sort: (r: any) => r.name, render: (r: any) => <><a className="link" href={`#/ims/efile/${r.id}`}>{r.name}</a>{!!r.archived && <span className="ext">archived</span>}</>},
    {key: 'open', title: 'Open items', className: 'num', sort: (r: any) => r.open},
    {key: 'pending', title: 'Pending approval', className: 'num', sort: (r: any) => r.pending},
    {key: 'overdue', title: 'Overdue', className: 'num', sort: (r: any) => r.overdue, render: (r: any) => r.overdue ? <span className="special">{r.overdue}</span> : 0},
    {key: 'next_due', title: 'Next target date', sort: (r: any) => r.next_due ?? '9999'}]}/>
   {data.hidden_efiles > 0 && <p className="hint">{data.hidden_efiles} more eFile{data.hidden_efiles === 1 ? '' : 's'} of this client {data.hidden_efiles === 1 ? 'is' : 'are'} not shown because you do not take part in {data.hidden_efiles === 1 ? 'it' : 'them'}.</p>}
  </Panel>
  {chats && <Panel title="AiWSP Assistant conversations">
   <DataTable rows={chats.rows} search={false} unit="conversations" emptyText="No conversations yet." columns={[
    {key: 'title', title: 'Conversation', render: (r: any) => <a className="link" href={`#/assistant/inbox/${r.id}`}>{r.title}</a>},
    {key: 'client', title: 'From'}, {key: 'status', title: 'Status', render: (r: any) => r.review ? 'Answer to review' : r.status === 'waiting' ? 'Waiting for WSP' : r.status === 'closed' ? 'Closed' : 'Open'},
    {key: 'updated_at', title: 'Updated', sort: (r: any) => r.updated_at, render: (r: any) => fmtTime(r.updated_at).slice(0, 16)}]}/>
  </Panel>}
 </>;
}

const STEPS = ['Basic Info', 'Background Info', 'Service Team'];
type Ref = {id: string, label: string};

// Client Info, as in IMS: three steps with a progress bar, Continue/Back, and Save on the last step.
export function ClientForm({id}: {id?: string}) {
 const [f, setF] = useState<any>(id ? null : {code: '', name_cn: '', name_en: '', phone: '', fax: '', introducer: '', website: '', address: '', business: '', remark: '', team_type: 'group', users: [], groups: [], account_company_id: ''});
 const [step, setStep] = useState(0);
 const [open, setOpen] = useState(true);
 const [treeOpen, setTreeOpen] = useState(true);
 const {data: dir} = useLoad(() => api('directory'), []);
 const {data: form} = useLoad(() => api('client.form'), []);
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
  try { await api('client.save', {...f, id, account_company_id: f.account_company_id || '', users: f.users.map((u: Ref) => u.id), groups: f.groups.map((g: Ref) => g.id)}); toast('Saved.'); go(id ? `/ims/client/${id}` : '/ims/client'); } catch (e) { toastError(e); }
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
      <div className="wz-grid">{input('code', 'Code', true)}<span/>{input('name_cn', 'CN Name', true)}{input('name_en', 'EN Name', true)}{input('phone', 'Telephone')}{input('fax', 'Fax')}
       <div className="wz-field"><label htmlFor="c-account">Company Account</label><div><select id="c-account" value={f.account_company_id ?? ''} onChange={set('account_company_id')}>
        <option value="">— Not linked —</option>{(form?.accounts ?? []).map((a: any) => <option key={a.id} value={a.id}>{a.label}</option>)}</select>
        <div className="hint">The client's own company account (its users sign in to IMS and the AiWSP Assistant). Only connected companies can be linked.</div></div></div></div>
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
