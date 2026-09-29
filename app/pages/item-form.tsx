// Edit Item form and the item detail view (confirmations, links, attachments, comments).
import {useEffect, useRef, useState} from 'react';
import {api, go, href, uploadFile, fmtTime, today} from '../lib';
import {Breadcrumb, FormPanel, Loading, toast, toastError, chooseBox, confirmBox, formBox} from '../ui';
import {withPassword, Circ} from './items';

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
    steps: r.steps.filter((s: any) => s.required).map((s: any) => s.position)});
   setEfile(r.efile); setSteps(r.steps);
   setLinks(r.links.map((l: any) => ({id: l.id, kind: l.kind, efile_id: l.target_efile_id, efile_name: l.efile_name, change_sign: l.change_sign, split_amount: l.split_amount, step_efile_id: l.step_efile_id, step_efile_name: l.step_efile_name, item_id: l.target_item_id, item_name: l.item_name, locked: l.locked})));
  }).catch(toastError);
  else api('efile.get', {id: efileId}).then(r => {
   setEfile(r); setSteps(r.steps);
   setF({name: '', amount: '', item_date: today(), target_date: '', highlight: false, move_to_top: false, special_marking: false, steps: r.steps.map((s: any) => s.position)});
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
 const save = async () => {
  try {
   const r = await withPassword(efileId, password => api('item.save', {id, efileId, ...f, password, links: links.map(l => ({...l, efile_id: l.efile_id}))}));
   toast('Saved.'); go(`/ims/efile/${efileId}/item/${r.id}`);
  } catch (e) { toastError(e); }
 };
 const allSteps = steps.length > 0 && steps.every(s => f.steps.includes(s.position));
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: efile.name, to: `/ims/efile/${efileId}`}]}/>
  <FormPanel title={id ? 'Edit Item' : 'Add Item'} onSave={save} actions={<><button className="btn-sq grey" onClick={() => history.back()} title="Back"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <div className="field"><textarea aria-label="Name" placeholder="Name" style={{minHeight: 115}} value={f.name} onChange={e => setF({...f, name: e.target.value})} autoFocus={!id}/></div>
   <div className="field"><label>Amount</label><div className="inline"><input type="text" inputMode="decimal" value={f.amount} onChange={e => setF({...f, amount: e.target.value})}/><span>{money(f.amount)}</span></div></div>
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
   <div className="field"><label>Confirmation</label>
    {steps.length === 0 ? <p className="muted" style={{margin: 0}}>This eFile has no confirmation steps. Use Set Confirmation on the eFile to add them.</p> : <div className="checks">
     <label><input type="checkbox" checked={allSteps} onChange={() => setF({...f, steps: allSteps ? [] : steps.map(s => s.position)})}/>Select All</label>
     {steps.map(s => <label key={s.position}><input type="checkbox" checked={f.steps.includes(s.position)} onChange={() => setF({...f, steps: f.steps.includes(s.position) ? f.steps.filter((x: number) => x !== s.position) : [...f.steps, s.position]})}/> {s.title}</label>)}
    </div>}
   </div>
   <div className="divider"/>
   <div className="field"><label>Item Date</label><div className="date"><input type="date" value={f.item_date} onChange={e => setF({...f, item_date: e.target.value})}/><button className="clear" onClick={() => setF({...f, item_date: ''})} aria-label="Clear Item Date"><i className="fa fa-times-circle-o"/></button></div></div>
   <div className="field"><label>Target Date</label><div className="date"><input type="date" value={f.target_date} onChange={e => setF({...f, target_date: e.target.value})}/><button className="clear" onClick={() => setF({...f, target_date: ''})} aria-label="Clear Target Date"><i className="fa fa-times-circle-o"/></button></div></div>
  </FormPanel>
 </>;
}

