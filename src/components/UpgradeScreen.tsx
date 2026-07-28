import { useState } from 'react';
import { api, type PlanId } from '../lib/api';
import { PLANS } from '../lib/plans';

interface Props {
  onBack: () => void;
}

export function UpgradeScreen({ onBack }: Props) {
  const [selectedPlan, setSelectedPlan] = useState<PlanId>('pro_monthly');
  const [loadingProvider, setLoadingProvider] = useState<'stripe' | 'binance' | null>(null);
  const [error, setError] = useState('');

  async function checkout(provider: 'stripe' | 'binance') {
    setError('');
    setLoadingProvider(provider);
    try {
      const url =
        provider === 'stripe'
          ? await api.createStripeCheckout(selectedPlan)
          : await api.createBinanceCheckout(selectedPlan);
      window.location.href = url;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start checkout');
      setLoadingProvider(null);
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
      overflowY: 'auto',
      boxSizing: 'border-box',
    }}>
      <div style={{
        width: '100%',
        maxWidth: 760,
        maxHeight: '92vh',
        overflowY: 'auto',
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-border)',
        borderRadius: 14,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '36px 32px',
        boxSizing: 'border-box',
      }}>
        <div style={{ textAlign: 'center', marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⭐</div>
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
                minWidth: 240,
                boxSizing: 'border-box',
                textAlign: 'left',
                padding: '18px 20px',
                borderRadius: 10,
                border: selectedPlan === plan.id ? '2px solid #1a73e8' : '1.5px solid var(--color-border)',
                background: selectedPlan === plan.id ? '#f0f6ff' : 'transparent',
                cursor: 'pointer',
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
                    <span style={{ color: '#1a73e8', flexShrink: 0 }}>✓</span>
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
          <p style={{ color: '#dc2626', fontSize: 13, marginBottom: 12, textAlign: 'center' }}>{error}</p>
        )}

        {/* Checkout buttons */}
        <button
          onClick={() => checkout('stripe')}
          disabled={loadingProvider !== null}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 0',
            borderRadius: 8,
            border: 'none',
            background: '#1a73e8',
            color: 'white',
            fontSize: 14,
            fontWeight: 600,
            cursor: loadingProvider ? 'default' : 'pointer',
            opacity: loadingProvider && loadingProvider !== 'stripe' ? 0.6 : 1,
            marginBottom: 10,
          }}
        >
          {loadingProvider === 'stripe' ? 'Redirecting…' : 'Pay with card (Stripe)'}
        </button>

        <button
          onClick={() => checkout('binance')}
          disabled={loadingProvider !== null}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '12px 0',
            borderRadius: 8,
            border: '1.5px solid #f0b90b',
            background: 'transparent',
            color: '#8a6d00',
            fontSize: 14,
            fontWeight: 600,
            cursor: loadingProvider ? 'default' : 'pointer',
            opacity: loadingProvider && loadingProvider !== 'binance' ? 0.6 : 1,
            marginBottom: 20,
          }}
        >
          {loadingProvider === 'binance' ? 'Redirecting…' : 'Pay with crypto (Binance Pay)'}
        </button>

        <button
          onClick={onBack}
          disabled={loadingProvider !== null}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            padding: '10px 0',
            borderRadius: 8,
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