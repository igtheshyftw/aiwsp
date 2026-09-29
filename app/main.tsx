import {createRoot} from 'react-dom/client';
import {useEffect, useState} from 'react';
import 'font-awesome/css/font-awesome.css';
import './ims.css';
import {api, useRoute} from './lib';
import {Shell, Overlays, toastError, type Me} from './ui';
import {Login} from './pages/login';
import {Home} from './pages/home';
import {EfileList, SystemLink} from './pages/efiles';
import {EfileForm, EfileView, SetConfirmation, SetBalance, ProcessMonitor} from './pages/efile-setup';
import {ItemList} from './pages/items';
import {ItemForm, ItemView} from './pages/item-form';
import {SetProcess} from './pages/process';
import {CompanyList, CompanyForm, UserList, UserForm, RoleList, RoleForm, RoleUsers, GroupList, GroupForm, GroupUsers, GroupEfiles, SystemLog, Profile} from './pages/account';
import {ClientList, ClientForm} from './pages/client';

function Router({me}: {me: Me}) {
 const {parts, query} = useRoute();
 const [a, b, c, d, e, f] = parts;
 if (!a) return <Home/>;
 if (a === 'profile') return <Profile me={me} changePassword={!!query.password}/>;
 if (a === 'ims' && b === 'efile') {
  if (!c) return <EfileList view={query.view ?? 'my'} color={query.color}/>;
  if (c === 'new') return <EfileForm/>;
  if (!d) return <ItemList efileId={c} filter={query.filter}/>;
  if (d === 'edit') return <EfileForm id={c}/>;
  if (d === 'view') return <EfileView id={c}/>;
  if (d === 'confirmation') return <SetConfirmation id={c}/>;
  if (d === 'balance') return <SetBalance id={c}/>;
  if (d === 'process') return <SetProcess efileId={c}/>;
  if (d === 'monitor') return <ProcessMonitor id={c} tab={query.tab}/>;
  if (d === 'item' && e === 'new') return <ItemForm efileId={c}/>;
  if (d === 'item' && e && f === 'edit') return <ItemForm efileId={c} id={e}/>;
  if (d === 'item' && e) return <ItemView efileId={c} id={e}/>;
 }
 if (a === 'ims' && b === 'system-link') return <SystemLink/>;
 if (a === 'ims' && b === 'client') return c ? <ClientForm id={c === 'new' ? undefined : c}/> : <ClientList/>;
 if (a === 'account') {
  if (b === 'company') return c ? <CompanyForm id={c === 'new' ? undefined : c}/> : <CompanyList me={me}/>;
  if (b === 'user') return c ? <UserForm id={c === 'new' ? undefined : c} companyId={query.company}/> : <UserList me={me} companyId={query.company}/>;
  if (b === 'role') return c ? (d === 'users' ? <RoleUsers id={c}/> : <RoleForm id={c === 'new' ? undefined : c}/>) : <RoleList/>;
  if (b === 'group') return c ? (d === 'users' ? <GroupUsers id={c}/> : d === 'efiles' ? <GroupEfiles id={c}/> : <GroupForm id={c === 'new' ? undefined : c}/>) : <GroupList/>;
  if (b === 'log') return <SystemLog/>;
 }
 return <p>Page not found. <a href="#/">Go to eFile</a></p>;
}

function App() {
 const [me, setMe] = useState<Me | null | undefined>(undefined);
 useEffect(() => {
  api<Me | null>('me').then(setMe).catch(() => setMe(null));
  const out = () => setMe(null); window.addEventListener('ims:signed-out', out); return () => window.removeEventListener('ims:signed-out', out);
 }, []);
 const logout = async () => { try { await api('logout'); } catch (e) { toastError(e); } setMe(null); location.hash = '/'; };
 if (me === undefined) return null;
 return <>
  {me ? <Shell me={me} onLogout={logout}><Router me={me}/></Shell> : <Login onLogin={setMe}/>}
  <Overlays/>
 </>;
}
createRoot(document.getElementById('root')!).render(<App/>);
