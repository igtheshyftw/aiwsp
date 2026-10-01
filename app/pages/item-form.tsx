// Edit Item form and the item page (approval process, versions, history, links, attachments, comments).
import {useEffect, useRef, useState} from 'react';
import {api, go, href, uploadFile, fmtTime, today} from '../lib';
import {Breadcrumb, FormPanel, Loading, toast, toastError, chooseBox, confirmBox, formBox} from '../ui';
import {withPassword, Circ, Status, approvalActions} from './items';

type Link = {id?: string, kind: string, efile_id: string, efile_name: string, change_sign?: boolean, split_amount?: string, step_efile_id?: string, step_efile_name?: string, item_id?: string, item_name?: string, locked?: boolean};
const SECTIONS: {kind: string, title: string, cols: 'sign' | 'cond' | 'split' | 'name' | 'bind'}[] = [
 {kind: 'auto_link', title: 'Auto Link eFiles', cols: 'sign'},
 {kind: 'conditional_auto_link', title: 'Conditional Auto Link', cols: 'cond'},
 {kind: 'split_link', title: 'Split Link', cols: 'split'},
 {kind: 'auto_copy', title: 'Auto Copy eFiles', cols: 'sign'},
 {kind: 'auto_share', title: 'Auto Share eFiles', cols: 'name'},
 {kind: 'bind', title: 'Bind eFile', cols: 'bind'},
];
const money = (v: string) => { const n = Number(String(v).replace(/,/g, '')); return isFinite(n) && v !== '' ? n.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}) : ''; };

