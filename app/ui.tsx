// Shared IMS building blocks: shell, breadcrumb, panels, DataTables-style lists, dropdown menus, dialogs and pickers.
import {useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode} from 'react';
import {api, go, href, useRoute, fmtTime} from './lib';

export type Me = {id: string, username: string, name: string, name_en: string, position: string, level: number, company: {id: string, name_cn: string, name_en: string, operator: boolean},
 sys: boolean, perms: string[], functions: string[], mfa: boolean, mfa_required: boolean};
export const POSITION: Record<string, string> = {system: 'System Admin', chief: 'Chief Admin', useradmin: 'User Admin', member: 'User'};

// ---------- Toasts and dialogs (module-level so any page can call them)
type Dialog = {kind: 'confirm', message: string, resolve: (v: any) => void} | {kind: 'form', title: string, fields: Field[], resolve: (v: any) => void}
 | {kind: 'pick', opts: PickOptions, resolve: (v: any) => void} | {kind: 'choose', opts: ChooseOptions, resolve: (v: any) => void};
let pushToast: (m: string, error?: boolean) => void = () => {};
let pushDialog: (d: Dialog) => void = () => {};
export const toast = (m: string) => pushToast(m);
export const toastError = (e: any) => pushToast(e?.message ?? String(e), true);
export const confirmBox = (message: string) => new Promise<boolean>(resolve => pushDialog({kind: 'confirm', message, resolve}));
export type Field = {name: string, label: string, type?: 'text' | 'password' | 'select' | 'textarea' | 'date', options?: [string, string][], value?: string, required?: boolean};
export const formBox = (title: string, fields: Field[]) => new Promise<Record<string, string> | null>(resolve => pushDialog({kind: 'form', title, fields, resolve}));
export type PickOptions = {title: string, users?: boolean, groups?: boolean, single?: boolean, selectedUsers?: string[], selectedGroups?: string[], companyId?: string, ownOnly?: boolean};
export type Picked = {users: {id: string, label: string}[], groups: {id: string, label: string}[]};
export const pickBox = (opts: PickOptions) => new Promise<Picked | null>(resolve => pushDialog({kind: 'pick', opts, resolve}));
export type ChooseOptions = {title: string, options: {id: string, label: string}[], selected?: string[], single?: boolean};
export const chooseBox = (opts: ChooseOptions) => new Promise<string[] | null>(resolve => pushDialog({kind: 'choose', opts, resolve}));

