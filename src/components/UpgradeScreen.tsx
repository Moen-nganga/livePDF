interface Props {
  onBack: () => void;
}

// Placeholder for now — real Stripe + crypto checkout wiring is the next
// piece of work (see FEATURE_FLAGS / subscriptions table already in
// types/subscription.ts and server/src/db.ts). This just establishes the
// full-page slot and matches the visual language of AuthScreen/LandingScreen
// so swapping in real plan cards + checkout buttons later is a drop-in.
export function UpgradeScreen({ onBack }: Props) {
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
        maxWidth: 480,
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-border)',
        borderRadius: 14,
        boxShadow: '0 4px 24px rgba(0,0,0,0.08)',
        padding: '40px 36px',
        textAlign: 'center',
      }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>⭐</div>
        <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--color-text)', marginBottom: 8 }}>
          Premium plan
        </div>
        <p style={{ fontSize: 14, color: 'var(--color-text-muted)', lineHeight: 1.5, marginBottom: 28 }}>
          Checkout isn't live yet — pricing and payment (Stripe and crypto) are coming soon.
        </p>
        <button
          onClick={onBack}
          style={{
            padding: '10px 24px',
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