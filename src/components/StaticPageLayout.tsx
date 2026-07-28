import type { ReactNode } from 'react';
import { useI18nStore } from '../store/i18nStore';

interface Props {
  title: string;
  lastUpdated?: string;
  onBack: () => void;
  children: ReactNode;
}

/**
 * Shared chrome for standalone content pages (Privacy Policy, Terms of
 * Service, Help Center). Mirrors AuthScreen/UpgradeScreen's pattern of
 * being a plain state-toggled view rather than a routed page, since this
 * app doesn't use react-router.
 */
export function StaticPageLayout({ title, lastUpdated, onBack, children }: Props) {
  const t = useI18nStore((s) => s.t);

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f0f4ff 0%, #f0f2f5 50%, #f5f0f8 100%)',
      fontFamily: 'var(--font-family)',
      overflowY: 'auto',
    }}>
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1.5px solid var(--color-border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        padding: '0 40px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}>
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: 'none',
            background: 'transparent',
            color: 'var(--color-text-secondary)',
            fontSize: 13,
            fontWeight: 500,
            cursor: 'pointer',
            padding: '6px 4px',
          }}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M10 3L5 8L10 13" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div style={{ width: 1, height: 22, background: 'var(--color-border)' }} />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <img src="/logo/PDF.png" alt="" style={{ height: 24, width: 'auto' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--color-text)' }}>{t('app.name')}</span>
        </div>
      </header>

      <div style={{ maxWidth: 760, margin: '0 auto', padding: '48px 28px 100px' }}>
        <div style={{
          background: 'var(--color-surface)',
          border: '1.5px solid var(--color-border)',
          borderRadius: 14,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          padding: '40px 44px',
        }}>
          <h1 style={{ margin: 0, fontSize: 26, fontWeight: 700, color: 'var(--color-text)' }}>{title}</h1>
          {lastUpdated && (
            <p style={{ margin: '8px 0 0', fontSize: 12.5, color: 'var(--color-text-muted)' }}>
              Last updated: {lastUpdated}
            </p>
          )}
          <div style={{ marginTop: 28 }}>{children}</div>
        </div>
      </div>
    </div>
  );
}

export function StaticSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 8px' }}>
        {title}
      </h2>
      <div style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--color-text-secondary)' }}>
        {children}
      </div>
    </section>
  );
}