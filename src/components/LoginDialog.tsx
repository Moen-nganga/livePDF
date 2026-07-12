import { useState } from 'react';
import { useAuthStore } from '../store/authStore';

interface LoginDialogProps {
  onClose: () => void;
}

export function LoginDialog({ onClose }: LoginDialogProps) {
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
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
        <h3>Sign in</h3>

        {state === 'sent' ? (
          <div>
            <p>Check your email for a sign-in link. It expires in 15 minutes.</p>
            <button className="btn-accent" onClick={onClose}>Done</button>
          </div>
        ) : (
          <form onSubmit={handleSubmit}>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: 14 }}>
              We'll email you a link to sign in — no password needed.
            </p>
            <input
              type="email"
              required
              autoFocus
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ width: '100%', padding: 8, marginTop: 8, marginBottom: 12 }}
            />
            {state === 'error' && (
              <p style={{ color: 'var(--color-error, #dc2626)', fontSize: 13 }}>{error}</p>
            )}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button type="button" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn-accent" disabled={state === 'sending'}>
                {state === 'sending' ? 'Sending…' : 'Send link'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}