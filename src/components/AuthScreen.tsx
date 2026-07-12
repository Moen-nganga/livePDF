import { useState } from 'react';
import { useAuthStore } from '../store/authStore';

interface Props {
  onBack: () => void;
}

export function AuthScreen({ onBack }: Props) {
  const requestMagicLink = useAuthStore((s) => s.requestMagicLink);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setState('sending');
    const result = await requestMagicLink(email.trim());
    if (result.ok) {
      setState('sent');
    } else {
      setState('error');
      setError(result.error ?? 'Something went wrong');
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f0f4ff 0%, #f0f2f5 50%, #f5f0f8 100%)',
      fontFamily: 'var(--font-family)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        width: '100%',
        maxWidth: 400,
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-border)',
        borderRadius: 14,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '36px 32px',
      }}>
        {/* Logo, matches LandingScreen's header mark */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 28 }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#1a73e8" />
            <rect x="8" y="9" width="16" height="2.2" rx="1.1" fill="white" />
            <rect x="8" y="14" width="16" height="2.2" rx="1.1" fill="white" />
            <rect x="8" y="19" width="11" height="2.2" rx="1.1" fill="white" />
            <rect x="8" y="24" width="7" height="2" rx="1" fill="white" fillOpacity="0.7" />
          </svg>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
            PDF Editor
          </div>
        </div>

        {state === 'sent' ? (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
              Check your email
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
              We sent a sign-in link to <strong>{email}</strong>. It expires in 15 minutes and works once —
              click it to finish signing in.
            </p>
            <button
              onClick={onBack}
              style={{
                fontSize: 13,
                fontWeight: 500,
                padding: '10px 20px',
                borderRadius: 8,
                border: '1.5px solid var(--color-border)',
                background: 'transparent',
                cursor: 'pointer',
                width: '100%',
              }}
            >
              Back
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
              Sign in
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              We'll email you a link to sign in — no password needed.
            </p>

            <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
              Email address
            </label>
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{
                width: '100%',
                padding: '10px 12px',
                marginTop: 6,
                marginBottom: 16,
                borderRadius: 8,
                border: '1.5px solid var(--color-border)',
                fontSize: 14,
                boxSizing: 'border-box',
              }}
            />

            {state === 'error' && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>
            )}

            <button
              type="submit"
              disabled={state === 'sending'}
              style={{
                width: '100%',
                padding: '11px 0',
                borderRadius: 8,
                border: 'none',
                background: 'var(--color-accent, #1a73e8)',
                color: 'white',
                fontSize: 14,
                fontWeight: 600,
                cursor: state === 'sending' ? 'default' : 'pointer',
                opacity: state === 'sending' ? 0.7 : 1,
                marginBottom: 12,
              }}
            >
              {state === 'sending' ? 'Sending…' : 'Send sign-in link'}
            </button>

            <button
              type="button"
              onClick={onBack}
              style={{
                width: '100%',
                padding: '10px 0',
                borderRadius: 8,
                border: 'none',
                background: 'transparent',
                color: 'var(--color-text-muted)',
                fontSize: 13,
                cursor: 'pointer',
              }}
            >
              ← Back
            </button>
          </form>
        )}
      </div>
    </div>
  );
}