export function ItemForm({efileId, id}: {efileId: string, id?: string}) {
 const [f, setF] = useState<any>(null);
 const [efile, setEfile] = useState<any>(null);
 const [steps, setSteps] = useState<any[]>([]);
 const [links, setLinks] = useState<Link[]>([]);
 const [options, setOptions] = useState<{id: string, name: string}[]>([]);
 useEffect(() => {
  api('efile.options').then(setOptions).catch(toastError);
  if (id) withPassword(efileId, password => api('item.get', {id, password})).then(r => {
   setF({name: r.item.name, amount: r.item.amount, item_date: r.item.item_date, target_date: r.item.target_date, highlight: r.item.highlight, move_to_top: r.item.move_to_top, special_marking: r.item.special_marking,
    version: r.item.version, status: r.item.status, can_submit: r.item.can_submit});
   setEfile(r.efile); setSteps(r.steps);
   setLinks(r.links.map((l: any) => ({id: l.id, kind: l.kind, efile_id: l.target_efile_id, efile_name: l.efile_name, change_sign: l.change_sign, split_amount: l.split_amount, step_efile_id: l.step_efile_id, step_efile_name: l.step_efile_name, item_id: l.target_item_id, item_name: l.item_name, locked: l.locked})));
  }).catch(toastError);
  else api('efile.get', {id: efileId}).then(r => {
   setEfile(r); setSteps(r.steps);
   setF({name: '', amount: '', item_date: r.show_date ? today() : '', target_date: '', highlight: false, move_to_top: false, special_marking: false, can_submit: !!r.approval, responsible_id: ''});
  }).catch(toastError);
 }, [efileId, id]);
 if (!f || !efile) return <Loading/>;
 const others = options.filter(o => o.id !== efileId);
 const add = async (kind: string) => {
  const picked = await chooseBox({title: 'Select eFile', single: true, options: others.map(o => ({id: o.id, label: o.name}))}); if (!picked) return;
  const target = others.find(o => o.id === picked[0])!;
  const l: Link = {kind, efile_id: target.id, efile_name: target.name, change_sign: false, split_amount: ''};
  if (kind === 'conditional_auto_link') {
   const step = await chooseBox({title: 'Process Step eFile (link is created when the item reaches this eFile)', single: true, options: options.map(o => ({id: o.id, label: o.name}))}); if (!step) return;
   l.step_efile_id = step[0]; l.step_efile_name = options.find(o => o.id === step[0])?.name;
  }
  if (kind === 'bind') {
   try {
    const list = await withPassword(target.id, password => api('item.list', {efileId: target.id, filter: 'all', password}));
    const it = await chooseBox({title: `Item in ${target.name}`, single: true, options: list.items.map((i: any) => ({id: i.id, label: `${i.item_date}  ${i.name}  ${i.amount}`}))}); if (!it) return;
    l.item_id = it[0]; l.item_name = list.items.find((i: any) => i.id === it[0])?.name;
   } catch (e) { return toastError(e); }
  }
  setLinks([...links, l]);
 };
 const setLink = (i: number, v: Partial<Link>) => setLinks(links.map((l, j) => j === i ? {...l, ...v} : l));
 const save = async (submit = false) => {
  try {
   if (submit && !await confirmBox('Save and submit for approval? The item is locked until the approval finishes, is returned or you withdraw it.')) return;
   const r = await withPassword(efileId, password => api('item.save', {id, efileId, ...f, submit, password, links: links.map(l => ({...l, efile_id: l.efile_id}))}));
   toast(submit ? 'Submitted for approval.' : 'Saved.'); go(`/ims/efile/${efileId}/item/${r.id}`);
  } catch (e) { toastError(e); }
 };
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: efile.name, to: `/ims/efile/${efileId}`}]}/>
  <FormPanel title={id ? (f.status === 'returned' ? 'Correct Item' : 'Edit Item') : 'Add Item'} onSave={() => save()} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={() => save()} title="Save as draft"><i className="fa fa-check"/></button>
   {efile.approval && f.can_submit !== false && <button className="btn blue" style={{height: 36}} onClick={() => save(true)}><i className="fa fa-paper-plane"/> Save and Submit</button>}</>}>
   {f.status === 'returned' && <div className="field notice-bar">This item was returned for correction. Saving creates a new version; submitting restarts approval from step 1. Earlier versions and decisions are kept.</div>}
   <div className="field"><textarea aria-label="Name" placeholder="Name" style={{minHeight: 115}} value={f.name} onChange={e => setF({...f, name: e.target.value})} autoFocus={!id}/></div>
   {efile.show_amount && <div className="field"><label>Amount ({efile.currency})</label><div className="inline"><input type="text" inputMode="decimal" value={f.amount} onChange={e => setF({...f, amount: e.target.value})} placeholder="Leave blank if there is no amount"/><span>{money(f.amount)}</span></div>
    <div className="hint">A blank amount stays blank; 0 is recorded as zero.</div></div>}
   <div className="divider"/>
   <div className="field checks">
    <label><input type="checkbox" checked={f.highlight} onChange={e => setF({...f, highlight: e.target.checked})}/>Highlight</label>
    <label><input type="checkbox" checked={f.move_to_top} onChange={e => setF({...f, move_to_top: e.target.checked})}/>Move to Top</label>
    <label><input type="checkbox" checked={f.special_marking} onChange={e => setF({...f, special_marking: e.target.checked})}/>Special Marking</label>
   </div>
   {SECTIONS.map(sec => <div key={sec.kind}>
    <div className="divider"/>
    <div className="field">
     <label>{sec.title}</label>
     <table className="dt"><thead><tr>
      <th>{sec.cols === 'cond' || sec.cols === 'bind' ? 'eFile Name' : 'Name'}</th>
      {sec.cols === 'cond' && <th>Process Step eFile</th>}
      {sec.cols === 'bind' && <th>Item Name</th>}
      {(sec.cols === 'sign' || sec.cols === 'cond') && <th style={{width: 150}}>Change Sign</th>}
      {sec.cols === 'split' && <th style={{width: 150}}>Amount</th>}
      <th style={{width: 150}}/>
     </tr></thead><tbody>
      {links.map((l, i) => l.kind !== sec.kind ? null : <tr key={i}>
       <td>{l.efile_name}</td>
       {sec.cols === 'cond' && <td>{l.step_efile_name}</td>}
       {sec.cols === 'bind' && <td>{l.item_name}</td>}
       {(sec.cols === 'sign' || sec.cols === 'cond') && <td><input type="checkbox" checked={!!l.change_sign} onChange={e => setLink(i, {change_sign: e.target.checked})} aria-label="Change Sign"/></td>}
       {sec.cols === 'split' && <td><input type="text" style={{width: 120}} value={l.split_amount ?? ''} onChange={e => setLink(i, {split_amount: e.target.value})} aria-label="Split amount"/></td>}
       <td><button className="clear" style={{padding: 0}} onClick={() => setLinks(links.filter((_, j) => j !== i))} aria-label="Remove"><i className="fa fa-times-circle-o"/></button>
        {l.locked && <i className="fa fa-lock muted" title="Locked" style={{marginLeft: 8}}/>}</td>
      </tr>)}
     </tbody></table>
     <label>Select eFile</label>
     <button className="btn-sq" onClick={() => add(sec.kind)} title={'Select eFile for ' + sec.title}><i className="fa fa-check-square-o"/></button>
    </div>
   </div>)}
   <div className="divider"/>
   <div className="field"><label>Confirmation (approval steps)</label>
    {!efile.approval ? <p className="muted" style={{margin: 0}}>No approval required in this eFile.</p> : steps.length === 0 ? <p className="muted" style={{margin: 0}}>This eFile has no approval steps yet. Ask its administrator to Set Confirmation.</p> : <>
     <ol style={{margin: 0, paddingLeft: 20}}>{steps.map(s => <li key={s.position}>{s.title} <span className="muted">— {s.users.map((u: any) => u.label).join(', ')}</span></li>)}</ol>
     <div className="hint">Every submission goes through all steps in this order.</div></>}
   </div>
   <div className="divider"/>
   {efile.show_date && <div className="field"><label>Item Date</label><div className="date"><input type="date" value={f.item_date} onChange={e => setF({...f, item_date: e.target.value})}/><button className="clear" onClick={() => setF({...f, item_date: ''})} aria-label="Clear Item Date"><i className="fa fa-times-circle-o"/></button></div></div>}
   <div className="field"><label>Target Date</label><div className="date"><input type="date" value={f.target_date} onChange={e => setF({...f, target_date: e.target.value})}/><button className="clear" onClick={() => setF({...f, target_date: ''})} aria-label="Clear Target Date"><i className="fa fa-times-circle-o"/></button></div></div>
   {!id && efile.assignable?.length > 0 && <div className="field"><label htmlFor="responsible">Responsible</label><select id="responsible" value={f.responsible_id} onChange={e => setF({...f, responsible_id: e.target.value})} style={{maxWidth: 360}}>
    <option value="">—</option>{efile.assignable.map((u: any) => <option key={u.id} value={u.id}>{u.label}</option>)}</select>
    <div className="hint">The person carrying this item. They see it under To Do → My Work and get its deadline reminders.</div></div>}
  </FormPanel>
 </>;
}

