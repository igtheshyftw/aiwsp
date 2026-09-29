// IMS → My eFile list (and its other views), plus the System Link page.
import {useEffect, useState} from 'react';
import {api, useLoad, go, href, colorClass, fmtTime} from '../lib';
import {Breadcrumb, Panel, DataTable, Loading, Tool, ToolMenu, toast, toastError, confirmBox, formBox, pickBox, chooseBox, type MenuItem} from '../ui';

const TITLES: Record<string, string> = {my: 'My eFile List', explorer: 'eFile Explorer', recent: 'Recently Updated', links: 'eFile Link', hidden: 'Hide List', archive: 'Archive List',
 process: 'My Process', confirmation: 'My Confirmation', color: 'Filter By Color'};
const LOCK_KEY = 'ims.efile.lockedSearch';
const readLock = () => { try { return localStorage.getItem(LOCK_KEY) ?? ''; } catch { return ''; } };
const writeLock = (v: string) => { try { v ? localStorage.setItem(LOCK_KEY, v) : localStorage.removeItem(LOCK_KEY); } catch { /* storage unavailable */ } };

export function EfileList({view, color}: {view: string, color?: string}) {
 const [q, setQ] = useState(readLock());
 const [locked, setLocked] = useState(!!readLock());
 const [pageQ, setPageQ] = useState('');
 const {data, error, reload} = useLoad(() => api<any[]>('efile.list', {view, color, q: pageQ}), [view, color, pageQ]);
 const [sel, setSel] = useState<string[]>([]);
 const [expanded, setExpanded] = useState(false);
 useEffect(() => setSel([]), [view, color]);
 const toggleLock = () => { const on = !locked; setLocked(on); writeLock(on ? q : ''); toast(on ? 'Search locked.' : 'Search unlocked.'); };

 const bulk = async (op: string, extra: Record<string, any> = {}, message?: string) => {
  if (!sel.length) return toast('Select at least one eFile first.');
  try { await api('efile.bulk', {op, ids: sel, ...extra}); toast(message ?? 'Done.'); reload(); } catch (e) { toastError(e); }
 };
 const withUsers = (op: string, title: string) => async () => { if (!sel.length) return toast('Select at least one eFile first.'); const p = await pickBox({title}); if (p) bulk(op, {users: p.users.map(u => u.id)}); };
 const colorPick = async (apply: (c: string) => void) => {
  const colors = await api<string[]>('efile.colors');
  const v = await chooseBox({title: 'Color', single: true, options: colors.map(c => ({id: c || 'none', label: c || 'No color'}))});
  if (v) apply(v[0] === 'none' ? '' : v[0]);
 };
 const bulkItems: MenuItem[] = [
  {icon: 'fa-cloud-upload', label: 'Add to My eFile', onClick: () => bulk('my.add')},
  {icon: 'fa-cloud-download', label: 'Remove from My eFile', onClick: () => bulk('my.remove')},
  {icon: 'fa-hand-o-up', label: 'MTT-MyeFile', onClick: () => bulk('mtt', {}, 'Moved to top.')},
  {icon: 'fa-hand-o-down', label: 'Cancel MTT-MyeFile', onClick: () => bulk('mtt.cancel')},
  {icon: 'fa-share-square-o', label: 'Share', onClick: withUsers('share', 'Share with')},
  {icon: 'fa-reply', label: 'Cancel Share', onClick: () => bulk('share.cancel')},
  {icon: 'fa-share-square-o', label: 'Share Balance', onClick: withUsers('shareBalance', 'Share balance with')},
  {icon: 'fa-reply', label: 'Cancel Share Balance', onClick: () => bulk('shareBalance.cancel')},
  {icon: 'fa-eye-slash', label: 'Hide', onClick: () => bulk('hide')},
  {icon: 'fa-eye', label: 'Cancel Hide', onClick: () => bulk('hide.cancel')},
  {icon: 'fa-globe', label: 'Set Password', onClick: async () => { if (!sel.length) return toast('Select at least one eFile first.'); const v = await formBox('Set Password', [{name: 'password', label: 'eFile Password', type: 'password', required: true}]); if (v) bulk('password', v, 'Password set.'); }},
  {icon: 'fa-times-circle', label: 'Cancel Password', onClick: () => bulk('password.cancel')},
  {icon: 'fa-user', label: 'Add/Remove Users', onClick: async () => {
   if (!sel.length) return toast('Select at least one eFile first.');
   const v = await formBox('Add/Remove Users', [{name: 'mode', label: 'Action', type: 'select', options: [['users.add', 'Add users'], ['users.remove', 'Remove users']]}]);
   if (!v) return; const p = await pickBox({title: v.mode === 'users.add' ? 'Add users' : 'Remove users'}); if (p) bulk(v.mode, {users: p.users.map(u => u.id)});
  }},
  {icon: 'fa-user-secret', label: 'Replace User', onClick: async () => {
   if (!sel.length) return toast('Select at least one eFile first.');
   const from = await pickBox({title: 'Replace this user…', single: true}); if (!from?.users[0]) return;
   const to = await pickBox({title: `…with this user (replacing ${from.users[0].label})`, single: true}); if (to?.users[0]) bulk('user.replace', {from: from.users[0].id, to: to.users[0].id});
  }},
  {icon: 'fa-edit', label: 'Replace eFile Name', onClick: async () => { if (!sel.length) return toast('Select at least one eFile first.'); const v = await formBox('Replace eFile Name', [{name: 'find', label: 'Find', required: true}, {name: 'replace', label: 'Replace with'}]); if (v) bulk('name.replace', v); }},
  {icon: 'fa-edit', label: 'Insert eFile Name', onClick: async () => { if (!sel.length) return toast('Select at least one eFile first.'); const v = await formBox('Insert eFile Name', [{name: 'text', label: 'Text', required: true}, {name: 'position', label: 'Position', type: 'select', options: [['start', 'Before the name'], ['end', 'After the name']]}]); if (v) bulk('name.insert', v); }},
  {icon: 'fa-cutlery', label: 'Add/Remove Color', onClick: () => { if (!sel.length) return toast('Select at least one eFile first.'); colorPick(c => bulk('color', {color: c})); }},
  {icon: 'fa-link', label: 'Add to eFile Link', onClick: () => bulk('link.add', {}, 'Added to eFile Link.')},
  {icon: 'fa-cogs', label: 'eFile Process Monitor', onClick: () => sel.length === 1 ? go(`/ims/efile/${sel[0]}/monitor`) : toast('Select one eFile.')},
  {icon: 'fa-folder-open', label: view === 'archive' ? 'Cancel Archive' : 'Archive', onClick: async () => { if (sel.length && await confirmBox(`${view === 'archive' ? 'Restore' : 'Archive'} ${sel.length} eFile(s)?`)) bulk(view === 'archive' ? 'archive.cancel' : 'archive'); }},
  ...(view === 'links' ? [{icon: 'fa-unlink', label: 'Remove from eFile Link', onClick: () => bulk('link.remove')}] as MenuItem[] : []),
 ];
 const viewItems: MenuItem[] = [
  {icon: 'fa-arrows', label: 'Sync With Wechat', onClick: () => toast('WeChat sync is not configured on this server.')},
  {icon: 'fa-magnet', label: 'Filter By Color', onClick: () => colorPick(c => go(`/ims/efile?view=color&color=${encodeURIComponent(c)}`))},
  {icon: 'fa-cogs', label: 'My Process', onClick: () => go('/ims/efile?view=process')},
  {icon: 'fa-check-square-o', label: 'My Confirmation', onClick: () => go('/ims/efile?view=confirmation')},
  {icon: 'fa-external-link', label: 'eFile Link', onClick: () => go('/ims/efile?view=links')},
  {icon: 'fa-eye-slash', label: 'Hide List', onClick: () => go('/ims/efile?view=hidden')},
  {icon: 'fa-cogs', label: 'eFile Explorer', onClick: () => go('/ims/efile?view=explorer')},
  {icon: 'fa-folder-open', label: 'Archive List', onClick: () => go('/ims/efile?view=archive')},
  ...(view !== 'my' ? ['-', {icon: 'fa-list', label: 'My eFile', onClick: () => go('/ims/efile')}] as MenuItem[] : []),
 ];
 const rowMenu = (e: any): MenuItem[] => [
  {icon: 'fa-list', label: 'View', onClick: () => go(`/ims/efile/${e.id}/view`)},
  {icon: 'fa-edit', label: 'Edit', onClick: () => go(`/ims/efile/${e.id}/edit`)},
  {icon: 'fa-times', label: 'Delete', onClick: async () => { if (await confirmBox(`Delete eFile "${e.name}" and all its items?`)) try { await api('efile.delete', {id: e.id}); reload(); } catch (err) { toastError(err); } }},
  {icon: 'fa-user', label: 'Set Confirmation', onClick: () => go(`/ims/efile/${e.id}/confirmation`)},
  {icon: 'fa-asterisk', label: 'Set Process', onClick: () => go(`/ims/efile/${e.id}/process`)},
  {icon: 'fa-magic', label: 'X Process Set', onClick: async () => { if (await confirmBox(`Remove the process that starts at "${e.name}"?`)) try { await api('process.clear', {efileId: e.id}); toast('Process removed.'); reload(); } catch (err) { toastError(err); } }},
  {icon: 'fa-hdd-o', label: 'Set Grand Balance/Sum', onClick: () => go(`/ims/efile/${e.id}/balance`)},
  {icon: 'fa-cogs', label: 'eFile Process Monitor', onClick: () => go(`/ims/efile/${e.id}/monitor`)},
  {icon: 'fa-wrench', label: 'Copy And Share', onClick: async () => { const p = await pickBox({title: `Copy "${e.name}" and share with`}); if (p) try { const r = await api('efile.copy', {id: e.id, shareWith: p.users.map(u => u.id)}); toast('Copied and shared.'); go(`/ims/efile/${r.id}/edit`); } catch (err) { toastError(err); } }},
  {icon: 'fa-reply', label: 'Cancel Share', onClick: async () => { try { await api('efile.bulk', {op: 'share.cancel', ids: [e.id]}); toast('Sharing cancelled.'); reload(); } catch (err) { toastError(err); } }},
  {icon: 'fa-files-o', label: 'Copy eFile', onClick: async () => { const v = await formBox('Copy eFile', [{name: 'name', label: 'Name', value: `${e.name} - Copy`, required: true}]); if (v) try { const r = await api('efile.copy', {id: e.id, name: v.name}); toast('Copied.'); go(`/ims/efile/${r.id}/edit`); } catch (err) { toastError(err); } }},
 ];
 const title = TITLES[view] ?? TITLES.my;
 return <>
  <Breadcrumb items={[{label: view === 'my' ? 'My eFile' : title, to: view === 'my' ? undefined : '/ims/efile'}]}
   tools={<><input aria-label="Search all eFiles" onKeyDown={e => { if (e.key === 'Enter') setPageQ((e.target as HTMLInputElement).value); }}/><button title="Search" onClick={e => setPageQ(((e.currentTarget.previousSibling as HTMLInputElement).value))}><i className="fa fa-search"/></button><button title="Refresh" onClick={reload}><i className="fa fa-refresh"/></button></>}/>
  <Panel color="blue" icon={false} title={<span style={{fontSize: 16}}>{title}{view === 'color' && color ? ` › ${color}` : ''}</span>} tools={<>
   <Tool icon="fa-plus" title="New eFile" onClick={() => go('/ims/efile/new')}/>
   <Tool icon="fa-th-large" title="Expand eFile" className={expanded ? 'on' : ''} onClick={() => setExpanded(x => !x)}/>
   <Tool icon="fa-folder-o" title="System Link" onClick={() => go('/ims/system-link')}/>
   <Tool icon="fa-spinner" title="Recently Updated" className={view === 'recent' ? 'on' : ''} onClick={() => go(view === 'recent' ? '/ims/efile' : '/ims/efile?view=recent')}/>
   <Tool icon="fa-gavel" title="To Do" className="red" onClick={() => go('/')}/>
   <ToolMenu icon="fa-cog" title="Actions" items={bulkItems}/>
   <ToolMenu icon="fa-asterisk" title="Views" items={viewItems}/>
  </>}>
   {data ? <DataTable rows={data} pageSize={100} selectable selected={sel} onSelect={setSel} sortable={false} searchValue={q}
    onSearch={v => { setQ(v); if (locked) writeLock(v); }}
    searchExtra={<button className="lock" title={locked ? 'Unlock search' : 'Lock search'} onClick={toggleLock}><i className={'fa ' + (locked ? 'fa-lock' : 'fa-unlock-alt')}/></button>}
    rowClass={(r: any) => 'efile-row tall' + (r.highlight ? ' hl' : '')}
    columns={[{key: 'name', title: 'Name', tdClass: (r: any) => 'name ' + colorClass(r.color), render: (r: any) => <>
     <a href={href('/ims/efile/' + r.id)}>{r.name}</a>
     <span className="markers">
      {!!r.locked && <i className="fa fa-lock" title="Password protected"/>}
      {!!r.in_process && <i className="fa fa-cogs" title="Part of a process"/>}
      {!!r.shared && <i className="fa fa-asterisk" title="Shared"/>}
      {!!r.mtt && <i className="fa fa-hand-o-up" title="Moved to top"/>}
     </span>
     {expanded && <div className="muted" style={{fontSize: 12.5, marginTop: 4, fontWeight: 400}}>{r.tag && <>Tag: {r.tag} · </>}Updated {fmtTime(r.updated_at)}</div>}
    </>}]}
    menu={rowMenu}/> : <Loading error={error}/>}
  </Panel>
 </>;
}