export function Overlays() {
 const [toasts, setToasts] = useState<{id: number, m: string, error?: boolean}[]>([]);
 const [dialogs, setDialogs] = useState<Dialog[]>([]);
 useEffect(() => {
  pushToast = (m, error) => { const id = Date.now() + Math.random(); setToasts(t => [...t, {id, m, error}]); setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), error ? 6000 : 3000); };
  pushDialog = d => setDialogs(ds => [...ds, d]);
 }, []);
 const close = (d: Dialog, v: any) => { d.resolve(v); setDialogs(ds => ds.filter(x => x !== d)); };
 return <>
  {toasts.map((t, i) => <div key={t.id} className={'toast' + (t.error ? ' error' : '')} style={{top: 48 + i * 52}}>{t.m}</div>)}
  {dialogs.map((d, i) => d.kind === 'confirm'
   ? <Modal key={i} title="Confirm" onClose={() => close(d, false)} foot={<><button className="btn grey" onClick={() => close(d, false)}>Cancel</button><button className="btn blue" autoFocus onClick={() => close(d, true)}>OK</button></>}>
     <p style={{margin: 0}}>{d.message}</p></Modal>
   : d.kind === 'form' ? <FormDialog key={i} d={d} close={v => close(d, v)}/> : d.kind === 'pick' ? <PickDialog key={i} opts={d.opts} close={v => close(d, v)}/>
   : <ChooseDialog key={i} opts={d.opts} close={v => close(d, v)}/>)}
 </>;
}
function FormDialog({d, close}: {d: Extract<Dialog, {kind: 'form'}>, close: (v: any) => void}) {
 const [v, setV] = useState<Record<string, string>>(Object.fromEntries(d.fields.map(f => [f.name, f.value ?? (f.options?.[0]?.[0] ?? '')])));
 const ok = d.fields.every(f => !f.required || v[f.name]?.trim());
 return <Modal title={d.title} onClose={() => close(null)} foot={<><button className="btn grey" onClick={() => close(null)}>Cancel</button><button className="btn blue" disabled={!ok} onClick={() => close(v)}>OK</button></>}>
  <form onSubmit={e => { e.preventDefault(); if (ok) close(v); }}>
   {d.fields.map((f, i) => <div className="field" key={f.name}>
    <label>{f.required && <span style={{color: '#d9432f'}}>*</span>}{f.label}</label>
    {f.type === 'select' ? <select value={v[f.name]} onChange={e => setV({...v, [f.name]: e.target.value})}>{f.options!.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
     : f.type === 'textarea' ? <textarea rows={4} value={v[f.name]} onChange={e => setV({...v, [f.name]: e.target.value})} autoFocus={i === 0}/>
     : <input type={f.type ?? 'text'} value={v[f.name]} onChange={e => setV({...v, [f.name]: e.target.value})} autoFocus={i === 0}/>}
   </div>)}
   <button type="submit" hidden/>
  </form>
 </Modal>;
}
function PickDialog({opts, close}: {opts: PickOptions, close: (v: Picked | null) => void}) {
 const [dir, setDir] = useState<{users: any[], groups: any[]} | null>(null);
 const [users, setUsers] = useState<string[]>(opts.selectedUsers ?? []);
 const [groups, setGroups] = useState<string[]>(opts.selectedGroups ?? []);
 const [q, setQ] = useState('');
 useEffect(() => { api('directory', {companyId: opts.companyId}).then(d => setDir(opts.ownOnly ? {...d, users: d.users.filter((u: any) => !u.external)} : d)).catch(toastError); }, [opts.companyId, opts.ownOnly]);
 const toggle = (list: string[], set: (v: string[]) => void, id: string) => set(opts.single ? [id] : list.includes(id) ? list.filter(x => x !== id) : [...list, id]);
 const match = (s: string) => s.toLowerCase().includes(q.toLowerCase());
 const done = () => close({users: (dir?.users ?? []).filter(u => users.includes(u.id)).map(u => ({id: u.id, label: u.username})), groups: (dir?.groups ?? []).filter(g => groups.includes(g.id)).map(g => ({id: g.id, label: g.name}))});
 return <Modal title={opts.title} onClose={() => close(null)} foot={<><button className="btn grey" onClick={() => close(null)}>Cancel</button><button className="btn blue" onClick={done}>OK</button></>}>
  <div className="field"><input type="text" placeholder="Search" value={q} onChange={e => setQ(e.target.value)}/></div>
  {!dir ? <p className="muted">Loading…</p> : <div className={opts.users !== false && opts.groups ? 'picker-cols' : ''}>
   {opts.users !== false && <div><h4>Users</h4>{dir.users.filter(u => match(u.username + u.label)).map(u =>
    <label className="row" key={u.id}><input type={opts.single ? 'radio' : 'checkbox'} checked={users.includes(u.id)} onChange={() => toggle(users, setUsers, u.id)}/>{u.username} <span className="muted">{u.label !== u.username ? u.label : ''}</span>{u.external && <span className="ext">{u.company}</span>}</label>)}</div>}
   {opts.groups && <div><h4>Groups</h4>{dir.groups.length ? dir.groups.filter(g => match(g.name)).map(g =>
    <label className="row" key={g.id}><input type="checkbox" checked={groups.includes(g.id)} onChange={() => toggle(groups, setGroups, g.id)}/>{g.name}</label>) : <p className="muted">No user groups.</p>}</div>}
  </div>}
 </Modal>;
}

function ChooseDialog({opts, close}: {opts: ChooseOptions, close: (v: string[] | null) => void}) {
 const [sel, setSel] = useState<string[]>(opts.selected ?? []);
 const [q, setQ] = useState('');
 const toggle = (id: string) => setSel(opts.single ? [id] : sel.includes(id) ? sel.filter(x => x !== id) : [...sel, id]);
 return <Modal title={opts.title} onClose={() => close(null)} foot={<><button className="btn grey" onClick={() => close(null)}>Cancel</button><button className="btn blue" disabled={opts.single && !sel.length} onClick={() => close(sel)}>OK</button></>}>
  <div className="field"><input type="text" placeholder="Search" value={q} onChange={e => setQ(e.target.value)} autoFocus/></div>
  {opts.options.length === 0 && <p className="muted">Nothing to choose from.</p>}
  {opts.options.filter(o => o.label.toLowerCase().includes(q.toLowerCase())).map(o =>
   <label className="row" key={o.id}><input type={opts.single ? 'radio' : 'checkbox'} checked={sel.includes(o.id)} onChange={() => toggle(o.id)}/>{o.label}</label>)}
 </Modal>;
}

export function Modal({title, onClose, foot, children, wide}: {title: string, onClose: () => void, foot?: ReactNode, children: ReactNode, wide?: boolean}) {
 useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); }; window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k); }, [onClose]);
 return <div className="backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
  <div className="modal" style={wide ? {width: 'min(1000px, 94vw)'} : undefined} role="dialog" aria-label={title}>
   <div className="panel-head blue"><i className="fa fa-bars"/> {title}<button className="close" onClick={onClose} aria-label="Close"><i className="fa fa-times"/></button></div>
   <div className="modal-body">{children}</div>
   {foot && <div className="modal-foot">{foot}</div>}
  </div>
 </div>;
}

