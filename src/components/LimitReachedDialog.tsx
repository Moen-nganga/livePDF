interface Props {
  message: string;
  onUpgrade: () => void;
  onClose: () => void;
}

export function LimitReachedDialog({ message, onUpgrade, onClose }: Props) {
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
        style={{ padding: 28, width: 380, textAlign: 'center' }}
      >
        <div style={{ fontSize: 32, marginBottom: 12 }}>⭐</div>
        <h3 style={{ margin: '0 0 10px', fontSize: 16 }}>Weekly limit reached</h3>
        <p style={{ fontSize: 13, color: 'var(--color-text-secondary)', lineHeight: 1.5, marginBottom: 20 }}>
          {message}
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