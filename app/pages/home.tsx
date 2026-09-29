// "eFile" home = To Do: approvals waiting for me, my items to correct or submit, paused approvals I administer, and process stages I execute.
import {useState} from 'react';
import {api, useLoad, href} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading} from '../ui';

const TABS: [string, string, string][] = [['confirm', 'Confirm', 'todo.confirm'], ['mine', 'My Items', 'todo.returned'], ['paused', 'Paused', 'todo.paused'], ['executor', 'Process Executor', 'todo.executor']];

export function Home() {
 const [tab, setTab] = useState('confirm');
 const [, , action] = TABS.find(t => t[0] === tab)!;
 const {data, error} = useLoad(() => api<any[]>(action), [action]);
 return <>
  <Breadcrumb items={[{label: 'eFile'}]}/>
  <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}</button>)}</div>
  {!data ? <Loading error={error}/> : tab === 'executor'
   ? <Panel title="Process Executor" color="blue"><DataTable rows={data} sortable={false}
     columns={[{key: 'name', title: 'Name', render: r => <a href={href(`/ims/efile/${r.id}?filter=process`)}>{r.name}{r.waiting ? <span className="muted"> ({r.waiting})</span> : null}</a>}]}/></Panel>
   : <Panel title={{confirm: 'Confirm', mine: 'My Items — drafts, returned and withdrawn', paused: 'Paused approvals — assign an approver'}[tab]} color={tab === 'confirm' ? 'grey' : 'blue'}>
     <DataTable unit="items" rows={data} sortable={false} columns={[
      {key: 'seq', title: 'ID', width: 90, render: r => `#${r.seq}`},
      {key: 'name', title: 'Name', render: r => <a href={href(`/ims/efile/${r.efile_id}/item/${r.id}`)}>{r.name}</a>},
      ...(tab === 'mine' ? [{key: 'status_label', title: 'Status'}] : tab === 'confirm' ? [{key: 'step', title: 'Step', width: 80}] : []),
     ]}/></Panel>}
 </>;
}
