// Set Process: the ordered chain of eFiles an item moves through, with an executor per stage.
import {useEffect, useState} from 'react';
import {api, go, href} from '../lib';
import {Breadcrumb, FormPanel, Loading, toast, toastError, chooseBox, pickBox, confirmBox} from '../ui';

type Stage = {efile_id: string, efile_name: string, executor: {id: string, label: string} | null, notify: {id: string, label: string}[], auto_commit: boolean, confirm_balance: boolean, warning?: boolean, waiting?: number};

export function SetProcess({efileId}: {efileId: string}) {
 const [name, setName] = useState('');
 const [efileName, setEfileName] = useState('');
 const [stages, setStages] = useState<Stage[] | null>(null);
 const [original, setOriginal] = useState<any>(null);
 const [sel, setSel] = useState<number[]>([]);
 const [options, setOptions] = useState<{id: string, name: string}[]>([]);
 const load = () => api('process.get', {efileId}).then(r => {
  setOriginal(r); setEfileName(r.efile.name); setName(r.process?.name ?? r.efile.name);
  setStages(r.stages.length ? r.stages : [{efile_id: r.efile.id, efile_name: r.efile.name, executor: null, notify: [], auto_commit: false, confirm_balance: false}]);
 }).catch(toastError);
 useEffect(() => { load(); api('efile.options').then(setOptions).catch(toastError); }, [efileId]); // eslint-disable-line react-hooks/exhaustive-deps
 if (!stages) return <Loading/>;
 const set = (i: number, v: Partial<Stage>) => setStages(stages.map((s, j) => j === i ? {...s, ...v} : s));
 const chooseEfile = async (title = 'Select eFile') => {
  const used = new Set(stages.map(s => s.efile_id));
  const r = await chooseBox({title, single: true, options: options.filter(o => !used.has(o.id)).map(o => ({id: o.id, label: o.name}))});
  if (!r) return null; const o = options.find(x => x.id === r[0])!;
  return {efile_id: o.id, efile_name: o.name, executor: null, notify: [], auto_commit: false, confirm_balance: false} as Stage;
 };
 const insertAfter = async (i: number) => { const s = await chooseEfile(); if (s) setStages([...stages.slice(0, i + 1), s, ...stages.slice(i + 1)]); };
 const append = async () => { const s = await chooseEfile(); if (s) setStages([...stages, s]); };
 const pickExecutor = async (i: number) => { const p = await pickBox({title: 'Executor', single: true, selectedUsers: stages[i].executor ? [stages[i].executor!.id] : []}); if (p?.users[0]) set(i, {executor: p.users[0]}); };
 const pickNotify = async (i: number) => { const p = await pickBox({title: 'Notify Others', selectedUsers: stages[i].notify.map(u => u.id)}); if (p) set(i, {notify: p.users}); };
 const removeSelected = () => { if (sel.includes(0)) return toast('The first eFile cannot be removed.'); setStages(stages.filter((_, i) => !sel.includes(i))); setSel([]); };
 const moveSelected = (dir: -1 | 1) => {
  if (sel.length !== 1) return toast('Select one eFile to move.');
  const i = sel[0], j = i + dir; if (i === 0 || j <= 0 || j >= stages.length) return;
  const next = [...stages]; [next[i], next[j]] = [next[j], next[i]]; setStages(next); setSel([j]);
 };
 const save = async () => {
  try {
   await api('process.save', {efileId, name, stages: stages.map(s => ({efile_id: s.efile_id, executor_id: s.executor?.id, notify: s.notify.map(u => u.id), auto_commit: s.auto_commit, confirm_balance: s.confirm_balance}))});
   toast('Process saved.'); load();
  } catch (e) { toastError(e); }
 };
 const warning = (s: Stage) => original?.stages.find((o: any) => o.efile_id === s.efile_id && o.executor?.id === s.executor?.id)?.warning;
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: efileName, to: `/ims/efile/${efileId}`}]}/>
  <FormPanel title="Set Process" actions={<><button className="btn-sq grey" onClick={() => { setSel([]); load(); }} title="Reset"><i className="fa fa-undo"/></button><button className="btn-sq" onClick={save} title="Save"><i className="fa fa-check"/></button></>}>
   <div className="field"><label>Name</label><input type="text" value={name} onChange={e => setName(e.target.value)}/></div>
   <div className="field" style={{width: 'auto', marginRight: 0}}>
    <label>eFile</label>
    <table className="dt">
     <thead><tr>
      <th className="check"><input type="checkbox" checked={sel.length === stages.length} onChange={() => setSel(sel.length === stages.length ? [] : stages.map((_, i) => i))} aria-label="Select all"/></th>
      <th style={{width: 60}}/><th>Name</th><th style={{width: '22%'}}><span style={{color: '#d9432f'}}>*</span>Executor</th><th style={{width: '22%'}}>Notify Others</th>
      <th style={{width: 72}}>Auto<br/>Commit</th><th style={{width: 100}}>Confirm<br/>Balance/Sum</th><th style={{width: 150}}/>
     </tr></thead>
     <tbody>{stages.map((s, i) => <tr key={s.efile_id}>
      <td className="check"><input type="checkbox" checked={sel.includes(i)} onChange={() => setSel(sel.includes(i) ? sel.filter(x => x !== i) : [...sel, i])} aria-label={'Select ' + s.efile_name}/></td>
      <td>{i + 1}</td>
      <td>{s.efile_name}</td>
      <td style={{cursor: 'pointer'}} onClick={() => pickExecutor(i)}>{s.executor ? s.executor.label + ';' : <span className="muted">Choose…</span>}</td>
      <td style={{cursor: 'pointer'}} onClick={() => pickNotify(i)}>{s.notify.map(u => u.label + ';').join('')}</td>
      <td><input type="checkbox" checked={s.auto_commit} onChange={e => set(i, {auto_commit: e.target.checked})} aria-label="Auto Commit"/></td>
      <td><input type="checkbox" checked={s.confirm_balance} onChange={e => set(i, {confirm_balance: e.target.checked})} aria-label="Confirm Balance/Sum"/></td>
      <td style={{whiteSpace: 'nowrap', fontSize: 13, color: '#000'}}>
       {i > 0 && <><button className="clear" style={{padding: 0, color: '#d9432f', fontSize: 14}} title="Remove" onClick={() => setStages(stages.filter((_, j) => j !== i))}><i className="fa fa-times"/></button> ‖ </>}
       <button className="clear" style={{padding: 0, color: '#000', fontSize: 14}} title="Insert eFile after" onClick={() => insertAfter(i)}><i className="fa fa-plus"/></button> ‖{' '}
       <a title="Open eFile" href={href(`/ims/efile/${s.efile_id}`)}><i className="fa fa-share-square-o"/></a> ‖{' '}
       <a title="Set Confirmation" href={href(`/ims/efile/${s.efile_id}/confirmation`)}><i className="fa fa-files-o"/></a> ‖{' '}
       <a title="eFile Setup" href={href(`/ims/efile/${s.efile_id}/edit`)}><i className="fa fa-link"/></a> ‖<br/>
       <i className="fa fa-circle" style={{color: warning(s) ? '#e53b2f' : '#000', marginTop: 6}} title={warning(s) ? 'The executor cannot open this eFile. Add them as a participant.' : (s.waiting ? `${s.waiting} item(s) at this stage` : 'OK')}/>
      </td>
     </tr>)}</tbody>
    </table>
   </div>
   <div className="field"><label>Select eFile</label>
    <div style={{display: 'flex', gap: 24}}>
     <button className="btn-sq" title="Add eFile at the end" onClick={append}><i className="fa fa-check-square-o"/></button>
     <button className="btn-sq" title="Move selected up" onClick={() => moveSelected(-1)}><i className="fa fa-arrow-up"/></button>
     <button className="btn-sq" title="Move selected down" onClick={() => moveSelected(1)}><i className="fa fa-arrow-down"/></button>
     <button className="btn-sq" title="Remove selected" onClick={removeSelected}><i className="fa fa-trash-o"/></button>
    </div>
    <div className="hint">An item added to the first eFile starts the process. When its confirmations are complete, the stage executor commits it to the next eFile (or it moves automatically when Auto Commit is ticked).</div>
   </div>
   {original?.process && <div className="field"><button className="btn red" onClick={async () => { if (await confirmBox('Remove this process?')) try { await api('process.clear', {efileId}); toast('Process removed.'); go(`/ims/efile/${efileId}`); } catch (e) { toastError(e); } }}><i className="fa fa-magic"/> X Process Set</button></div>}
  </FormPanel>
 </>;
}