export function SystemLink() {
 const {data, error, reload} = useLoad(() => api<any[]>('systemlink.list'), []);
 const [sel, setSel] = useState<string[]>([]);
 const edit = async (r?: any) => {
  const v = await formBox(r ? 'Edit System Link' : 'Add System Link', [{name: 'name', label: 'Name', value: r?.name, required: true}, {name: 'url', label: 'Link (https://…)', value: r?.url, required: true}]);
  if (v) try { await api('systemlink.save', {...v, id: r?.id}); reload(); } catch (e) { toastError(e); }
 };
 return <>
  <Breadcrumb items={[{label: 'IMS'}, {label: 'My eFile', to: '/ims/efile'}, {label: 'System Link'}]}/>
  <Panel color="blue" icon title="System Link" tools={<>
   <Tool icon="fa-sitemap" title="My eFile" onClick={() => go('/ims/efile')}/>
   <Tool icon="fa-folder-o" title="eFile Explorer" onClick={() => go('/ims/efile?view=explorer')}/>
   <ToolMenu icon="fa-cog" title="Actions" items={[{icon: 'fa-plus', label: 'Add Link', onClick: () => edit()}, {icon: 'fa-times', label: 'Delete Selected', onClick: async () => {
    if (!sel.length) return toast('Select at least one link.'); if (!await confirmBox(`Delete ${sel.length} link(s)?`)) return;
    try { for (const id of sel) await api('systemlink.delete', {id}); setSel([]); reload(); } catch (e) { toastError(e); } }}]}/>
  </>}>
   {data ? <DataTable rows={data} unit="items" selectable selected={sel} onSelect={setSel} columns={[{key: 'name', title: 'Name', sort: r => r.name, render: r => <a className="link" href={r.url} target="_blank" rel="noopener noreferrer">{r.name}</a>}]}
    menu={r => [{icon: 'fa-edit', label: 'Edit', onClick: () => edit(r)}, {icon: 'fa-times', label: 'Delete', onClick: async () => { if (await confirmBox(`Delete ${r.name}?`)) try { await api('systemlink.delete', {id: r.id}); reload(); } catch (e) { toastError(e); } }}]}/> : <Loading error={error}/>}
  </Panel>
 </>;
}