const KIND_LABEL: Record<string, string> = {auto_link: 'Auto Link', conditional_auto_link: 'Conditional Auto Link', split_link: 'Split Link', auto_copy: 'Auto Copy', auto_share: 'Auto Share', bind: 'Bind'};
const MIRROR = ['auto_link', 'conditional_auto_link', 'split_link'];
const DECISION: Record<string, string> = {approve: 'Approved', return: 'Returned for correction', reject: 'Rejected', withdrawn: 'Withdrawn', closed: '—', override: 'Approved by System Admin override', 'override-closed': 'Closed by System Admin override'};
const PREVIEW = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];

export function ItemView({efileId, id}: {efileId: string, id: string}) {
 const [d, setD] = useState<any>(null);
 const [comment, setComment] = useState('');
 const fileRef = useRef<HTMLInputElement>(null);
 const load = () => withPassword(efileId, password => api('item.get', {id, password})).then(setD).catch(toastError);
 useEffect(() => { load(); }, [efileId, id]); // eslint-disable-line react-hooks/exhaustive-deps
 if (!d) return <Loading/>;
 const i = d.item;
 const call = async (action: string, params: any, msg: string) => { try { await withPassword(efileId, password => api(action, {...params, password})); toast(msg); load(); } catch (e) { toastError(e); } };
 const upload = async (files: FileList | null) => { if (!files) return; try { for (const file of Array.from(files)) await uploadFile(id, file); toast('Uploaded.'); load(); } catch (e) { toastError(e); } if (fileRef.current) fileRef.current.value = ''; };
 const override = async (mode: string) => { const v = await formBox(mode === 'approve' ? 'System Admin override: approve' : 'System Admin override: reopen', [{name: 'note', label: 'Reason (recorded and sent to all participants)', type: 'textarea', required: true}]); if (v) call('item.override', {id, mode, note: v.note}, 'Override recorded.'); };
 const actions = approvalActions(i, i.step?.title ?? '', call).filter((a): a is Exclude<typeof a, '-'> => a !== '-');
 const locked = ['pending', 'approved', 'rejected'].includes(i.status) || i.locked;
 const rounds: Record<number, any[]> = {};
 for (const s of d.rounds) (rounds[s.round] ??= []).push(s);
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: d.efile.name, to: `/ims/efile/${efileId}`}, {label: `Item #${i.seq}`}]}/>
  <FormPanel title={<>Item #{i.seq}</>}>
   <div className="field">
    <div className="detail-grid">
     <b>ID</b><span>#{i.seq}</span>
     <b>Name</b><span style={{whiteSpace: 'pre-wrap'}}>{i.name}</span>
     {(d.efile.show_amount || i.amount !== '') && <><b>Amount</b><span>{i.amount === '' ? <span className="muted">(blank)</span> : `${i.amount} ${i.currency}`}</span></>}
     {(d.efile.show_date || i.item_date) && <><b>Item Date</b><span>{i.item_date || '—'}</span></>}
     <b>Target Date</b><span>{i.target_date || '—'}</span>
     <b>Responsible</b><span>{i.can_assign && d.assignable.length ? <select aria-label="Responsible" value={i.responsible_id} onChange={e => call('item.assign', {id, userId: e.target.value}, 'Responsible person updated.')} style={{height: 30, minWidth: 220, width: 'auto', maxWidth: 360}}>
      <option value="">—</option>{d.assignable.map((u: any) => <option key={u.id} value={u.id}>{u.label}</option>)}</select> : i.responsible || '—'}</span>
     {i.completed && <><b>Completed</b><span>{i.completed.by}, {fmtTime(i.completed.at)}</span></>}
     {d.conversations?.length > 0 && <><b>From conversation</b><span>{d.conversations.map((cv: any) => <a key={cv.id} className="link" style={{marginRight: 12}} href={href(cv.staff ? `/assistant/inbox/${cv.id}` : `/assistant/${cv.id}`)}><i className="fa fa-comments-o"/> {cv.title}</a>)}</span></>}
     <b>Status</b><span>{d.efile.approval || i.status !== 'none' ? <Status i={i}/> : 'No approval required'}{i.step && ` · step ${i.step.position} of ${i.step.total}: ${i.step.title}`}{i.stage ? ` · process stage ${i.stage}` : ''}{i.locked ? ' · locked' : ''}{i.archived ? ' · archived' : ''}</span>
     <b>Flags</b><span>{[i.highlight && 'Highlight', i.move_to_top && 'Move to Top', i.special_marking && 'Special Marking'].filter(Boolean).join(', ') || '—'}</span>
     <b>Created</b><span>{i.created_by}, {fmtTime(i.created_at)}</span>
     {i.submitted_by && <><b>Submitted by</b><span>{i.submitted_by}</span></>}
    </div>
    <div style={{marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap'}}>
     {i.can_edit && <a className="btn blue" href={href(`/ims/efile/${efileId}/item/${id}/edit`)}><i className="fa fa-edit"/> {i.status === 'returned' ? 'Correct' : 'Edit'}</a>}
     {actions.map((a, n) => <button key={n} className={'btn ' + (n === 0 ? 'green' : 'grey')} onClick={a.onClick}>{a.icon && <i className={'fa ' + a.icon}/>} {a.label}</button>)}
     {i.can_commit && <button className="btn blue" onClick={async () => { if (await confirmBox('Commit this item to the next eFile in the process?')) call('process.commit', {id}, 'Committed.'); }}><i className="fa fa-share"/> Commit to next eFile</button>}
     {i.can_complete && <button className="btn green" onClick={() => call('item.complete', {id}, 'Completed.')}><i className="fa fa-check-square-o"/> Mark complete</button>}
     {i.can_reopen && <button className="btn grey" onClick={() => call('item.complete', {id, reopen: true}, 'Reopened.')}><i className="fa fa-undo"/> Reopen</button>}
     {i.can_lock && <button className="btn grey" onClick={() => call('item.lock', {id}, i.locked ? 'Unlocked.' : 'Locked.')}><i className={'fa ' + (i.locked ? 'fa-unlock' : 'fa-lock')}/> {i.locked ? 'Unlock' : 'Lock'}</button>}
     {(i.can_archive || i.archived) && <button className="btn grey" onClick={() => call('item.archive', {id}, 'Done.')}><i className="fa fa-archive"/> {i.archived ? 'Restore' : 'Archive'}</button>}
     {d.can_override && i.status === 'pending' && <button className="btn red" onClick={() => override('approve')}><i className="fa fa-gavel"/> Override: approve</button>}
     {d.can_override && <button className="btn red" onClick={() => override('reopen')}><i className="fa fa-gavel"/> Override: reopen</button>}
     <a className="btn plain" href={href(`/ims/efile/${efileId}`)}>Item List</a>
    </div>
   </div>
   <div className="divider"/>
   <div className="field" id="process"><label>Approval process</label>
    {!d.efile.approval && !d.rounds.length ? <p className="muted">No approval required.</p> : !d.rounds.length ? <p className="muted">Not submitted yet.</p> :
     Object.keys(rounds).sort((a, b) => Number(b) - Number(a)).map(r => <div key={r} style={{marginBottom: 12}}>
      <div className="muted" style={{marginBottom: 4}}>Version {r}{Number(r) === i.round ? ' (current)' : ''}</div>
      <table className="dt"><thead><tr><th style={{width: 50}}/><th>Step</th><th>Approvers</th><th>Decision</th><th>Reason / note</th></tr></thead><tbody>
       {rounds[Number(r)].map((s: any) => <tr key={s.position} className={s.decision?.startsWith('override') ? 'item-hl' : ''}>
        <td><Circ n={s.position} done={s.decision === 'approve' || s.decision === 'override'}/></td><td>{s.title}</td>
        <td>{s.approvers.map((a: any) => <span key={a.id} className={a.eligible ? '' : 'muted'} title={a.eligible ? '' : 'Not eligible now'} style={{marginRight: 8}}>{a.label}</span>)}</td>
        <td>{s.decision ? <>{DECISION[s.decision] ?? s.decision}{s.decided_by && <> · {s.decided_by}, {fmtTime(s.decided_at)}</>}</> : Number(r) === i.round && i.step?.position === s.position ? (i.step.paused ? <span className="status paused">Paused: no eligible approver</span> : 'Waiting') : 'Not reached'}</td>
        <td>{s.note}</td>
       </tr>)}
      </tbody></table>
     </div>)}
   </div>
   {d.links.length > 0 && <><div className="divider"/><div className="field"><label>Links</label><table className="dt"><thead><tr><th>Type</th><th>eFile</th><th>Detail</th></tr></thead><tbody>
    {d.links.map((l: any) => <tr key={l.id}><td>{KIND_LABEL[l.kind]}</td><td><a className="link" href={href(`/ims/efile/${l.target_efile_id}`)}>{l.efile_name}</a></td>
     <td>{[l.change_sign && 'Change Sign', l.kind === 'split_link' && `Amount ${l.split_amount}`, l.step_efile_name && `When at: ${l.step_efile_name}`, l.item_name && `Item: ${l.item_name}`, l.locked && 'Locked', MIRROR.includes(l.kind) && !l.target_item_id && 'Waiting'].filter(Boolean).join(' · ')}</td></tr>)}
   </tbody></table></div></>}
   <div className="divider"/>
   <div className="field"><label>Attachments</label>
    {d.attachments.length === 0 ? <p className="muted" style={{margin: '0 0 10px'}}>No attachments.</p> : <table className="dt" style={{marginBottom: 10}}><tbody>
     {d.attachments.map((a: any) => <tr key={a.id}><td><i className="fa fa-paperclip"/> {PREVIEW.includes(a.content_type) ? <a className="link" href={`/api/file?id=${a.id}&inline=1`} target="_blank" rel="noopener noreferrer">{a.filename}</a> : a.filename}</td>
      <td className="num">{Math.ceil(a.size / 1024)} KB</td><td>{fmtTime(a.at)}</td>
      <td style={{width: 90}}><a className="link" href={`/api/file?id=${a.id}`}>Download</a></td>
      <td style={{width: 40}}>{!locked && <button className="clear" style={{padding: 0}} aria-label="Delete attachment" onClick={async () => { if (await confirmBox(`Delete ${a.filename}?`)) call('attachment.delete', {id: a.id}, 'Deleted.'); }}><i className="fa fa-times-circle-o"/></button>}</td></tr>)}
    </tbody></table>}
    {locked ? <p className="muted" style={{margin: 0}}>Attachments are locked while the item is submitted or approved.</p> : i.can_edit && <>
     <input ref={fileRef} type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.txt,.csv,.docx,.xlsx,.pptx,.doc,.xls" onChange={e => upload(e.target.files)} aria-label="Upload attachment"/>
     <div className="hint">PDF, images, Office documents without macros, text or CSV; up to 10 MB. Files are checked before they are stored.</div></>}
   </div>
   {d.versions.length > 0 && <><div className="divider"/><div className="field"><label>Submitted versions</label><table className="dt"><thead><tr><th>Version</th><th>Name</th><th>Amount</th><th>Date</th><th>Attachments</th><th>Submitted</th></tr></thead><tbody>
    {d.versions.map((v: any) => <tr key={v.version}><td>{v.version}</td><td>{v.snapshot.name}</td><td>{v.snapshot.amount === null ? '' : (v.snapshot.amount / 100).toFixed(2) + ' ' + v.snapshot.currency}</td><td>{v.snapshot.item_date}</td>
     <td>{v.snapshot.attachments.map((a: any) => a.filename).join(', ')}</td><td>{v.by}, {fmtTime(v.at)}</td></tr>)}
   </tbody></table></div></>}
   <div className="divider"/>
   <div className="field"><label>History</label>
    {d.events.map((ev: any, n: number) => <div key={n} className={ev.override ? 'override' : ''} style={{padding: '3px 0'}}><small className="muted">{fmtTime(ev.at)}</small> <b>{ev.actor}</b> — {ev.action}{ev.note && <>: <i>{ev.note}</i></>}</div>)}
   </div>
   <div className="divider"/>
   <div className="field comments" id="comments"><label>Comments</label>
    {d.comments.length === 0 && <p className="muted" style={{margin: '0 0 10px'}}>No comments.</p>}
    {d.comments.map((c: any) => <div className="c" key={c.id}><b>{c.username}</b><small>{fmtTime(c.at)}</small><div style={{whiteSpace: 'pre-wrap'}}>{c.body}</div></div>)}
    <textarea style={{marginTop: 10}} value={comment} onChange={e => setComment(e.target.value)} placeholder="Add a comment"/>
    <button className="btn blue" style={{marginTop: 8}} disabled={!comment.trim()} onClick={async () => { await call('item.comment', {id, body: comment}, 'Comment added.'); setComment(''); }}>Add Comment</button>
   </div>
  </FormPanel>
 </>;
}