const KIND_LABEL: Record<string, string> = {auto_link: 'Auto Link', conditional_auto_link: 'Conditional Auto Link', split_link: 'Split Link', auto_copy: 'Auto Copy', auto_share: 'Auto Share', bind: 'Bind'};

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
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: d.efile.name, to: `/ims/efile/${efileId}`}, {label: 'Item'}]}/>
  <FormPanel title="Item">
   <div className="field">
    <div className="detail-grid">
     <b>Name</b><span style={{whiteSpace: 'pre-wrap'}}>{i.name}</span>
     <b>Amount ({d.efile.currency})</b><span>{i.amount}</span>
     <b>Item Date</b><span>{i.item_date}</span>
     <b>Target Date</b><span>{i.target_date || '—'}</span>
     <b>Status</b><span>{i.status === 'completed' ? 'Completed' : 'Uncompleted'}{i.stage ? ` · process stage ${i.stage}` : ''}</span>
     <b>Flags</b><span>{[i.highlight && 'Highlight', i.move_to_top && 'Move to Top', i.special_marking && 'Special Marking'].filter(Boolean).join(', ') || '—'}</span>
     <b>Created</b><span>{i.created_by}, {fmtTime(i.created_at)}</span>
    </div>
    <div style={{marginTop: 16, display: 'flex', gap: 8, flexWrap: 'wrap'}}>
     {!i.mirrored && !i.shared_in && <a className="btn blue" href={href(`/ims/efile/${efileId}/item/${id}/edit`)}><i className="fa fa-edit"/> Edit</a>}
     {i.can_confirm > 0 && <button className="btn green" onClick={async () => { const v = await formBox('Confirm', [{name: 'note', label: 'Note (optional)', type: 'textarea'}]); if (v) call('item.confirm', {id, note: v.note}, 'Confirmed.'); }}><i className="fa fa-check"/> Confirm</button>}
     {i.can_confirm > 0 && <button className="btn grey" onClick={async () => { const v = await formBox('Return item', [{name: 'note', label: 'Reason', type: 'textarea', required: true}]); if (v) call('item.return', {id, note: v.note}, 'Returned.'); }}><i className="fa fa-reply"/> Return</button>}
     {i.can_commit && <button className="btn blue" onClick={async () => { if (await confirmBox('Commit this item to the next eFile in the process?')) call('process.commit', {id}, 'Committed.'); }}><i className="fa fa-share"/> Commit to next eFile</button>}
     <a className="btn plain" href={href(`/ims/efile/${efileId}`)}>Item List</a>
    </div>
   </div>
   <div className="divider"/>
   <div className="field"><label>Confirmation</label>
    {d.steps.length === 0 ? <p className="muted">No confirmation steps.</p> : <table className="dt"><thead><tr><th style={{width: 60}}/><th>Step</th><th>Confirmer</th><th>Status</th></tr></thead><tbody>
     {d.steps.map((s: any) => <tr key={s.position}><td><Circ n={s.position} done={!!s.confirmed}/></td><td>{s.title}</td><td>{s.users.map((u: any) => u.label).join('; ')}</td>
      <td>{!s.required ? <span className="muted">Not required</span> : s.confirmed ? `Confirmed by ${s.confirmed_by}, ${fmtTime(s.confirmed)}` : 'Pending'}</td></tr>)}
    </tbody></table>}
   </div>
   {d.links.length > 0 && <><div className="divider"/><div className="field"><label>Links</label><table className="dt"><thead><tr><th>Type</th><th>eFile</th><th>Detail</th></tr></thead><tbody>
    {d.links.map((l: any) => <tr key={l.id}><td>{KIND_LABEL[l.kind]}</td><td><a className="link" href={href(`/ims/efile/${l.target_efile_id}`)}>{l.efile_name}</a></td>
     <td>{[l.change_sign && 'Change Sign', l.kind === 'split_link' && `Amount ${l.split_amount}`, l.step_efile_name && `When at: ${l.step_efile_name}`, l.item_name && `Item: ${l.item_name}`, l.locked && 'Locked', MIRROR.includes(l.kind) && !l.target_item_id && 'Waiting'].filter(Boolean).join(' · ')}</td></tr>)}
   </tbody></table></div></>}
   <div className="divider"/>
   <div className="field"><label>Attachments</label>
    {d.attachments.length === 0 ? <p className="muted" style={{margin: '0 0 10px'}}>No attachments.</p> : <table className="dt" style={{marginBottom: 10}}><tbody>
     {d.attachments.map((a: any) => <tr key={a.id}><td><a className="link" href={`/api/file?id=${a.id}`}>{a.filename}</a></td><td className="num">{Math.ceil(a.size / 1024)} KB</td><td>{fmtTime(a.at)}</td>
      <td style={{width: 40}}><button className="clear" style={{padding: 0}} aria-label="Delete attachment" onClick={async () => { if (await confirmBox(`Delete ${a.filename}?`)) call('attachment.delete', {id: a.id}, 'Deleted.'); }}><i className="fa fa-times-circle-o"/></button></td></tr>)}
    </tbody></table>}
    <input ref={fileRef} type="file" multiple onChange={e => upload(e.target.files)} aria-label="Upload attachment"/>
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
const MIRROR = ['auto_link', 'conditional_auto_link', 'split_link'];