// ---------- Dropdown menu
export type MenuItem = {icon?: string, label: ReactNode, onClick?: () => void, disabled?: boolean} | '-';
export function Menu({button, items, align = 'right'}: {button: (open: () => void, isOpen: boolean) => ReactNode, items: MenuItem[], align?: 'left' | 'right'}) {
 const [open, setOpen] = useState(false);
 const [side, setSide] = useState(align);
 const ref = useRef<HTMLDivElement>(null);
 const drop = useRef<HTMLDivElement>(null);
 // Keep the menu on screen: flip to the other side when it would overflow the window.
 useLayoutEffect(() => {
  if (!open) { setSide(align); return; }
  const r = drop.current?.getBoundingClientRect(); if (!r) return;
  if (r.right > window.innerWidth - 4 && side === 'left') setSide('right');
  else if (r.left < 4 && side === 'right') setSide('left');
 }, [open, side, align]);
 useEffect(() => {
  if (!open) return;
  const off = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
  document.addEventListener('mousedown', off); return () => document.removeEventListener('mousedown', off);
 }, [open]);
 return <div ref={ref} style={{position: 'relative', display: 'inline-block'}}>
  {button(() => setOpen(o => !o), open)}
  {open && <div ref={drop} className="dropdown" style={{top: '100%', [side]: 0}}>
   {items.map((it, i) => it === '-' ? <hr key={i}/> :
    <button key={i} disabled={it.disabled} onClick={() => { setOpen(false); it.onClick?.(); }}>{it.icon && <i className={'fa ' + it.icon}/>}{it.label}</button>)}
  </div>}
 </div>;
}
export const RowMenu = ({items}: {items: MenuItem[]}) =>
 <Menu items={items} align="left" button={toggle => <button className="row-btn" onClick={toggle} aria-label="Actions"><i className="fa fa-list-ul"/></button>}/>;
export const ToolMenu = ({icon, title, items, className = ''}: {icon: string, title: string, items: MenuItem[], className?: string}) =>
 <Menu items={items} button={(toggle, on) => <button className={`tool ${className} ${on ? 'on' : ''}`} title={title} aria-label={title} onClick={toggle}><i className={'fa ' + icon}/></button>}/>;
export const Tool = ({icon, title, onClick, className = ''}: {icon: string, title: string, onClick: () => void, className?: string}) =>
 <button className={'tool ' + className} title={title} aria-label={title} onClick={onClick}><i className={'fa ' + icon}/></button>;

