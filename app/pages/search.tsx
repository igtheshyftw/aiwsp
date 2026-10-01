// Search across the eFiles, items and clients I take part in (top-bar search box).
import {useEffect, useState} from 'react';
import {api, go, href} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading} from '../ui';

export function Search({q}: {q: string}) {
 const [text, setText] = useState(q);
 const [data, setData] = useState<any>(null);
 const [error, setError] = useState('');
 useEffect(() => {
  setText(q); setData(null); setError('');
  if (q.trim().length >= 2) api('search', {q}).then(setData).catch(e => setError(e instanceof Error ? e.message : String(e)));
 }, [q]);
 const total = data ? data.efiles.length + data.items.length + data.clients.length : 0;
 return <>
  <Breadcrumb items={[{label: 'Search'}]}/>
  <Panel title="Search" color="blue">
   <form className="filters" style={{margin: '2px 0 4px'}} onSubmit={e => { e.preventDefault(); go(`/search?q=${encodeURIComponent(text.trim())}`); }}>
    <input type="search" value={text} onChange={e => setText(e.target.value)} placeholder="eFile, item name, #ID, comment, file name, client…" style={{width: 'min(520px, 100%)'}} autoFocus aria-label="Search"/>
    <button className="btn blue" type="submit"><i className="fa fa-search"/> Search</button>
    {data && <span className="muted">{total} result{total === 1 ? '' : 's'} in eFiles you take part in. Items of password-protected eFiles are not searched.</span>}
   </form>
   {q.trim().length < 2 ? <p className="muted">Type at least 2 characters.</p> : !data && <Loading error={error}/>}
  </Panel>
  {data && data.clients.length > 0 && <Panel title={`Clients (${data.clients.length})`}>
   <DataTable rows={data.clients} search={false} unit="clients" columns={[
    {key: 'code', title: 'Code', render: (r: any) => <a className="link" href={href(`/ims/client/${r.id}`)}>{r.code}</a>}, {key: 'name_cn', title: 'CN Name'}, {key: 'name_en', title: 'EN Name'}]}/>
  </Panel>}
  {data && data.efiles.length > 0 && <Panel title={`eFiles (${data.efiles.length})`}>
   <DataTable rows={data.efiles} search={false} unit="eFiles" columns={[
    {key: 'name', title: 'eFile', render: (r: any) => <><a className="link" href={href(`/ims/efile/${r.id}`)}>{r.name}</a>{!!r.locked && <i className="fa fa-lock muted" style={{marginLeft: 6}} title="Password protected"/>}{!!r.archived && <span className="ext">archived</span>}</>},
    {key: 'tag', title: 'Tag'}]}/>
  </Panel>}
  {data && data.items.length > 0 && <Panel title={`Items (${data.items.length}${data.items.length === 100 ? '+' : ''})`}>
   <DataTable rows={data.items} search={false} unit="items" columns={[
    {key: 'seq', title: 'ID', width: 80, render: (r: any) => `#${r.seq}`},
    {key: 'name', title: 'Name', render: (r: any) => <><a className="link" href={href(`/ims/efile/${r.efile_id}/item/${r.id}`)}>{r.name}</a>{r.matched !== 'name' && <span className="ext">{r.matched === 'comment' ? 'in a comment' : 'in an attachment name'}</span>}{!!r.archived && <span className="ext">archived</span>}</>},
    {key: 'efile', title: 'eFile', render: (r: any) => <a href={href(`/ims/efile/${r.efile_id}`)}>{r.efile}</a>},
    {key: 'status_label', title: 'Status', width: 190},
    {key: 'target_date', title: 'Target Date', width: 120}]}/>
  </Panel>}
  {data && total === 0 && <Panel title="No results"><p className="muted">Nothing matches “{q}” in the eFiles you take part in.</p></Panel>}
 </>;
}
