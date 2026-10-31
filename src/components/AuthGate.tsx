import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { ArrowRight, Eye, EyeOff, Leaf, LoaderCircle, LockKeyhole } from 'lucide-react';
import { configurationError, isCloudMode, ownerEmail, ownerId, supabase } from '../lib/supabase';
import Brand from '@/components/Brand';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

const LibraryAuthContext = createContext<{
  authEnabled: boolean;
  lockLibrary: () => Promise<void>;
}>({
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
    if (failure?.status === 429 || failure?.code?.includes('rate_limit'))
      return 'Too many attempts. Please wait a little before trying again.';
    if (
      failure?.status === 0 ||
      (failure?.status ?? 0) >= 500 ||
      /fetch|network|connection|timeout/i.test(failure?.message ?? '')
    )
      return 'We couldn’t connect to your library. Check your connection and try again.';
    if (
      failure?.status === 400 ||
      failure?.status === 401 ||
      failure?.code === 'invalid_credentials'
    )
      return 'That code didn’t unlock your library. Please try again.';
    return 'Your library couldn’t be unlocked right now. Please try again.';
  }

  useEffect(() => {
    if (!isCloudMode || !supabase || unavailable) return;
    const client = supabase;
    let active = true;
    const revision = authRevision.current;
    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return;
      authRevision.current += 1;
      const valid =
        !!session &&
        session.user.id === ownerId &&
        session.user.email?.toLowerCase() === ownerEmail.toLowerCase();
      setUnlocked(valid && !locked.current);
      setInvalidSession(!!session && !valid);
      setChecking(false);
      if (valid && !locked.current) setCode('');
    });
    void client.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!active || revision !== authRevision.current) return;
        const session = data.session;
        const valid =
          !sessionError &&
          !!session &&
          session.user.id === ownerId &&
          session.user.email?.toLowerCase() === ownerEmail.toLowerCase();
        setUnlocked(valid && !locked.current);
        setInvalidSession(!!session && !valid);
        setChecking(false);
        if (sessionError) setError(errorMessage(sessionError));
      })
      .catch((cause) => {
        if (!active || revision !== authRevision.current) return;
        setChecking(false);
        setError(errorMessage(cause));
      });
    return () => {
      active = false;
      subscription.unsubscribe();
    };
  }, [unavailable]);

  useEffect(() => {
    if (!invalidSession || !supabase) return;
    locked.current = true;
    setUnlocked(false);
    setPending(true);
    setError('That code didn’t unlock your library. Please try again.');
    void supabase.auth
      .signOut({ scope: 'local' })
      .then(({ error: signOutError }) => {
        if (signOutError) {
          setLockFailed(true);
          setError(
            'Your library is hidden, but this device couldn’t finish signing out. Please retry locking.',
          );
        } else setLockFailed(false);
      })
      .catch(() => {
        setLockFailed(true);
        setError(
          'Your library is hidden, but this device couldn’t finish signing out. Please retry locking.',
        );
      })
      .finally(() => setPending(false));
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
      setError(
        'Your library is hidden, but this device couldn’t finish signing out. Please retry locking.',
      );
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
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: ownerEmail,
        password: code,
      });
      if (signInError) throw signInError;
      if (
        !data.session ||
        data.user?.id !== ownerId ||
        data.user.email?.toLowerCase() !== ownerEmail.toLowerCase()
      ) {
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
    return (
      <LibraryAuthContext.Provider value={{ authEnabled: isCloudMode, lockLibrary }}>
        {children}
      </LibraryAuthContext.Provider>
    );
  }

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <header className="mx-auto flex min-h-[104px] w-[min(1200px,calc(100%-96px))] items-center justify-between gap-5 border-b max-[760px]:min-h-[84px] max-[760px]:w-[calc(100%-48px)] max-[520px]:w-[calc(100%-40px)] max-[520px]:gap-3">
        <Brand />
        <span className="inline-flex items-center gap-[7px] text-xs text-[#626e63] max-[520px]:gap-[5px] max-[520px]:text-[10px]">
          <LockKeyhole
            size={13}
            aria-hidden="true"
          />
          Private library
        </span>
      </header>
      <main
        className="grid flex-1 place-items-center px-6 py-16 max-[760px]:py-10 max-[520px]:px-5 max-[520px]:py-8"
        id="main-content"
      >
        <Card
          className="w-full max-w-[420px] gap-0 rounded-xl px-9 pt-10 pb-8 text-center shadow-[0_12px_45px_#283d2905] max-[520px]:px-6 max-[520px]:pt-8 max-[520px]:pb-7"
          role="region"
          aria-labelledby="auth-title"
          aria-busy={!unavailable && (checking || pending)}
        >
          <span
            className="mx-auto mb-7 grid size-[72px] place-items-center rounded-full bg-[#eef3e9] text-[#658266]"
            aria-hidden="true"
          >
            <Leaf
              size={36}
              strokeWidth={1.1}
            />
          </span>
          <p className="mb-3.5 text-[10px] font-semibold tracking-[1.8px] text-[#6c7c6d] uppercase">
            A little space to read
          </p>
          <h1
            id="auth-title"
            className="mb-4 font-serif text-[43px] leading-[1.15] font-normal tracking-[-1.7px] max-[520px]:text-[39px]"
          >
            Your library<span className="text-primary">.</span>
          </h1>
          {unavailable ? (
            <>
              <p className="mb-7 text-[13px] leading-[1.8] text-muted-foreground">
                Your library isn’t ready to open.
              </p>
              <p
                className="mt-[22px] text-[11px] leading-[1.9] text-muted-foreground"
                role="status"
              >
                Setup is unavailable. Please check the library configuration and try again.
              </p>
            </>
          ) : checking ? (
            <p
              className="mt-[25px] mb-2.5 flex items-center justify-center gap-[9px] text-[13px] leading-[1.8] text-muted-foreground"
              role="status"
            >
              <LoaderCircle
                size={17}
                className="animate-spin"
                aria-hidden="true"
              />
              Opening your library…
            </p>
          ) : (
            <>
              <p className="mb-7 text-[13px] leading-[1.8] text-muted-foreground">
                Enter your code. Settle into a good book.
              </p>
              <form
                className="text-left"
                onSubmit={unlock}
              >
                <Label
                  htmlFor="library-code"
                  className="mb-[9px] block text-xs"
                >
                  Library code
                </Label>
                <div className="flex items-center rounded-md border border-input bg-[#fafbf8] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/10">
                  <Input
                    id="library-code"
                    name="library-code"
                    type={revealed ? 'text' : 'password'}
                    autoComplete="current-password"
                    autoCapitalize="none"
                    spellCheck={false}
                    autoFocus
                    required
                    value={code}
                    disabled={pending || lockFailed}
                    onChange={(event) => setCode(event.target.value)}
                    aria-describedby={error ? 'auth-error' : 'auth-remember'}
                    aria-invalid={!!error && !lockFailed}
                    className="h-12 border-0 bg-transparent px-3.5 py-3 text-base shadow-none focus-visible:ring-0 md:text-base"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="mr-[3px] text-muted-foreground"
                    aria-label={revealed ? 'Hide code' : 'Show code'}
                    aria-pressed={revealed}
                    disabled={pending || lockFailed}
                    onClick={() => setRevealed((value) => !value)}
                  >
                    {revealed ? (
                      <EyeOff
                        size={18}
                        aria-hidden="true"
                      />
                    ) : (
                      <Eye
                        size={18}
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                </div>
                {error && (
                  <p
                    className="mt-3 text-xs leading-[1.7] text-destructive"
                    id="auth-error"
                    role="alert"
                  >
                    {error}
                  </p>
                )}
                {lockFailed ? (
                  <Button
                    className="mt-4 min-h-[47px] w-full"
                    type="button"
                    disabled={pending}
                    onClick={() => void lockLibrary()}
                  >
                    {pending ? 'Locking…' : 'Retry locking'}
                  </Button>
                ) : (
                  <Button
                    className="mt-4 min-h-[47px] w-full"
                    type="submit"
                    disabled={pending || !code}
                  >
                    {pending && (
                      <LoaderCircle
                        className="animate-spin"
                        size={17}
                        aria-hidden="true"
                      />
                    )}
                    {pending ? 'Unlocking…' : 'Unlock library'}
                    {!pending && (
                      <ArrowRight
                        size={16}
                        aria-hidden="true"
                      />
                    )}
                  </Button>
                )}
              </form>
              <p
                className="mt-[22px] text-[11px] leading-[1.9] text-muted-foreground"
                id="auth-remember"
              >
                Your library stays unlocked on this device.
                <br />
                Lock it whenever you’re done.
              </p>
            </>
          )}
        </Card>
      </main>
      <footer className="px-6 pb-[30px] text-center text-[11px] text-muted-foreground">
        A page at a time.
      </footer>
    </div>
  );
}
