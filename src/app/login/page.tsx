'use client';
import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTheme } from '@/components/ThemeProvider';

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const { setPrefs } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(params.get('error') || '');
  const [loading, setLoading] = useState(false);
  const [okta, setOkta] = useState(false);

  useEffect(() => {
    fetch('/api/auth/providers').then((r) => r.json()).then((r) => setOkta(!!r.okta)).catch(() => {});
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || 'Login gagal');
      if (j.preferences) setPrefs(j.preferences, false);
      router.push(params.get('next') || '/dashboard');
      router.refresh();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-wrap">
      <div className="login-card">
        <div className="login-head">
          <div className="brand-logo" />
          <h2 style={{ fontSize: 20 }}>Identity Governance</h2>
          <p className="muted" style={{ margin: '6px 0 0' }}>Masuk ke IGA Platform (Okta integrated)</p>
        </div>
        <form className="login-body" onSubmit={submit}>
          {error && <div className="callout danger small">{error}</div>}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="pw">Password</label>
            <input id="pw" className="input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </div>
          <button className="btn btn-primary" style={{ width: '100%', height: 40 }} disabled={loading}>
            {loading ? 'Memproses…' : 'Sign in'}
          </button>
          {okta && (
            <>
              <div className="divider">atau</div>
              <a className="btn btn-secondary" style={{ width: '100%', height: 40 }} href="/api/auth/okta/login">
                <span className="brand-logo" style={{ width: 18, height: 18 }} /> Sign in with Okta
              </a>
            </>
          )}
          <p className="small muted" style={{ textAlign: 'center', margin: 0 }}>
            Admin awal diatur via <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code> di .env
          </p>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
