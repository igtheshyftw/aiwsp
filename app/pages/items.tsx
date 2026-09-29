// Item List inside an eFile: pinned balance rows, markers, filters, bulk actions, confirm/commit.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, colorClass, today} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, Tool, ToolMenu, Menu, toast, toastError, confirmBox, formBox, type MenuItem} from '../ui';

// eFile passwords typed this session, so the user is asked once per eFile.
const passwords = new Map<string, string>();
export async function withPassword<T>(efileId: string, call: (password?: string) => Promise<T>): Promise<T> {
 try { return await call(passwords.get(efileId)); } catch (e: any) {
  if (e.message !== 'PASSWORD_REQUIRED') throw e;
  const v = await formBox('This eFile is password protected', [{name: 'password', label: 'eFile Password', type: 'password', required: true}]);
  if (!v) throw new Error('Password required.');
  try { const r = await call(v.password); passwords.set(efileId, v.password); return r; } catch (err: any) { throw err.message === 'PASSWORD_REQUIRED' ? new Error('Incorrect eFile password.') : err; }
 }
}

const FILTERS: [string, string, string][] = [['uncompleted', 'Uncompleted', 'fa-thumbs-o-down'], ['completed', 'Completed', 'fa-thumbs-o-up'], ['special', 'Special Marking', 'fa-volume-off'], ['all', 'All', 'fa-hdd-o']];
const EXTRA: [string, string, string][] = [['process', 'eFile Process', 'fa-leaf'], ['processDone', 'eFile Completed Process', 'fa-flag'], ['unlocked', 'Not Lock Auto Link', 'fa-minus']];
export const Circ = ({n, done}: {n: number, done?: boolean}) => <span className={'circ' + (done ? ' done' : '')}>{n}</span>;

