import {useState} from 'react';
import {api} from '../lib';
import type {Me} from '../ui';

export function Login({onLogin}: {onLogin: (me: Me) => void}) {
 const [username, setUsername] = useState('');
 const [password, setPassword] = useState('');
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const submit = async (e: React.FormEvent) => {
  e.preventDefault(); setBusy(true); setError('');
  try { onLogin(await api<Me>('login', {username, password})); } catch (err: any) { setError(err.message); } finally { setBusy(false); }
 };
 return <div className="login-wrap">
  <div className="login">
   <div className="brand"><span className="logo" style={{width: 44, height: 40}}><b>IMS<small>eFile</small></b></span> IMS</div>
   <form onSubmit={submit}>
    <label htmlFor="u">User Name</label>
    <input id="u" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus required/>
    <label htmlFor="p">Password</label>
    <input id="p" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required/>
    {error && <p style={{color: '#c9302c', margin: '0 0 12px'}}>{error}</p>}
    <button className="btn blue" disabled={busy}>{busy ? 'Signing in…' : 'Log In'}</button>
   </form>
  </div>
 </div>;
}
