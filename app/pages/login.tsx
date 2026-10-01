// Sign-in (with authenticator code), QR-code registration, password reset link and authenticator enrolment.
import {useEffect, useState} from 'react';
import {api, parseHash} from '../lib';
import {toast, type Me} from '../ui';

function Card({title, children}: {title: string, children: React.ReactNode}) {
 return <div className="login-wrap">
  <div className="login">
   <div className="brand"><span className="logo" style={{width: 44, height: 40}}><b>IMS<small>eFile</small></b></span> {title}</div>
   {children}
  </div>
 </div>;
}

// Set by the online demo (demo/main.ts): sample accounts to sign in with.
const demo = (window as any).IMS_DEMO as {password: string, accounts: [string, string][]} | undefined;

export function Login({onLogin}: {onLogin: (me: Me) => void}) {
 const [username, setUsername] = useState('');
 const [password, setPassword] = useState('');
 const [code, setCode] = useState('');
 const [needCode, setNeedCode] = useState(false);
 const [error, setError] = useState('');
 const [busy, setBusy] = useState(false);
 const submit = async (e: React.FormEvent) => {
  e.preventDefault(); setBusy(true); setError('');
  try {
   const r = await api<any>('login', {username, password, code: needCode ? code : undefined});
   if (r.needCode) setNeedCode(true); else onLogin(r);
  } catch (err: any) { setError(err.message); } finally { setBusy(false); }
 };
 return <Card title="IMS">
  <form onSubmit={submit}>
   <label htmlFor="u">User Name</label>
   <input id="u" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} autoFocus required disabled={needCode}/>
   <label htmlFor="p">Password</label>
   <input id="p" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={needCode}/>
   {needCode && <><label htmlFor="c">Authenticator code</label><input id="c" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={e => setCode(e.target.value)} autoFocus required/></>}
   {error && <p style={{color: '#c9302c', margin: '0 0 12px'}}>{error}</p>}
   <button className="btn blue" disabled={busy}>{busy ? 'Signing in…' : needCode ? 'Verify' : 'Log In'}</button>
  </form>
  {demo && <div className="demo-accounts">
   <p>Online demo with sample data. Choose who to sign in as (password <b>{demo.password}</b>):</p>
   {demo.accounts.map(([u, role]) => <button key={u} type="button" onClick={() => { setUsername(u); setPassword(demo.password); }}><b>{u}</b> <span>{role}</span></button>)}
  </div>}
 </Card>;
}

export function Register({onLogin}: {onLogin: (me: Me) => void}) {
 const token = parseHash().query.token ?? '';
 const [company, setCompany] = useState<string | null>(null);
 const [error, setError] = useState('');
 const [f, setF] = useState({username: '', name_cn: '', name_en: '', password: '', confirm: '', mobile: ''});
 useEffect(() => { api('register.info', {token}).then(r => setCompany(r.company_cn && r.company_cn !== r.company ? `${r.company} (${r.company_cn})` : r.company)).catch(e => setError(e.message)); }, [token]);
 const set = (k: string) => (e: any) => setF({...f, [k]: e.target.value});
 const submit = async (e: React.FormEvent) => {
  e.preventDefault(); setError('');
  if (f.password !== f.confirm) return setError('The two passwords do not match.');
  try { const me = await api<Me>('register', {token, ...f}); location.hash = '/'; onLogin(me); } catch (err: any) { setError(err.message); }
 };
 return <Card title="Register">
  <form onSubmit={submit}>
   {company ? <p style={{marginTop: 0}}>Joining <b>{company}</b>. You can use the system as soon as you register.</p> : !error && <p className="muted">Checking the registration code…</p>}
   {company && <>
    <label htmlFor="ru">User name (unique, used to sign in)</label><input id="ru" value={f.username} onChange={set('username')} autoComplete="username" required autoFocus/>
    <label htmlFor="rn">English name</label><input id="rn" value={f.name_en} onChange={set('name_en')}/>
    <label htmlFor="rc">Chinese name 中文名</label><input id="rc" value={f.name_cn} onChange={set('name_cn')}/>
    <label htmlFor="rm">Mobile number for WeCom 企业微信手机号</label><input id="rm" type="tel" value={f.mobile} onChange={set('mobile')} required/>
    <label htmlFor="rp">Password</label><input id="rp" type="password" value={f.password} onChange={set('password')} autoComplete="new-password" required/>
    <label htmlFor="rp2">Enter the password again</label><input id="rp2" type="password" value={f.confirm} onChange={set('confirm')} autoComplete="new-password" required/>
   </>}
   {error && <p style={{color: '#c9302c', margin: '0 0 12px'}}>{error}</p>}
   {company && <button className="btn blue">Register</button>}
   <p style={{margin: '14px 0 0'}}><a href="#/" style={{color: '#2a6fdb'}}>Back to sign in</a></p>
  </form>
 </Card>;
}

