// "eFile" home = To Do: items waiting for my confirmation, and process stages I execute.
import {useState} from 'react';
import {api, useLoad, href} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading} from '../ui';

export function Home() {
 const [tab, setTab] = useState<'confirm' | 'executor'>('confirm');
 const confirm = useLoad(() => api<any[]>('todo.confirm'), []);
 const exec = useLoad(() => api<any[]>('todo.executor'), []);
 return <>
  <Breadcrumb items={[{label: 'eFile'}]}/>
  <div className="tabs">
   <button className={tab === 'confirm' ? 'on' : ''} onClick={() => setTab('confirm')}>Confirm</button>
   <button className={tab === 'executor' ? 'on' : ''} onClick={() => setTab('executor')}>Process Executor</button>
  </div>
  {tab === 'confirm' ? <Panel title="Confirm">
   {confirm.data ? <DataTable unit="items" rows={confirm.data} sortable={false}
    columns={[{key: 'name', title: 'Name', render: r => <a href={href(`/ims/efile/${r.efile_id}?filter=step${r.step}`)}>{r.name}</a>}]}/> : <Loading error={confirm.error}/>}
  </Panel> : <Panel title="Process Executor" color="blue">
   {exec.data ? <DataTable rows={exec.data} sortable={false}
    columns={[{key: 'name', title: 'Name', render: r => <a href={href(`/ims/efile/${r.id}?filter=process`)}>{r.name}{r.waiting ? <span className="muted"> ({r.waiting})</span> : null}</a>}]}/> : <Loading error={exec.error}/>}
  </Panel>}
 </>;
}
