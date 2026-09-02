interface Props {
  /** True once the poll in LandingScreen actually observed isPremium() flip to true;
   *  false if it timed out waiting and the badge may still say Free plan for a bit. */
  success: boolean;
  onClose: () => void;
}

export function UpgradeStatusDialog({ success, onClose }: Props) {
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
        padding: 16,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="surface-card"
        onClick={(e) => e.stopPropagation()}
        style={{ padding: 28, width: 'min(380px, 92vw)', textAlign: 'center', boxSizing: 'border-box' }}
      >
        <div
          style={{
            width: 52,
            height: 52,
            borderRadius: '50%',
            background: success ? '#e6f4ea' : '#fef7e0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            margin: '0 auto 16px',
          }}
        >
          {success ? <CheckIcon /> : <ClockIcon />}
        </div>

        <h3 style={{ margin: '0 0 8px', fontSize: 17, color: 'var(--color-text)' }}>
          {success ? "You're all set!" : 'Payment received'}
        </h3>

        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>
          {success
            ? 'Your Premium plan is now active.'
            : "Your Premium plan should activate within a minute or two. If the badge still says Free plan after that, try refreshing the page."}
        </p>

        <button
          className="btn-accent"
          onClick={onClose}
          style={{ marginTop: 22, padding: '9px 28px', borderRadius: 20 }}
        >
          OK
        </button>
      </div>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="#188038" strokeWidth="1.8" />
      <path d="M7.5 12.5l3 3 6-6.5" stroke="#188038" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="10" stroke="#b06000" strokeWidth="1.8" />
      <path d="M12 7v5l3.5 2" stroke="#b06000" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}