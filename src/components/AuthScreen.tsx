import { useEffect, useState } from 'react';
import { useAuthStore } from '../store/authStore';
import { useI18nStore } from '../store/i18nStore';
import { API_BASE } from '../lib/api';
import { getDeviceId } from '../lib/deviceId';

interface Props {
  onBack: () => void;
}

// Builds the URL that kicks off the Google OAuth redirect flow. This is a
// full-page navigation (plain <a href>), not a fetch call -- the browser
// needs to actually leave the app and land on Google's consent screen,
// then get redirected back to our own backend's /callback route, which
// finishes by redirecting into the app with the session cookie already set.
function googleAuthUrl(): string {
  const deviceId = getDeviceId();
  const params = new URLSearchParams(deviceId ? { deviceId } : {});
  const query = params.toString();
  return `${API_BASE}/api/auth/google${query ? `?${query}` : ''}`;
}

export function AuthScreen({ onBack }: Props) {
  const requestMagicLink = useAuthStore((s) => s.requestMagicLink);
  const t = useI18nStore((s) => s.t);
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  // Google redirects back to `${APP_URL}/?authError=...` on failure (denied
  // consent, unverified email, misconfiguration). Surface that here, then
  // strip it from the URL so a refresh doesn't re-show the same error.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    if (!authError) return;

    setState('error');
    setError(
      authError === 'google_unverified'
        ? t('auth.googleUnverified')
        : t('auth.googleError')
    );
    params.delete('authError');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, [t]);

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
          <img src="/logo/PDF.png" alt="livePDF" style={{ height: 44, width: 'auto' }} />
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>
            {t('app.name')}
          </div>
        </div>

        {state === 'sent' ? (
          <div>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
              {t('auth.checkEmailTitle')}
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: 24 }}>
              {t('auth.checkEmailBody', { email })}
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
              {t('auth.back')}
            </button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
              {t('auth.signIn')}
            </div>
            <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
              {t('auth.subtitle')}
            </p>

            {state === 'error' && (
              <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12 }}>{error}</p>
            )}

            <a
              href={googleAuthUrl()}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '10px 0',
                borderRadius: 8,
                border: '1.5px solid var(--color-border)',
                background: 'white',
                color: 'var(--color-text)',
                fontSize: 14,
                fontWeight: 500,
                textDecoration: 'none',
                boxSizing: 'border-box',
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
                <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
                <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
                <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
                <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
              </svg>
              {t('auth.continueWithGoogle')}
            </a>

            <div style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              margin: '20px 0',
              color: 'var(--color-text-muted)',
              fontSize: 12,
            }}>
              <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
              {t('auth.or')}
              <div style={{ flex: 1, height: 1, background: 'var(--color-border)' }} />
            </div>

            <form onSubmit={handleSubmit}>
              <label style={{ fontSize: 12, fontWeight: 500, color: 'var(--color-text-secondary)' }}>
                {t('auth.emailLabel')}
              </label>
              <input
                type="email"
                required
                autoFocus
                placeholder={t('auth.emailPlaceholder')}
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
                {state === 'sending' ? t('auth.sending') : t('auth.sendLink')}
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
                {t('auth.back')}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}