export function ItemList({efileId, filter: initial}: {efileId: string, filter?: string}) {
 const [filter, setFilter] = useState(initial ?? 'uncompleted');
 useEffect(() => { if (initial) setFilter(initial); }, [initial]);
 const {data, error, reload} = useLoad(() => withPassword(efileId, password => api('item.list', {efileId, filter, password})), [efileId, filter]);
 const [sel, setSel] = useState<string[]>([]);
 useEffect(() => setSel([]), [efileId, filter]);
 if (!data) return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}]}/>
  <Loading error={error}/>
 </>;
 const e = data.efile;
 const stepTitle = (n: number) => data.steps.find((s: any) => s.position === n)?.title ?? `Step ${n}`;
 const filterLabel = [...FILTERS, ...EXTRA].find(f => f[0] === filter)?.[1] ?? (filter.startsWith('step') ? stepTitle(Number(filter[4])) : filter);
 const filterIcon = [...FILTERS, ...EXTRA].find(f => f[0] === filter)?.[2] ?? 'fa-circle-o';
 const call = async (action: string, params: any, message?: string) => { try { await withPassword(efileId, password => api(action, {...params, password})); if (message) toast(message); reload(); } catch (err) { toastError(err); } };
 const bulk = (op: string) => () => sel.length ? call('item.bulk', {op, ids: sel}, 'Done.') : toast('Select at least one item first.');
 const exportCsv = () => {
  const rows = [['Item Date', 'Name', `Amount (${e.currency})`, 'Status'], ...data.items.map((i: any) => [i.item_date, i.name, i.amount, i.status])];
  const csv = '﻿' + rows.map(r => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = `${e.name}.csv`; a.click(); URL.revokeObjectURL(a.href);
 };
 const rowMenu = (i: any): MenuItem[] => [
  {icon: 'fa-list', label: 'View', onClick: () => go(`/ims/efile/${i.efile_id}/item/${i.id}`)},
  {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/ims/efile/${i.efile_id}/item/${i.id}/edit`), disabled: i.mirrored || i.shared_in},
  {icon: 'fa-times', label: 'Delete', onClick: async () => { if (await confirmBox(`Delete "${i.name}"?`)) call('item.delete', {ids: [i.id]}, 'Deleted.'); }, disabled: i.shared_in},
  ...(i.can_confirm ? [{icon: 'fa-check', label: <>Confirm <Circ n={i.can_confirm}/> {stepTitle(i.can_confirm)}</>, onClick: async () => {
   const v = await formBox(`Confirm: ${stepTitle(i.can_confirm)}`, [{name: 'note', label: 'Note (optional)', type: 'textarea'}]); if (v) call('item.confirm', {id: i.id, note: v.note}, 'Confirmed.');
  }}, {icon: 'fa-reply', label: 'Return', onClick: async () => { const v = await formBox('Return item', [{name: 'note', label: 'Reason', type: 'textarea', required: true}]); if (v) call('item.return', {id: i.id, note: v.note}, 'Returned.'); }}] as MenuItem[] : []),
  ...(i.can_commit ? [{icon: 'fa-share', label: 'Commit to next eFile', onClick: async () => { if (await confirmBox(`Commit "${i.name}" to the next eFile in the process?`)) call('process.commit', {id: i.id}, 'Committed.'); }}] as MenuItem[] : []),
  {icon: i.starred ? 'fa-star' : 'fa-star-o', label: i.starred ? 'Remove Star' : 'Star', onClick: () => call('item.star', {id: i.id})},
 ];
 const pinned = data.balances.map((b: any) => <tr key={b.kind} className={'balance ' + b.kind}>
  <td className="check"><input type="checkbox" disabled aria-label="Balance row"/></td><td>{today()}</td>
  <td>{b.name} <i className="fa fa-star-o"/></td><td className="num">{b.amount}</td>
  <td><div className="counters"><span className="counter blue">0</span><span className="counter green">0</span><span className="counter purple"/></div></td>
 </tr>);
 return <>
  <Breadcrumb color={colorClass(e.color)} items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: e.name}]}/>
  <Panel color="blue" title="Item List" sub={<><span className="sub">{filterLabel}</span><span className="sub" style={{marginLeft: 18}}>Sum: {Number(data.sum) === 0 ? 0 : data.sum}</span></>} tools={<>
   <Tool icon="fa-search" title="Search" onClick={() => (document.querySelector('.dt-search input') as HTMLInputElement)?.focus()}/>
   <Tool icon="fa-square-o" title="Select all" onClick={() => setSel(sel.length ? [] : data.items.map((i: any) => i.id))}/>
   <Tool icon="fa-plus" title="Add Item" onClick={() => go(`/ims/efile/${efileId}/item/new`)}/>
   <ToolMenu icon={filterIcon} title="Filter" className="on" items={[
    ...FILTERS.map(([k, l, ic]) => ({icon: ic, label: l, onClick: () => setFilter(k)})),
    ...data.steps.map((s: any) => ({label: <><Circ n={s.position}/> {s.title}</>, onClick: () => setFilter('step' + s.position)})),
    ...EXTRA.map(([k, l, ic]) => ({icon: ic, label: l, onClick: () => setFilter(k)})),
   ]}/>
   <ToolMenu icon="fa-cog" title="Actions" items={[
    {icon: 'fa-hand-o-up', label: 'Move to Top', onClick: bulk('top')}, {icon: 'fa-hand-o-down', label: 'Cancel Move to Top', onClick: bulk('top.cancel')},
    {icon: 'fa-sun-o', label: 'Highlight', onClick: bulk('highlight')}, {icon: 'fa-circle-thin', label: 'Cancel Highlight', onClick: bulk('highlight.cancel')},
    {icon: 'fa-volume-off', label: 'Special Marking', onClick: bulk('special')}, {icon: 'fa-circle-thin', label: 'Cancel Special Marking', onClick: bulk('special.cancel')},
    {icon: 'fa-lock', label: 'Lock Auto Link', onClick: bulk('lock')}, {icon: 'fa-unlock', label: 'Unlock Auto Link', onClick: bulk('unlock')},
    '-',
    {icon: 'fa-times', label: 'Delete', onClick: async () => { if (!sel.length) return toast('Select at least one item first.'); if (await confirmBox(`Delete ${sel.length} item(s)?`)) call('item.delete', {ids: sel}, 'Deleted.'); }},
   ]}/>
   <ToolMenu icon="fa-asterisk" title="More" items={[
    {icon: 'fa-file-excel-o', label: 'Export', onClick: exportCsv}, {icon: 'fa-print', label: 'Print', onClick: () => print()},
    '-',
    {icon: 'fa-list', label: 'eFile Setup', onClick: () => go(`/ims/efile/${efileId}/view`)},
    {icon: 'fa-user', label: 'Set Confirmation', onClick: () => go(`/ims/efile/${efileId}/confirmation`)},
    {icon: 'fa-asterisk', label: 'Set Process', onClick: () => go(`/ims/efile/${efileId}/process`)},
    {icon: 'fa-hdd-o', label: 'Set Grand Balance/Sum', onClick: () => go(`/ims/efile/${efileId}/balance`)},
    {icon: 'fa-cogs', label: 'eFile Process Monitor', onClick: () => go(`/ims/efile/${efileId}/monitor`)},
   ]}/>
  </>}>
   <DataTable rows={data.items} pageSize={100} selectable selected={sel} onSelect={setSel} pinned={pinned.length ? <>{pinned}</> : undefined}
    searchExtra={<button className="lock" title="Search"><i className="fa fa-lock"/></button>}
    rowClass={(i: any) => i.highlight ? 'item-hl' : ''}
    columns={[
     {key: 'item_date', title: 'Item Date', sort: (i: any) => i.item_date, width: 160},
     {key: 'name', title: 'Name', sort: (i: any) => i.name, render: (i: any) => <>
      <a href={href(`/ims/efile/${i.efile_id}/item/${i.id}`)} style={{whiteSpace: 'pre-wrap'}}>{i.name}</a>{' '}
      <span className="markers" style={{marginLeft: 6}}>
       <i className={'fa star ' + (i.starred ? 'fa-star on' : 'fa-star-o')} role="button" title="Star" onClick={() => call('item.star', {id: i.id})}/>
       {i.steps.map((s: any) => <span key={s.position} title={stepTitle(s.position) + (s.confirmed ? ' ✔' : '')}><Circ n={s.position} done={s.confirmed}/></span>)}
       {i.stage && <span className="bx" title={`Process stage ${i.stage}`}>{i.stage}</span>}
       {i.in_process && <i className="fa fa-cogs" title="In a process"/>}
       {i.all_confirmed && <span className="bx c" title="All confirmations complete">C</span>}
       {i.mirrored && <i className="fa fa-link" title="Linked from another eFile"/>}
       {i.shared_in && <i className="fa fa-share-alt" title="Shared from another eFile"/>}
       {i.special_marking && <i className="fa fa-volume-off special" title="Special Marking"/>}
       {i.move_to_top && <i className="fa fa-hand-o-up" title="Moved to top"/>}
      </span></>},
     {key: 'amount', title: <>Amount<br/>({e.currency})</>, className: 'num', sort: (i: any) => Number(i.amount), width: 170},
     {key: 'tools', title: '', width: 170, render: (i: any) => <div className="counters">
      <button className="counter blue" title="Comments" onClick={() => go(`/ims/efile/${i.efile_id}/item/${i.id}`)}>{i.comments}</button>
      <button className="counter green" title="Attachments" onClick={() => go(`/ims/efile/${i.efile_id}/item/${i.id}`)}>{i.attachments}</button>
      <Menu items={rowMenu(i)} align="right" button={toggle => <button className="counter purple" onClick={toggle} aria-label="Actions"/>}/>
     </div>},
    ]}/>
  </Panel>
 </>;
}
