import { API_BASE } from '../lib/api';
import { getDeviceId } from '../lib/deviceId';

interface LoginDialogProps {
  onClose: () => void;
}

function googleAuthUrl(): string {
  const deviceId = getDeviceId();
  const params = new URLSearchParams(deviceId ? { deviceId } : {});
  const query = params.toString();
  return `${API_BASE}/api/auth/google${query ? `?${query}` : ''}`;
}

export function LoginDialog({ onClose }: LoginDialogProps) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <h3>Sign in</h3>

        <p style={{ color: 'var(--color-text-secondary)', fontSize: 14, marginBottom: 16 }}>
          Sync your google account to livePDF
        </p>

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
            marginBottom: 16,
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
            <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.91c1.7-1.57 2.69-3.88 2.69-6.62z" />
            <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.91-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z" />
            <path fill="#FBBC05" d="M3.97 10.72A5.4 5.4 0 0 1 3.68 9c0-.6.1-1.18.29-1.72V4.95H.96A9 9 0 0 0 0 9c0 1.45.35 2.83.96 4.05l3.01-2.33z" />
            <path fill="#EA4335" d="M9 3.58c1.32 0 2.51.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z" />
          </svg>
          Continue with Google
        </a>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}