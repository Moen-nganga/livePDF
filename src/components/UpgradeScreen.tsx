import { useState } from 'react';
import { api, type PlanId } from '../lib/api';
import { PLANS } from '../lib/plans';

interface Props {
  onBack: () => void;
}

export function UpgradeScreen({ onBack }: Props) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('pro_monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function checkout() {
    setError('');
    setLoading(true);
    try {
      const url = await api.createStripeCheckout(selectedPlan);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setLoading(false);
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background:
        'radial-gradient(circle at 15% 0%, rgba(179, 18, 42, 0.05) 0%, rgba(179, 18, 42, 0) 45%), ' +
        'radial-gradient(circle at 100% 100%, rgba(179, 18, 42, 0.04) 0%, rgba(179, 18, 42, 0) 50%), ' +
        '#fffdfd',
      fontFamily: 'var(--font-family)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
      overflowY: 'auto',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 880,
        maxHeight: '92vh',
        overflowY: 'auto',
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-border)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-lg)',
        padding: '36px 32px',
        boxSizing: 'border-box',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
            <svg
              width={32}
              height={32}
              viewBox="0 0 24 24"
              fill="var(--color-accent)"
              stroke="var(--color-accent-hover)"
              strokeWidth={1.5}
              strokeLinejoin="round"
            >
              <path d="M12 2.5l2.9 6.06 6.6.77-4.9 4.53 1.28 6.6L12 17.3l-5.88 3.16 1.28-6.6-4.9-4.53 6.6-.77z" />
            </svg>
          </div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)' }}>
            Upgrade to Premium
          </div>
          <p style={{
            fontSize: 13,
            color: 'var(--color-text-muted)',
            marginTop: 6,
            lineHeight: 1.5,
            maxWidth: 480,
            marginLeft: 'auto',
            marginRight: 'auto',
          }}>
            Unlock clean exports, OCR, batch export, spellchecking, more templates,
            unlimited documents, and an AI writing assistant.
          </p>
        </div>

        {/* Plan selector */}
        <div style={{ display: 'flex', gap: 14, marginBottom: 24, flexWrap: 'wrap' }}>
          {PLANS.map((plan) => (
            <button
              key={plan.id}
              onClick={() => setSelectedPlan(plan.id)}
              style={{
                flex: '1 1 260px',
                minWidth: 0,
                boxSizing: 'border-box',
                textAlign: 'left',
                padding: '18px 20px',
                borderRadius: 14,
                border: selectedPlan === plan.id
                  ? '2px solid var(--color-accent)'
                  : '1.5px solid var(--color-border)',
                background: selectedPlan === plan.id ? 'var(--color-accent-bg)' : 'transparent',
                cursor: 'pointer',
                transition: 'border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
                boxShadow: selectedPlan === plan.id ? 'var(--shadow-sm)' : 'none',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text)' }}>
                {plan.label}
              </div>
              <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', marginTop: 4 }}>
                ${plan.priceUsd}
                <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--color-text-muted)' }}>
                  {' '}/ {plan.interval}
                </span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 4, marginBottom: 12, lineHeight: 1.4 }}>
                {plan.tagline}
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {plan.features.map((feature) => (
                  <li
                    key={feature}
                    style={{
                      fontSize: 12,
                      color: 'var(--color-text-secondary)',
                      marginBottom: 7,
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 7,
                      lineHeight: 1.4,
                    }}
                  >
                    <span style={{ color: 'var(--color-accent)', flexShrink: 0 }}>✓</span>
                    <span style={{ overflowWrap: 'break-word', wordBreak: 'break-word', minWidth: 0 }}>
                      {feature}
                    </span>
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>

        {error && (
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>
        )}

        {/* Checkout */}
        <button
          onClick={checkout}
          disabled={loading}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 0',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(180deg, #c41930 0%, var(--color-accent) 100%)',
            color: 'white',
            fontSize: 14,
            fontWeight: 600,
            cursor: loading ? 'default' : 'pointer',
            opacity: loading ? 0.6 : 1,
            marginBottom: 20,
            boxShadow: 'var(--shadow-accent-glow)',
            transition: 'box-shadow 0.15s ease, opacity 0.15s ease',
          }}
        >
          {loading ? 'Redirecting…' : 'Pay with card (Stripe)'}
        </button>

        <button
          onClick={onBack}
          disabled={loading}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px 0',
            borderRadius: 12,
            border: '1.5px solid var(--color-border)',
            background: 'transparent',
            fontSize: 13,
            cursor: 'pointer',
          }}
        >
          ← Back
        </button>
      </div>
    </div>
  );
}