export function ResetPassword() {
 const token = parseHash().query.token ?? '';
 const [f, setF] = useState({password: '', confirm: '', code: ''});
 const [error, setError] = useState('');
 const [done, setDone] = useState(false);
 const submit = async (e: React.FormEvent) => {
  e.preventDefault(); setError('');
  try { await api('reset.complete', {token, ...f}); setDone(true); } catch (err: any) { setError(err.message); }
 };
 return <Card title="Reset Password">
  <form onSubmit={submit}>
   {done ? <p>Your password has been changed. <a href="#/" style={{color: '#2a6fdb'}}>Sign in</a></p> : <>
    <label htmlFor="np">New password</label><input id="np" type="password" value={f.password} onChange={e => setF({...f, password: e.target.value})} autoComplete="new-password" required autoFocus/>
    <label htmlFor="np2">Enter it again</label><input id="np2" type="password" value={f.confirm} onChange={e => setF({...f, confirm: e.target.value})} autoComplete="new-password" required/>
    <label htmlFor="nc">Authenticator code (administrators only)</label><input id="nc" inputMode="numeric" maxLength={6} value={f.code} onChange={e => setF({...f, code: e.target.value})}/>
    {error && <p style={{color: '#c9302c', margin: '0 0 12px'}}>{error}</p>}
    <button className="btn blue">Set Password</button>
   </>}
  </form>
 </Card>;
}

// Administrators must enrol an authenticator app before using the system.
export function MfaSetup({me, onDone}: {me: Me, onDone: (me: Me) => void}) {
 const [setup, setSetup] = useState<{secret: string, qr: string} | null>(null);
 const [code, setCode] = useState('');
 const [error, setError] = useState('');
 useEffect(() => { if (!me.mfa) api('mfa.setup').then(setSetup).catch(e => setError(e.message)); }, [me.mfa]);
 const submit = async (e: React.FormEvent) => {
  e.preventDefault(); setError('');
  try { const r = await api<Me>('mfa.enable', {code}); toast('Authenticator enabled.'); onDone(r); } catch (err: any) { setError(err.message); }
 };
 if (me.mfa) return <div className="panel"><div className="panel-body">Your authenticator is set up. If you lose your phone, ask your company's administrator to reset it.</div></div>;
 return <div className="login" style={{margin: '40px auto', border: '1px solid #ddd'}}>
  <div className="panel-head blue small">Set Up Authenticator</div>
  <form onSubmit={submit}>
   <p style={{marginTop: 0}}>{me.mfa_required ? 'Administrators must use two-step sign-in. ' : ''}Scan this code with an authenticator app (Google Authenticator, Microsoft Authenticator, or the one in WeChat/Alipay security settings), then enter the 6-digit code it shows.</p>
   {setup && <div style={{textAlign: 'center'}}><img src={setup.qr} alt="Authenticator QR code" width={200} height={200}/><div className="muted" style={{fontSize: 12, wordBreak: 'break-all'}}>Key: {setup.secret}</div></div>}
   <label htmlFor="mc">Code</label><input id="mc" inputMode="numeric" maxLength={6} value={code} onChange={e => setCode(e.target.value)} required autoFocus/>
   {error && <p style={{color: '#c9302c', margin: '0 0 12px'}}>{error}</p>}
   <button className="btn blue">Enable</button>
  </form>
 </div>;
}
