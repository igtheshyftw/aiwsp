// Item List inside an eFile: pinned balance rows, markers, filters, bulk actions and approval actions.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, colorClass, today} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, Tool, ToolMenu, Menu, toast, toastError, confirmBox, formBox, pickBox, type MenuItem} from '../ui';

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

const FILTERS: [string, string, string][] = [['uncompleted', 'Uncompleted', 'fa-thumbs-o-down'], ['completed', 'Completed', 'fa-thumbs-o-up'], ['pending', 'Pending approval', 'fa-hourglass-half'],
 ['mine', 'Created by me', 'fa-user'], ['special', 'Special Marking', 'fa-volume-off'], ['all', 'All', 'fa-hdd-o']];
const EXTRA: [string, string, string][] = [['process', 'eFile Process', 'fa-leaf'], ['processDone', 'eFile Completed Process', 'fa-flag'], ['unlocked', 'Not Lock Auto Link', 'fa-minus'], ['archived', 'Archived', 'fa-archive']];
export const Circ = ({n, done}: {n: number, done?: boolean}) => <span className={'circ' + (done ? ' done' : '')}>{n}</span>;
export const Status = ({i}: {i: any}) => i.step?.paused ? <span className="status paused">Paused: no approver</span> : <span className={'status ' + i.status}>{i.status_label}</span>;

