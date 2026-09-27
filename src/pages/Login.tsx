import React, { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ThemeToggle } from '@/components/ThemeToggle';
import { authErrorMessage, useAuth } from '@/contexts/AuthContext';

const GoogleIcon = () => (
  <svg viewBox="0 0 48 48" className="w-4 h-4" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** Sign in / create account with email + password or Google (Firebase Authentication). */
export const Login: React.FC = () => {
  const { enabled, user, loading, signInEmail, signUpEmail, signInGoogle, resetPassword } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const rawNext = new URLSearchParams(location.search).get('next') || '/resumes';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/resumes';
  const [mode, setMode] = useState<'signin' | 'signup' | 'reset'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!enabled) return <Navigate to="/builder" replace />;
  if (!loading && user) return <Navigate to={next} replace />;

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(authErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'reset') {
      run(async () => {
        await resetPassword(email.trim());
        setInfo('If an account exists for this email, a password-reset link is on its way.');
      });
    } else if (mode === 'signup') run(() => signUpEmail(name, email.trim(), password).then(() => navigate(next)));
    else run(() => signInEmail(email.trim(), password).then(() => navigate(next)));
  };

  return (
    <div className="min-h-screen bg-muted/30 flex flex-col">
      <header className="mx-auto flex w-full max-w-4xl items-center gap-2 px-4 py-4">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <span className="w-8 h-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </span>
          AI Career Assistant
        </Link>
        <div className="ml-auto">
          <ThemeToggle compact />
        </div>
      </header>
      <main className="flex-1 flex items-start justify-center px-4 pt-6 pb-12">
        <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-sm space-y-5">
          <div>
            <h1 className="text-xl font-bold">{mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : 'Sign in'}</h1>
            <p className="text-sm text-muted-foreground mt-1">Your resumes are saved to your account and available on any device.</p>
          </div>

          {mode !== 'reset' && (
            <>
              <Button type="button" variant="outline" className="w-full" disabled={busy} onClick={() => run(() => signInGoogle().then(() => navigate(next)))}>
                <GoogleIcon />
                <span className="ml-2">Continue with Google</span>
              </Button>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <div className="h-px flex-1 bg-border" /> or with email <div className="h-px flex-1 bg-border" />
              </div>
            </>
          )}

          <form className="space-y-3" onSubmit={submit}>
            {mode === 'signup' && (
              <div className="space-y-1.5">
                <Label htmlFor="name">Name</Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
              </div>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            </div>
            {mode !== 'reset' && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">Password</Label>
                  {mode === 'signin' && (
                    <button type="button" className="text-xs text-primary hover:underline" onClick={() => setMode('reset')}>
                      Forgot password?
                    </button>
                  )}
                </div>
                <Input id="password" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} />
              </div>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {info && (
              <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">
                {info}
              </p>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy && <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />}
              {mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset link' : 'Sign in'}
            </Button>
          </form>

          <p className="text-sm text-center text-muted-foreground">
            {mode === 'signin' ? (
              <>
                New here?{' '}
                <button type="button" className="text-primary hover:underline" onClick={() => setMode('signup')}>
                  Create an account
                </button>
              </>
            ) : (
              <button type="button" className="text-primary hover:underline" onClick={() => setMode('signin')}>
                Back to sign in
              </button>
            )}
          </p>
        </div>
      </main>
    </div>
  );
};
