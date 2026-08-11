import { useEffect, useState } from 'react';
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
  const t = useI18nStore((s) => s.t);
  const [error, setError] = useState('');

  // Google redirects back to `${APP_URL}/?authError=...` on failure (denied
  // consent, unverified email, misconfiguration). Surface that here, then
  // strip it from the URL so a refresh doesn't re-show the same error.
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
    <div
      style={{
        minHeight: '100vh',
        background: '#F1ECE2',
        backgroundImage:
          'radial-gradient(circle, rgba(32,29,25,0.06) 1px, transparent 1px)',
        backgroundSize: '20px 20px',
        fontFamily: 'var(--font-family)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Rubik:ital,wght@0,400;0,500;0,600;0,700;1,600;1,700&display=swap');
        .authGoogleBtn:hover {
          border-color: #C7BFA9 !important;
          box-shadow: 0 3px 10px rgba(32,29,25,0.10);
          transform: translateY(-1px);
        }
        .authBackLink:hover {
          color: #201D19 !important;
        }
      `}</style>

      {/* Stack of two faded "pages" fanned behind the card -- a nod to
          livePDF's actual subject matter instead of a generic blurred blob. */}
      <div style={{ position: 'relative', width: '100%', maxWidth: 400 }}>
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: '#FAF7F1',
            border: '1.5px solid #E6E0D2',
            borderRadius: 16,
            transform: 'rotate(-4deg) translateY(6px)',
          }}
        />
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            inset: 0,
            background: '#FDFBF7',
            border: '1.5px solid #E6E0D2',
            borderRadius: 16,
            transform: 'rotate(3deg) translateY(3px)',
          }}
        />

        <div
          style={{
            position: 'relative',
            background: '#FFFFFF',
            border: '1.5px solid #E6E0D2',
            borderRadius: 16,
            boxShadow: '0 20px 40px -12px rgba(32,29,25,0.18)',
            padding: '40px 32px 32px',
          }}
        >
          {/* Logo, matches LandingScreen's header mark */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 32 }}>
            <img src="/logo/PDF.png" alt="livePDF" style={{ height: 40, width: 'auto' }} />
            <div
              style={{
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '0.09em',
                textTransform: 'uppercase',
                color: '#9A9382',
              }}
            >
              {t('app.tagline')}
            </div>
          </div>

          <div
            style={{
              fontFamily: "'Rubik', var(--font-family), sans-serif",
              fontSize: 24,
              fontWeight: 700,
              color: '#201D19',
              marginBottom: 10,
              lineHeight: 1.3,
            }}
          >
            Sign in with Google to access your account
          </div>
          <div
            style={{
              width: 36,
              height: 3,
              borderRadius: 2,
              background: '#E2472F',
              marginBottom: 24,
            }}
          />

          {error && (
            <p
              style={{
                color: '#C13823',
                background: '#FBEAE6',
                border: '1px solid #F3CFC7',
                borderRadius: 8,
                padding: '8px 12px',
                fontSize: 13,
                marginBottom: 16,
              }}
            >
              {error}
            </p>
          )}

          <a
            href={googleAuthUrl()}
            className="authGoogleBtn"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              padding: '12px 0',
              borderRadius: 10,
              border: '1.5px solid #E6E0D2',
              background: 'white',
              color: '#201D19',
              fontSize: 14,
              fontWeight: 600,
              textDecoration: 'none',
              boxSizing: 'border-box',
              transition: 'box-shadow 0.15s ease, transform 0.15s ease, border-color 0.15s ease',
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
            className="authBackLink"
            style={{
              display: 'block',
              width: '100%',
              padding: '10px 0 0',
              marginTop: 20,
              borderRadius: 8,
              border: 'none',
              background: 'transparent',
              color: '#9A9382',
              fontSize: 13,
              fontWeight: 500,
              cursor: 'pointer',
              transition: 'color 0.15s ease',
            }}
          >
            {t('auth.back')}
          </button>
        </div>
      </div>
    </div>
  );
}