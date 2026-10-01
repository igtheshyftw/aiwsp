// "eFile" home = To Do: approvals waiting for me, my assigned work, deadlines (overdue and due this week), my items to correct or submit, paused approvals I administer, and process stages I execute.
import {useState} from 'react';
import {api, useLoad, href} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading} from '../ui';

const TABS: [string, string, string][] = [['confirm', 'Confirm', 'todo.confirm'], ['mywork', 'My Work', 'todo.mywork'], ['deadlines', 'Deadlines', 'todo.deadlines'], ['mine', 'My Items', 'todo.returned'], ['paused', 'Paused', 'todo.paused'], ['executor', 'Process Executor', 'todo.executor']];

export function Home() {
 const [tab, setTab] = useState('confirm');
 const [, , action] = TABS.find(t => t[0] === tab)!;
 const {data, error} = useLoad(() => api<any[]>(action), [action]);
 const {data: counts} = useLoad(() => api<any>('counters'), []);
 return <>
  <Breadcrumb items={[{label: 'eFile'}]}/>
  <div className="tabs">{TABS.map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{l}{k === 'deadlines' && counts?.overdue ? <span className="tab-count">{counts.overdue}</span> : k === 'mywork' && counts?.mywork ? <span className="tab-count blue">{counts.mywork}</span> : null}</button>)}</div>
  {!data ? <Loading error={error}/> : tab === 'deadlines' || tab === 'mywork'
   ? <Panel title={tab === 'mywork' ? 'My Work — open items I am responsible for' : 'Deadlines — overdue and due within 7 days'} color="blue"><DataTable unit="items" rows={data} sortable={false}
     emptyText={tab === 'mywork' ? 'No open items are assigned to you.' : 'Nothing overdue or due this week.'} rowClass={r => r.overdue ? 'overdue' : ''} columns={[
     {key: 'target_date', title: 'Target Date', width: 120},
     {key: 'days', title: 'When', width: 150, render: r => r.days === null ? '' : r.overdue ? <span className="special">{-r.days} day{r.days === -1 ? '' : 's'} overdue</span> : r.days === 0 ? <b>Today</b> : `In ${r.days} day${r.days === 1 ? '' : 's'}`},
     {key: 'seq', title: 'ID', width: 90, render: r => `#${r.seq}`},
     {key: 'name', title: 'Name', render: r => <a href={href(`/ims/efile/${r.efile_id}/item/${r.id}`)}>{r.name}</a>},
     {key: 'client', title: 'Client', width: 120},
     ...(tab === 'deadlines' ? [{key: 'responsible', title: 'Responsible', width: 170}] : []),
     {key: 'status_label', title: 'Status', width: 190}]}/></Panel>
   : tab === 'executor'
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
