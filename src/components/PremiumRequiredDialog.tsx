interface Props {
  featureName: string;
  onUpgrade: () => void;
  onClose: () => void;
}

export function PremiumRequiredDialog({ featureName, onUpgrade, onClose }: Props) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 28, width: 360, textAlign: 'center' }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>⭐</div>
        <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Premium feature</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
          {featureName} is available on Pro Monthly and Pro Yearly plans.
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
          <button onClick={onClose}>Not now</button>
          <button className="btn-accent" onClick={onUpgrade}>
            Upgrade
          </button>
        </div>
      </div>
    </div>
  );
}