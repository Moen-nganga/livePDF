import { useEffect, useState } from 'react';
import { useI18nStore } from '../store/i18nStore';
import { API_BASE } from '../lib/api';
import { getDeviceId } from '../lib/deviceId';

interface Props {
  onBack: () => void;
}

function googleAuthUrl(): string {
  const deviceId = getDeviceId();
  const params = new URLSearchParams(deviceId ? { deviceId } : {});
  const query = params.toString();
  return `${API_BASE}/api/auth/google${query ? `?${query}` : ''}`;
}

export function AuthScreen({ onBack }: Props) {
  const t = useI18nStore((s) => s.t);
  const [error, setError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('authError');
    if (!authError) return;

    setError(
      authError === 'google_unverified'
        ? t('auth.googleUnverified')
        : t('auth.googleError')
    );
    params.delete('authError');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
  }, [t]);

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

        <div style={{ fontSize: 18, fontWeight: 600, color: 'var(--color-text)', marginBottom: 8 }}>
          {t('auth.signIn')}
        </div>
        <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 20, lineHeight: 1.5 }}>
          Sync your google account to livePDF
        </p>

        {error && (
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
            marginBottom: 20,
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
      </div>
    </div>
  );
}