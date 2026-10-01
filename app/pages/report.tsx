// IMS → Reports: open work, overdue, approvals and completions across the eFiles I take part in.
import {useState} from 'react';
import {api, useLoad, href} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, type Me} from '../ui';

const download = (name: string, rows: (string | number | null)[][]) => {
 const csv = '﻿' + rows.map(r => r.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
 const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = name; a.click(); URL.revokeObjectURL(a.href);
};

export function Reports({me}: {me: Me}) {
 const [f, setF] = useState({from: '', to: '', clientId: ''});
 const [q, setQ] = useState(f);
 const {data, error} = useLoad(() => api('report.work', q), [q.from, q.to, q.clientId]);
 const canExport = me.functions.includes('export');
 const groupTable = (title: string, rows: any[], first: string, file: string) => <Panel title={title} tools={canExport && rows.length > 0 &&
  <button className="tool boxed" title="Export CSV" onClick={() => download(file, [[first, 'Open', 'Overdue', 'Due within 7 days', 'Pending approval', `Finished ${data.from} – ${data.to}`], ...rows.map(r => [r.label, r.open, r.overdue, r.due_soon, r.pending, r.finished])])}><i className="fa fa-download"/></button>}>
  <DataTable rows={rows.map(r => ({...r, id: r.key || '-'}))} search={false} pageSize={25} unit="rows" emptyText="Nothing in this period." columns={[
   {key: 'label', title: first, sort: (r: any) => r.label},
   {key: 'open', title: 'Open', className: 'num', sort: (r: any) => r.open},
   {key: 'overdue', title: 'Overdue', className: 'num', sort: (r: any) => r.overdue, render: (r: any) => r.overdue ? <span className="special">{r.overdue}</span> : 0},
   {key: 'due_soon', title: 'Due within 7 days', className: 'num', sort: (r: any) => r.due_soon},
   {key: 'pending', title: 'Pending approval', className: 'num', sort: (r: any) => r.pending},
   {key: 'finished', title: 'Finished in period', className: 'num', sort: (r: any) => r.finished}]}/>
 </Panel>;
 const s = data?.summary;
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'Reports'}]}/>
  <Panel title="Reports" color="blue">
   <div className="filters" style={{margin: '2px 0 12px'}}>
    <label>From <input type="date" value={f.from || data?.from || ''} onChange={e => setF({...f, from: e.target.value})}/></label>
    <label>To <input type="date" value={f.to || data?.to || ''} onChange={e => setF({...f, to: e.target.value})}/></label>
    {data?.clients.length > 0 && <label>Client <select value={f.clientId} onChange={e => setF({...f, clientId: e.target.value})} style={{height: 31, minWidth: 180}}>
     <option value="">All</option>{data.clients.map((cl: any) => <option key={cl.id} value={cl.id}>{cl.code} {cl.name_cn}</option>)}</select></label>}
    <button className="btn blue" onClick={() => setQ(f)}>Apply</button>
    <span className="muted">Only eFiles you take part in are counted. "Finished" = approved or marked complete in the period.</span>
   </div>
   {!s ? <Loading error={error}/> : <div className="table-wrap"><table className="dt report-summary"><thead><tr>
    <th>Open items</th><th>Overdue</th><th>Pending approval</th><th>Finished in period</th><th>Finished on time</th><th>Average approval time</th></tr></thead>
    <tbody><tr><td>{s.open}</td><td className={s.overdue ? 'special' : ''}>{s.overdue}</td><td>{s.pending}</td><td>{s.finished}</td>
     <td>{s.on_time === null ? '—' : `${s.on_time}%`}</td><td>{s.avg_approval_days === null ? '—' : `${s.avg_approval_days} days`} {s.approvals > 0 && <span className="muted">({s.approvals} approved)</span>}</td></tr></tbody></table></div>}
  </Panel>
  {data && <>
   {groupTable('By responsible person', data.by_person, 'Responsible', 'report-people.csv')}
   {data.by_client.length > 0 && groupTable('By client', data.by_client, 'Client', 'report-clients.csv')}
   {groupTable('By eFile', data.by_efile, 'eFile', 'report-efiles.csv')}
   <Panel title="Approvals waiting longest">
    <DataTable rows={data.waiting} search={false} sortable={false} unit="items" emptyText="No approvals are waiting." columns={[
     {key: 'days', title: 'Waiting', width: 110, render: (r: any) => `${r.days} day${r.days === 1 ? '' : 's'}`},
     {key: 'name', title: 'Item', render: (r: any) => <a href={href(`/ims/efile/${r.efile_id}/item/${r.id}`)}>#{r.seq} {r.name}</a>},
     {key: 'step', title: 'Step'}]}/>
   </Panel>
  </>}
 </>;
}
