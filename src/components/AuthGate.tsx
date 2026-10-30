import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, Leaf, LoaderCircle, LockKeyhole } from 'lucide-react';
import { configurationError, isCloudMode, ownerEmail, ownerId, supabase } from '../lib/supabase';
import './auth-gate.css';

const LibraryAuthContext = createContext<{ authEnabled: boolean; lockLibrary: () => Promise<void> }>({
  authEnabled: false,
  lockLibrary: async () => {},
});

export function useLibraryAuth() {
  return useContext(LibraryAuthContext);
}

export default function AuthGate({ children }: { children: ReactNode }) {
  const [checking, setChecking] = useState(isCloudMode);
  const [unlocked, setUnlocked] = useState(false);
  const [code, setCode] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [invalidSession, setInvalidSession] = useState(false);
  const [lockFailed, setLockFailed] = useState(false);
  const locked = useRef(false);
  const authRevision = useRef(0);
  const unavailable = isCloudMode && (!!configurationError || !supabase);

  function errorMessage(cause: unknown) {
    const failure = cause as { status?: number; code?: string; message?: string } | null;
    if (failure?.status === 429 || failure?.code?.includes('rate_limit')) return 'Too many attempts. Please wait a little before trying again.';
    if (failure?.status === 0 || (failure?.status ?? 0) >= 500 || /fetch|network|connection|timeout/i.test(failure?.message ?? '')) return 'We couldn’t connect to your library. Check your connection and try again.';
    if (failure?.status === 400 || failure?.status === 401 || failure?.code === 'invalid_credentials') return 'That code didn’t unlock your library. Please try again.';
    return 'Your library couldn’t be unlocked right now. Please try again.';
  }

  useEffect(() => {
    if (!isCloudMode || !supabase || unavailable) return;
    const client = supabase;
    let active = true;
    const revision = authRevision.current;
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      authRevision.current += 1;
      const valid = !!session && session.user.id === ownerId && session.user.email?.toLowerCase() === ownerEmail.toLowerCase();
      setUnlocked(valid && !locked.current);
      setInvalidSession(!!session && !valid);
      setChecking(false);
      if (valid && !locked.current) setCode('');
    });
    void client.auth.getSession().then(({ data, error: sessionError }) => {
      if (!active || revision !== authRevision.current) return;
      const session = data.session;
      const valid = !sessionError && !!session && session.user.id === ownerId && session.user.email?.toLowerCase() === ownerEmail.toLowerCase();
      setUnlocked(valid && !locked.current);
      setInvalidSession(!!session && !valid);
      setChecking(false);
      if (sessionError) setError(errorMessage(sessionError));
    }).catch(cause => {
      if (!active || revision !== authRevision.current) return;
      setChecking(false);
      setError(errorMessage(cause));
    });
    return () => { active = false; subscription.unsubscribe(); };
  }, [unavailable]);

  useEffect(() => {
    if (!invalidSession || !supabase) return;
    locked.current = true;
    setUnlocked(false);
    setPending(true);
    setError('That code didn’t unlock your library. Please try again.');
    void supabase.auth.signOut({ scope: 'local' }).then(({ error: signOutError }) => {
      if (signOutError) {
        setLockFailed(true);
        setError('Your library is hidden, but this device couldn’t finish signing out. Please retry locking.');
      } else setLockFailed(false);
    }).catch(() => {
      setLockFailed(true);
      setError('Your library is hidden, but this device couldn’t finish signing out. Please retry locking.');
    }).finally(() => setPending(false));
  }, [invalidSession]);

  async function lockLibrary() {
    if (!isCloudMode || !supabase) return;
    locked.current = true;
    authRevision.current += 1;
    setUnlocked(false);
    setCode('');
    setRevealed(false);
    setPending(true);
    setError('');
    try {
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) throw signOutError;
      setLockFailed(false);
      setInvalidSession(false);
    } catch {
      setLockFailed(true);
      setError('Your library is hidden, but this device couldn’t finish signing out. Please retry locking.');
    } finally {
      setPending(false);
    }
  }

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || pending || !code || lockFailed) return;
    setPending(true);
    setError('');
    // Only a completed, owner-validated sign-in may reopen a manually locked library.
    locked.current = true;
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({ email: ownerEmail, password: code });
      if (signInError) throw signInError;
      if (!data.session || data.user?.id !== ownerId || data.user.email?.toLowerCase() !== ownerEmail.toLowerCase()) {
        setUnlocked(false);
        setInvalidSession(true);
        setError('That code didn’t unlock your library. Please try again.');
        return;
      }
      locked.current = false;
      setInvalidSession(false);
      setCode('');
      setRevealed(false);
      setUnlocked(true);
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  if (!isCloudMode || unlocked) {
    return <LibraryAuthContext.Provider value={{ authEnabled: isCloudMode, lockLibrary }}>{children}</LibraryAuthContext.Provider>;
  }

  return (
    <div className="auth-shell">
      <header className="auth-header"><a className="wordmark" href="./" aria-label="Leafmark home"><span className="brand-icon"><Leaf size={23} strokeWidth={1.7} aria-hidden="true" /></span>Leafmark</a><span className="auth-private"><LockKeyhole size={13} aria-hidden="true" />Private library</span></header>
      <main className="auth-main" id="main-content">
        <section className="auth-card" aria-labelledby="auth-title" aria-busy={!unavailable && (checking || pending)}>
          <span className="auth-emblem" aria-hidden="true"><Leaf size={36} strokeWidth={1.1} /></span>
          <p className="eyebrow">A little space to read</p>
          <h1 id="auth-title">Your library<span className="heading-period">.</span></h1>
          {unavailable ? <><p className="auth-copy">Your library isn’t ready to open.</p><p className="auth-note" role="status">Setup is unavailable. Please check the library configuration and try again.</p></> : checking ? <p className="auth-checking" role="status"><LoaderCircle size={17} className="spin" aria-hidden="true" />Opening your library…</p> : <>
            <p className="auth-copy">Enter your code. Settle into a good book.</p>
            <form className="auth-form" onSubmit={unlock}>
              <label htmlFor="library-code">Library code</label>
              <div className="auth-code-field"><input id="library-code" name="library-code" type={revealed ? 'text' : 'password'} autoComplete="current-password" autoCapitalize="none" spellCheck={false} autoFocus required value={code} disabled={pending || lockFailed} onChange={event => setCode(event.target.value)} aria-describedby={error ? 'auth-error' : 'auth-remember'} aria-invalid={!!error && !lockFailed} /><button type="button" className="icon-button" aria-label={revealed ? 'Hide code' : 'Show code'} aria-pressed={revealed} disabled={pending || lockFailed} onClick={() => setRevealed(value => !value)}>{revealed ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}</button></div>
              {error && <p className="auth-error" id="auth-error" role="alert">{error}</p>}
              {lockFailed ? <button className="button button-primary auth-submit" type="button" disabled={pending} onClick={() => void lockLibrary()}>{pending ? 'Locking…' : 'Retry locking'}</button> : <button className="button button-primary auth-submit" type="submit" disabled={pending || !code}>{pending ? <LoaderCircle className="spin" size={17} aria-hidden="true" /> : null}{pending ? 'Unlocking…' : 'Unlock library'}{!pending && <ArrowRight size={16} aria-hidden="true" />}</button>}
            </form>
            <p className="auth-note" id="auth-remember">Your library stays unlocked on this device.<br />Lock it whenever you’re done.</p>
          </>}
        </section>
      </main>
      <footer className="auth-footer">A page at a time.</footer>
    </div>
  );
}
