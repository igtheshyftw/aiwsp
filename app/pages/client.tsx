// IMS → Client Management
import {useEffect, useState} from 'react';
import {api, useLoad, go} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, FormPanel, FieldRow, toast, toastError, confirmBox} from '../ui';

export function ClientList() {
 const {data, error, reload} = useLoad(() => api<any[]>('client.list'), []);
 const del = async (r: any) => { if (await confirmBox(`Delete client ${r.code}?`)) try { await api('client.delete', {id: r.id}); reload(); } catch (e) { toastError(e); } };
 const exportCsv = () => {
  const rows = [['Code', 'CN Name', 'EN Name', 'Contact', 'Phone', 'Email', 'Address'], ...(data ?? []).map(r => [r.code, r.name_cn, r.name_en, r.contact, r.phone, r.email, r.address])];
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

export function ClientForm({id}: {id?: string}) {
 const [f, setF] = useState<any>({code: '', name_cn: '', name_en: '', contact: '', phone: '', email: '', address: '', remark: ''});
 useEffect(() => { if (id) api('client.get', {id}).then(setF).catch(toastError); }, [id]);
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 const save = async () => { try { await api('client.save', {...f, id}); toast('Saved.'); go('/ims/client'); } catch (e) { toastError(e); } };
 return <>
  <Breadcrumb items={[{label: 'Client Management', to: '/ims/client'}, {label: id ? 'Edit Client' : 'Add Client'}]}/>
  <FormPanel title="Client Setup Adminstration" onSave={save} actions={<><button className="btn-sq grey" onClick={() => go('/ims/client')} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <FieldRow label="Code" req><input type="text" value={f.code} onChange={set('code')}/></FieldRow>
   <FieldRow label="CN Name"><input type="text" value={f.name_cn} onChange={set('name_cn')}/></FieldRow>
   <FieldRow label="EN Name"><input type="text" value={f.name_en} onChange={set('name_en')}/></FieldRow>
   <FieldRow label="Contact"><input type="text" value={f.contact} onChange={set('contact')}/></FieldRow>
   <FieldRow label="Phone"><input type="text" value={f.phone} onChange={set('phone')}/></FieldRow>
   <FieldRow label="Email"><input type="email" value={f.email} onChange={set('email')}/></FieldRow>
   <FieldRow label="Address"><textarea value={f.address} onChange={set('address')}/></FieldRow>
   <FieldRow label="Remark"><textarea value={f.remark} onChange={set('remark')}/></FieldRow>
  </FormPanel>
 </>;
}