// Approval actions shared by the list menu and the item page.
export function approvalActions(i: any, stepTitle: string, call: (action: string, params: any, msg: string) => void): MenuItem[] {
 const ask = async (title: string, required: boolean) => formBox(title, [{name: 'note', label: required ? 'Reason' : 'Note (optional)', type: 'textarea', required}]);
 return [
  ...(i.can_submit ? [{icon: 'fa-paper-plane', label: i.round ? 'Resubmit for approval' : 'Submit for approval', onClick: async () => { if (await confirmBox(`Submit "${i.name}" for approval? It will be locked until the approval finishes, is returned or you withdraw it.`)) call('item.submit', {id: i.id, version: i.version}, 'Submitted.'); }}] : []),
  ...(i.can_decide ? [
   {icon: 'fa-check', label: <>Approve <Circ n={i.step.position}/> {stepTitle}</>, onClick: async () => { const v = await ask(`Approve: ${stepTitle}`, false); if (v) call('item.decide', {id: i.id, decision: 'approve', note: v.note, version: i.version}, 'Approved.'); }},
   {icon: 'fa-reply', label: 'Return for correction', onClick: async () => { const v = await ask('Return for correction', true); if (v) call('item.decide', {id: i.id, decision: 'return', note: v.note, version: i.version}, 'Returned.'); }},
   {icon: 'fa-ban', label: 'Reject', onClick: async () => { const v = await ask('Reject', true); if (v) call('item.decide', {id: i.id, decision: 'reject', note: v.note, version: i.version}, 'Rejected.'); }},
  ] : []),
  ...(i.can_withdraw ? [{icon: 'fa-undo', label: 'Withdraw', onClick: async () => { const v = await ask('Withdraw submission', true); if (v) call('item.withdraw', {id: i.id, note: v.note}, 'Withdrawn.'); }}] : []),
  ...(i.can_reassign ? [{icon: 'fa-user-plus', label: `Assign approver (step ${i.step.position})`, onClick: async () => { const p = await pickBox({title: `Approver for step ${i.step.position}: ${stepTitle}`, single: true}); if (p?.users[0]) call('item.reassign', {id: i.id, to: p.users[0].id}, 'Approver assigned.'); }}] : []),
 ] as MenuItem[];
}

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
 const stepTitle = (n?: number) => data.steps.find((s: any) => s.position === n)?.title ?? `Step ${n}`;
 const filterLabel = [...FILTERS, ...EXTRA].find(f => f[0] === filter)?.[1] ?? (filter.startsWith('step') ? `Waiting at: ${stepTitle(Number(filter.slice(4)))}` : filter);
 const filterIcon = [...FILTERS, ...EXTRA].find(f => f[0] === filter)?.[2] ?? 'fa-circle-o';
 const call = async (action: string, params: any, message?: string) => { try { await withPassword(efileId, password => api(action, {...params, password})); if (message) toast(message); reload(); } catch (err) { toastError(err); } };
 const bulk = (op: string) => () => sel.length ? call('item.bulk', {op, ids: sel}, 'Done.') : toast('Select at least one item first.');
 const exportCsv = () => {
  const rows = [['ID', 'Item Date', 'Name', 'Amount', 'Currency', 'Status'], ...data.items.map((i: any) => [i.seq, i.item_date, i.name, i.amount, i.currency, i.status_label])];
  const csv = '﻿' + rows.map(r => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\r\n');
  const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type: 'text/csv'})); a.download = `${e.name}.csv`; a.click(); URL.revokeObjectURL(a.href);
 };
 const open = (i: any) => go(`/ims/efile/${i.efile_id}/item/${i.id}`);
 const rowMenu = (i: any): MenuItem[] => [
  {icon: 'fa-list', label: 'View', onClick: () => open(i)},
  {icon: 'fa-edit', label: i.status === 'returned' ? 'Correct' : 'Edit', onClick: () => go(`/ims/efile/${i.efile_id}/item/${i.id}/edit`), disabled: !i.can_edit},
  ...approvalActions(i, stepTitle(i.step?.position), call),
  ...(i.can_commit ? [{icon: 'fa-share', label: 'Commit to next eFile', onClick: async () => { if (await confirmBox(`Commit "${i.name}" to the next eFile in the process?`)) call('process.commit', {id: i.id}, 'Committed.'); }}] as MenuItem[] : []),
  ...(i.can_lock ? [{icon: i.locked ? 'fa-unlock' : 'fa-lock', label: i.locked ? 'Unlock' : 'Lock', onClick: () => call('item.lock', {id: i.id}, i.locked ? 'Unlocked.' : 'Locked.')}] as MenuItem[] : []),
  ...(i.can_delete ? [{icon: 'fa-times', label: 'Delete', onClick: async () => { if (await confirmBox(`Delete "${i.name}"?`)) call('item.delete', {ids: [i.id]}, 'Deleted.'); }}] as MenuItem[] : []),
  ...(i.can_archive || i.archived ? [{icon: 'fa-archive', label: i.archived ? 'Restore from archive' : 'Archive', onClick: () => call('item.archive', {id: i.id}, 'Done.')}] as MenuItem[] : []),
  {icon: i.starred ? 'fa-star' : 'fa-star-o', label: i.starred ? 'Remove Star' : 'Star', onClick: () => call('item.star', {id: i.id})},
 ];
 const cols = data.columns;
 const pinned = data.balances.map((b: any) => <tr key={b.kind} className={'balance ' + b.kind}>
  <td className="check"><input type="checkbox" disabled aria-label="Balance row"/></td>{cols.date && <td>{today()}</td>}
  <td>{b.name} <i className="fa fa-star-o"/></td>{cols.amount && <td className="num">{b.amount}</td>}
  <td><div className="counters"><span className="counter blue">0</span><span className="counter green">0</span><span className="counter purple"/></div></td>
 </tr>);
 return <>
  <Breadcrumb color={colorClass(e.color)} items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: e.name}]}/>
  <Panel color="blue" title="Item List" sub={<><span className="sub">{filterLabel}</span>{cols.amount && <span className="sub" style={{marginLeft: 18}}>Sum: {Number(data.sum) === 0 ? 0 : data.sum} {e.currency}</span>}{!e.approval && <span className="sub" style={{marginLeft: 18}}>No approval required</span>}</>} tools={<>
   <Tool icon="fa-search" title="Search" onClick={() => (document.querySelector('.dt-search input') as HTMLInputElement)?.focus()}/>
   <Tool icon="fa-square-o" title="Select all" onClick={() => setSel(sel.length ? [] : data.items.map((i: any) => i.id))}/>
   {e.can_create && <Tool icon="fa-plus" title="Add Item" onClick={() => go(`/ims/efile/${efileId}/item/new`)}/>}
   <ToolMenu icon={filterIcon} title="Filter" className="on" items={[
    ...FILTERS.map(([k, l, ic]) => ({icon: ic, label: l, onClick: () => setFilter(k)})),
    ...data.steps.map((s: any) => ({label: <><Circ n={s.position}/> {s.title}</>, onClick: () => setFilter('step' + s.position)})),
    ...EXTRA.map(([k, l, ic]) => ({icon: ic, label: l, onClick: () => setFilter(k)})),
   ]}/>
   <ToolMenu icon="fa-cog" title="Actions" items={[
    {icon: 'fa-hand-o-up', label: 'Move to Top', onClick: bulk('top')}, {icon: 'fa-hand-o-down', label: 'Cancel Move to Top', onClick: bulk('top.cancel')},
    {icon: 'fa-sun-o', label: 'Highlight', onClick: bulk('highlight')}, {icon: 'fa-circle-thin', label: 'Cancel Highlight', onClick: bulk('highlight.cancel')},
    {icon: 'fa-volume-off', label: 'Special Marking', onClick: bulk('special')}, {icon: 'fa-circle-thin', label: 'Cancel Special Marking', onClick: bulk('special.cancel')},
    ...(e.role === 'admin' ? [{icon: 'fa-lock', label: 'Lock Auto Link', onClick: bulk('lock')}, {icon: 'fa-unlock', label: 'Unlock Auto Link', onClick: bulk('unlock')}] as MenuItem[] : []),
    '-',
    {icon: 'fa-times', label: 'Delete drafts', onClick: async () => { if (!sel.length) return toast('Select at least one item first.'); if (await confirmBox(`Delete ${sel.length} item(s)? Submitted items cannot be deleted; archive them instead.`)) call('item.delete', {ids: sel}, 'Deleted.'); }},
   ]}/>
   <ToolMenu icon="fa-asterisk" title="More" items={[
    ...(e.can_export ? [{icon: 'fa-file-excel-o', label: 'Export', onClick: exportCsv}] as MenuItem[] : []), {icon: 'fa-print', label: 'Print', onClick: () => print()},
    '-',
    {icon: 'fa-list', label: 'eFile Setup', onClick: () => go(`/ims/efile/${efileId}/view`)},
    ...(e.role === 'admin' ? [
     {icon: 'fa-user', label: 'Set Confirmation', onClick: () => go(`/ims/efile/${efileId}/confirmation`)},
     {icon: 'fa-asterisk', label: 'Set Process', onClick: () => go(`/ims/efile/${efileId}/process`)},
     {icon: 'fa-hdd-o', label: 'Set Grand Balance/Sum', onClick: () => go(`/ims/efile/${efileId}/balance`)},
    ] as MenuItem[] : []),
    {icon: 'fa-cogs', label: 'eFile Process Monitor', onClick: () => go(`/ims/efile/${efileId}/monitor`)},
   ]}/>
  </>}>
   <DataTable rows={data.items} pageSize={100} selectable selected={sel} onSelect={setSel} pinned={pinned.length ? <>{pinned}</> : undefined}
    searchExtra={<button className="lock" title="Search"><i className="fa fa-lock"/></button>}
    rowClass={(i: any) => i.highlight ? 'item-hl' : i.archived ? 'muted' : ''}
    columns={[
     ...(cols.date ? [{key: 'item_date', title: 'Item Date', sort: (i: any) => i.item_date, width: 150}] : []),
     {key: 'name', title: 'Name', sort: (i: any) => i.name, render: (i: any) => <>
      <a href={href(`/ims/efile/${i.efile_id}/item/${i.id}`)} style={{whiteSpace: 'pre-wrap'}}>{i.name}</a>{' '}
      <span className="markers" style={{marginLeft: 6}}>
       <i className={'fa star ' + (i.starred ? 'fa-star on' : 'fa-star-o')} role="button" title="Star" onClick={() => call('item.star', {id: i.id})}/>
       {i.step && <span className="stepno" role="button" title={`Step ${i.step.position} of ${i.step.total}: ${i.step.title} — view the full process`} onClick={() => open(i)}><Circ n={i.step.position}/></span>}
       {i.status === 'approved' && <span className="bx c" title="Approval complete">C</span>}
       {i.attachments > 0 && <i className="fa fa-paperclip" title={`${i.attachments} attachment(s)`}/>}
       {i.stage && <span className="bx" title={`Process stage ${i.stage}`}>{i.stage}</span>}
       {i.in_process && <i className="fa fa-cogs" title="In a process"/>}
       {i.locked && !i.mirrored && <i className="fa fa-lock" title="Locked by an administrator"/>}
       {i.mirrored && <i className="fa fa-link" title="Linked from another eFile"/>}
       {i.shared_in && <i className="fa fa-share-alt" title="Shared from another eFile"/>}
       {i.special_marking && <i className="fa fa-volume-off special" title="Special Marking"/>}
       {i.move_to_top && <i className="fa fa-hand-o-up" title="Moved to top"/>}
      </span>{e.approval && !i.mirrored && <Status i={i}/>}</>},
     ...(cols.amount ? [{key: 'amount', title: <>Amount<br/>({e.currency})</>, className: 'num', sort: (i: any) => Number(i.amount || 0), width: 170,
      render: (i: any) => i.amount === '' ? '' : <>{i.amount}{i.currency && i.currency !== e.currency ? <small className="muted"> {i.currency}</small> : null}</>}] : []),
     {key: 'tools', title: '', width: 170, render: (i: any) => <div className="counters">
      <button className="counter blue" title="Comments" onClick={() => open(i)}>{i.comments}</button>
      <button className="counter green" title="Attachments" onClick={() => open(i)}>{i.attachments}</button>
      <Menu items={rowMenu(i)} align="right" button={toggle => <button className="counter purple" onClick={toggle} aria-label="Actions"/>}/>
     </div>},
    ]}/>
  </Panel>
 </>;
}