// ---------- Shell
export function Shell({me, children, onLogout}: {me: Me, children: ReactNode, onLogout: () => void}) {
 const route = useRoute();
 const section = route.parts[0] === 'account' ? 'account' : route.parts[0] === 'ims' ? 'ims' : '';
 const [open, setOpen] = useState<string>(section || 'ims');
 useEffect(() => { if (section) setOpen(section); }, [section]);
 const [collapsed, setCollapsed] = useState(false);
 useEffect(() => { document.body.classList.toggle('collapsed', collapsed); }, [collapsed]);
 const [counters, setCounters] = useState({messages: 0, confirm: 0});
 useEffect(() => { const load = () => api('counters').then(setCounters).catch(() => {}); load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [route.path]);
 const perms = new Set(me.perms);
 const accountItems: [string, string, string][] = ([['company', 'Company', '/account/company'], ['user', 'User', '/account/user'], ['role', 'Role', '/account/role'], ['group', 'User Group', '/account/group'], ['connection', 'Connection', '/account/connection'], ['log', 'System Log', '/account/log']] as [string, string, string][]).filter(([p]) => perms.has(p));
 const active = (p: string) => route.path === p || route.path.startsWith(p + '/');
 return <>
  <header className="topbar">
   <a className="logo" href={href('/')} aria-label="IMS home"><b>IMS<small>eFile</small></b></a>
   <span className="spacer"/>
   <Notices counters={counters}/>
   <Menu items={[
    {icon: 'fa-user', label: 'My Profile', onClick: () => go('/profile')},
    {icon: 'fa-key', label: 'Change Password', onClick: () => go('/profile?password=1')},
    {icon: 'fa-mobile', label: me.mfa ? 'Authenticator: on' : 'Set Up Authenticator', onClick: () => go('/mfa')},
    '-',
    {icon: 'fa-sign-out', label: 'Log Out', onClick: onLogout},
   ]} button={toggle => <button className="user-btn" onClick={toggle}><span className="avatar"><i className="fa fa-user"/></span><span className="user-name">{me.name_en}</span><span className="user-pos">{POSITION[me.position]}</span><i className="fa fa-angle-down"/></button>}/>
  </header>
  <nav className="sidebar" aria-label="Main">
   <button className="toggle" onClick={() => setCollapsed(c => !c)} aria-label="Toggle menu"><i className="fa fa-bars"/></button>
   <ul className="menu">
    <li><a href={href('/')}><i className="fa fa-home"/><span className="label">eFile</span></a></li>
    <li className={open === 'ims' ? 'open' : ''}>
     <a href="#" onClick={e => { e.preventDefault(); setOpen(open === 'ims' ? '' : 'ims'); }}><i className="fa fa-table"/><span className="label">IMS</span><i className="fa fa-angle-left arrow"/></a>
     {open === 'ims' && <ul className="submenu">
      <li><a className={active('/ims/efile') ? 'active' : ''} href={href('/ims/efile')}>My eFile</a></li>
      {perms.has('client') && <li><a className={active('/ims/client') ? 'active' : ''} href={href('/ims/client')}>Client Management</a></li>}
     </ul>}
    </li>
    {accountItems.length > 0 && <li className={open === 'account' ? 'open' : ''}>
     <a href="#" onClick={e => { e.preventDefault(); setOpen(open === 'account' ? '' : 'account'); }}><i className="fa fa-table"/><span className="label">Account</span><i className="fa fa-angle-left arrow"/></a>
     {open === 'account' && <ul className="submenu">{accountItems.map(([k, l, p]) => <li key={k}><a className={active(p) ? 'active' : ''} href={href(p)}>{l}</a></li>)}</ul>}
    </li>}
   </ul>
  </nav>
  <div className="main">
   <div className="page">{children}</div>
   <footer className="footer"><span>2015 © IMS</span><button className="up" onClick={() => window.scrollTo({top: 0, behavior: 'smooth'})} aria-label="Back to top"><i className="fa fa-angle-up"/></button></footer>
  </div>
 </>;
}

function Notices({counters}: {counters: {messages: number, confirm: number}}) {
 const [list, setList] = useState<any[] | null>(null);
 const openInbox = async () => { try { setList(await api('notifications')); await api('notifications.read'); } catch (e) { toastError(e); } };
 const soon = (what: string) => () => toast(`${what} is not available in this version.`);
 return <>
  <button className="badge-btn" title="qChat" onClick={soon('qChat')}><span className="count green">0</span><i className="fa fa-comment-o"/></button>
  <button className="badge-btn" title="Service Team" onClick={soon('Service Team')}><span className="count purple">0</span><i className="fa fa-sitemap"/></button>
  <button className="badge-btn" title="To Do: confirmations" onClick={() => go('/')}><span className="count red">{counters.confirm}</span><i className="fa fa-bullhorn"/></button>
  <button className="badge-btn" title="Messages" onClick={openInbox}><span className="count blue">{counters.messages}</span><i className="fa fa-envelope"/></button>
  {list && <div className="backdrop" style={{background: 'transparent', placeItems: 'start end', padding: '38px 90px 0 0'}} onMouseDown={e => { if (e.target === e.currentTarget) setList(null); }}>
   <div className="dropdown notice-list" style={{position: 'static'}}>
    {list.length === 0 ? <div className="n">No messages.</div> : list.map(n =>
     <div key={n.id} className={'n' + (n.read_at ? '' : ' unread')} onClick={() => { setList(null); if (n.efile_id) go(`/ims/efile/${n.efile_id}`); }}>{n.title}<small>{fmtTime(n.at)}</small></div>)}
   </div>
  </div>}
 </>;
}

export type Crumb = {label: ReactNode, to?: string};
export function Breadcrumb({items, tools, color}: {items: Crumb[], tools?: ReactNode, color?: string}) {
 return <div className={'crumb ' + (color ? 'tinted ' + color : '')}>
  <i className="fa fa-home"/>
  {items.map((c, i) => <span key={i} style={{display: 'contents'}}>{i > 0 && <i className="fa fa-angle-right sep"/>}{c.to ? <a href={href(c.to)}>{c.label}</a> : <span>{c.label}</span>}</span>)}
  {tools && <div className="tools">{tools}</div>}
 </div>;
}
export function Panel({title, color = 'grey', sub, tools, children, icon = true}: {title: ReactNode, color?: 'grey' | 'blue', sub?: ReactNode, tools?: ReactNode, children: ReactNode, icon?: boolean}) {
 return <section className="panel">
  <div className={'panel-head ' + color}>{icon && <i className="fa fa-globe"/>}{title}{sub}{tools && <div className="tools">{tools}</div>}</div>
  <div className="panel-body">{children}</div>
 </section>;
}

// ---------- DataTable
export type Column<T> = {key: string, title: ReactNode, render?: (r: T) => ReactNode, sort?: (r: T) => string | number, className?: string, width?: number | string, tdClass?: (r: T) => string};
export function DataTable<T extends {id: string}>({columns, rows, pageSizes = [10, 25, 50, 100], pageSize = 50, selectable, selected, onSelect, rowClass, menu, unit = 'data',
 search = true, searchValue, onSearch, searchExtra, top, pinned, sortable = true, emptyText = 'No data available in table'}: {
 columns: Column<T>[], rows: T[], pageSizes?: number[], pageSize?: number, selectable?: boolean, selected?: string[], onSelect?: (ids: string[]) => void,
 rowClass?: (r: T) => string, menu?: (r: T) => MenuItem[], unit?: string, search?: boolean, searchValue?: string, onSearch?: (q: string) => void,
 searchExtra?: ReactNode, top?: ReactNode, pinned?: ReactNode, sortable?: boolean, emptyText?: string}) {
 const [size, setSize] = useState(pageSize);
 const [page, setPage] = useState(0);
 const [q, setQ] = useState('');
 const [sort, setSort] = useState<{key: string, dir: 1 | -1} | null>(null);
 const query = searchValue ?? q;
 const filtered = useMemo(() => {
  let r = rows;
  if (query) {
   const s = query.toLowerCase();
   const text = (x: any) => Object.entries(x).filter(([k, v]) => k !== 'id' && !k.endsWith('_id') && (typeof v === 'string' || typeof v === 'number')).map(([, v]) => String(v)).join(' ').toLowerCase();
   r = r.filter(x => text(x).includes(s));
  }
  if (sort) { const col = columns.find(c => c.key === sort.key); const val = col?.sort ?? ((x: any) => String(x[sort.key] ?? '')); r = [...r].sort((a, b) => { const va = val(a), vb = val(b); return (va < vb ? -1 : va > vb ? 1 : 0) * sort.dir; }); }
  return r;
 }, [rows, query, sort, columns]);
 const pages = Math.max(1, Math.ceil(filtered.length / size));
 const cur = Math.min(page, pages - 1);
 const shown = filtered.slice(cur * size, cur * size + size);
 const sel = new Set(selected ?? []);
 const allOn = shown.length > 0 && shown.every(r => sel.has(r.id));
 const pageButtons = Array.from({length: pages}, (_, i) => i).filter(i => pages <= 7 || Math.abs(i - cur) <= 2 || i === 0 || i === pages - 1);
 return <div className="table-wrap">
  {top}
  <div className="dt-top">
   <select value={size} onChange={e => { setSize(Number(e.target.value)); setPage(0); }} aria-label="Rows per page">{pageSizes.map(n => <option key={n}>{n}</option>)}</select>
   {search && <div className="dt-search"><input aria-label="Search" value={query} onChange={e => { onSearch ? onSearch(e.target.value) : setQ(e.target.value); setPage(0); }}/>{searchExtra}</div>}
  </div>
  <table className="dt">
   <thead><tr>
    {selectable && <th className="check"><input type="checkbox" checked={allOn} aria-label="Select all" onChange={() => onSelect?.(allOn ? [...sel].filter(id => !shown.some(r => r.id === id)) : [...new Set([...sel, ...shown.map(r => r.id)])])}/></th>}
    {columns.map(c => <th key={c.key} style={{width: c.width}} className={[c.className, sortable && c.sort !== undefined ? 'sortable' : '', sort?.key === c.key ? (sort.dir === 1 ? 'asc' : 'desc') : ''].join(' ')}
     onClick={() => sortable && c.sort !== undefined && setSort(s => s?.key === c.key ? {key: c.key, dir: s.dir === 1 ? -1 : 1} : {key: c.key, dir: 1})}>{c.title}</th>)}
    {menu && <th className="menu-col"/>}
   </tr></thead>
   <tbody>
    {pinned}
    {shown.length === 0 && !pinned ? <tr><td className="empty" colSpan={columns.length + (selectable ? 1 : 0) + (menu ? 1 : 0)}>{emptyText}</td></tr> :
     shown.map(r => <tr key={r.id} className={rowClass?.(r)}>
      {selectable && <td className="check"><input type="checkbox" checked={sel.has(r.id)} aria-label="Select row" onChange={() => onSelect?.(sel.has(r.id) ? [...sel].filter(x => x !== r.id) : [...sel, r.id])}/></td>}
      {columns.map(c => <td key={c.key} className={[c.className, c.tdClass?.(r)].filter(Boolean).join(' ')}>{c.render ? c.render(r) : (r as any)[c.key]}</td>)}
      {menu && <td className="menu-cell"><RowMenu items={menu(r)}/></td>}
     </tr>)}
   </tbody>
  </table>
  <div className="dt-info">Showing {filtered.length ? cur * size + 1 : 0} to {Math.min(filtered.length, cur * size + size)} of {filtered.length} {unit}</div>
  <div className="pager">
   <button disabled={cur === 0} onClick={() => setPage(cur - 1)}><i className="fa fa-long-arrow-left"/> Prev</button>
   {filtered.length > 0 && pageButtons.map(i => <button key={i} className={i === cur ? 'cur' : ''} onClick={() => setPage(i)}>{i + 1}</button>)}
   <button disabled={cur >= pages - 1} onClick={() => setPage(cur + 1)}>Next <i className="fa fa-long-arrow-right"/></button>
  </div>
 </div>;
}

// ---------- Form helpers (IMS setup-form layout)
export function FormPanel({title, onSave, children, actions}: {title: ReactNode, onSave?: () => void, children: ReactNode, actions?: ReactNode}) {
 return <section className="panel">
  <div className="panel-head blue small" style={{fontSize: 20}}><i className="fa fa-bars"/> {title}
   {onSave && <div className="tools"><button className="save-btn" onClick={onSave} title="Save" aria-label="Save"><i className="fa fa-square"/> <i className="fa fa-envelope-o"/></button></div>}
  </div>
  <div className="form">{children}</div>
  {actions && <div className="form"><div className="actions">{actions}</div></div>}
 </section>;
}
export const FieldRow = ({label, req, children}: {label: ReactNode, req?: boolean, children: ReactNode}) =>
 <div className="field"><label className={req ? 'req' : ''}>{label}</label>{children}</div>;
export function PickedField({label, req, value, onPick, onClear}: {label: string, req?: boolean, value: string, onPick: () => void, onClear: () => void}) {
 return <div className="field"><label className={req ? 'req' : ''}>{label}</label>
  <div className="picked"><div className="box" role="button" tabIndex={0} onClick={onPick} onKeyDown={e => { if (e.key === 'Enter') onPick(); }}>{value}</div>
   <button className="clear" onClick={onClear} aria-label={'Clear ' + label}><i className="fa fa-times-circle-o"/></button></div></div>;
}
export const Loading = ({error}: {error?: string}) => error ? <div className="panel"><div className="panel-body" style={{color: '#c9302c'}}>{error}</div></div> : <p className="muted">Loading…</p>;
