import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useAuthStore } from '../store/authStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useI18nStore } from '../store/i18nStore';
import { LOCALES } from '../lib/i18n/translations';

interface Props {
  onUpgradeClick: () => void;
}

export function AccountMenu({ onUpgradeClick }: Props) {
  const authUser = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const subscription = useSubscriptionStore((s) => s.subscription);
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const locale = useI18nStore((s) => s.locale);
  const setLocale = useI18nStore((s) => s.setLocale);
  const t = useI18nStore((s) => s.t);

  const [open, setOpen] = useState(false);
  const [languageMenuOpen, setLanguageMenuOpen] = useState(false);
  const [langFlyoutPos, setLangFlyoutPos] = useState<{ top: number; left: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const langButtonRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetchSubscription();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close on outside click — standard dropdown behavior.
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setLanguageMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!authUser) return null;

  const initial = authUser.email.charAt(0).toUpperCase();
  const displayName = authUser.email.split('@')[0];
  const planId = subscription?.planId ?? 'free';

  function handleSelectLanguage(code: (typeof LOCALES)[number]['code']) {
    setLocale(code);
    setLanguageMenuOpen(false);
    setOpen(false);
  }

  return (
    <div ref={containerRef} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 10px 4px 4px',
          borderRadius: 20,
          border: '1.5px solid var(--color-border)',
          background: open ? '#f8faff' : 'transparent',
          cursor: 'pointer',
        }}
      >
        <div style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          background: '#1a73e8',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}>
          {initial}
        </div>
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.2 }}>
            {displayName}
          </div>
          <div style={{ fontSize: 11, color: 'var(--color-text-muted)', lineHeight: 1.2 }}>
            {t(`plan.${planId}`)}
          </div>
        </div>
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: 'calc(100% + 8px)',
          right: 0,
          minWidth: 220,
          background: 'var(--color-surface)',
          border: '1.5px solid var(--color-border)',
          borderRadius: 10,
          boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
          overflow: 'hidden',
          zIndex: 30,
        }}>
          {/* Language item, expands a flyout submenu positioned via measured coordinates */}
          <div ref={langButtonRef} style={{ position: 'relative' }}>
            <MenuItem
              icon={<GlobeIcon />}
              label={t('menu.language')}
              trailing={LOCALES.find((l) => l.code === locale)?.label}
              onClick={() => {
                const FLYOUT_WIDTH = 160;
                const GAP = 8;
                if (!languageMenuOpen && langButtonRef.current) {
                  const rect = langButtonRef.current.getBoundingClientRect();
                  const spaceOnLeft = rect.left;
                  // Prefer opening to the left (per the requested design), but
                  // fall back to the right if the window is too narrow for
                  // the flyout to fit on the left without going off-screen.
                  const left =
                    spaceOnLeft >= FLYOUT_WIDTH + GAP
                      ? rect.left - FLYOUT_WIDTH - GAP
                      : Math.min(rect.right + GAP, window.innerWidth - FLYOUT_WIDTH - GAP);
                  setLangFlyoutPos({ top: rect.top, left: Math.max(GAP, left) });
                }
                setLanguageMenuOpen((v) => !v);
              }}
            />
            {languageMenuOpen && langFlyoutPos && (
              <div style={{
                position: 'fixed',
                top: langFlyoutPos.top,
                left: langFlyoutPos.left,
                width: 160,
                background: 'var(--color-surface)',
                border: '1.5px solid var(--color-border)',
                borderRadius: 10,
                boxShadow: '0 4px 20px rgba(0,0,0,0.12)',
                overflow: 'hidden',
                zIndex: 31,
              }}>
                {LOCALES.map((l) => (
                  <button
                    key={l.code}
                    onClick={() => handleSelectLanguage(l.code)}
                    style={{
                      display: 'flex',
                      width: '100%',
                      padding: '9px 16px',
                      fontSize: 13,
                      textAlign: 'left',
                      background: l.code === locale ? '#e8f0fe' : 'transparent',
                      color: l.code === locale ? '#1a73e8' : 'var(--color-text)',
                      cursor: 'pointer',
                    }}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <MenuItem
            icon={<StarIcon />}
            label={t('menu.premiumPlan')}
            onClick={() => {
              setOpen(false);
              onUpgradeClick();
            }}
          />

          <a
            href="/legal/help.html"
            target="_blank"
            rel="noopener noreferrer"
            style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            onClick={() => setOpen(false)}
          >
            <MenuItem icon={<HelpIcon />} label={t('menu.help')} />
          </a>

          <div style={{ borderTop: '1px solid var(--color-border)' }}>
            <MenuItem
              icon={<SignOutIcon />}
              label={t('menu.signOut')}
              onClick={() => {
                setOpen(false);
                logout();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M3 12h18M12 3c2.5 2.6 4 5.9 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.9-4-9s1.5-6.4 4-9z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function StarIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M12 3.5l2.6 5.4 5.9.8-4.3 4.2 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.2 5.9-.8L12 3.5z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
        fill="#f5a623"
      />
    </svg>
  );
}

function HelpIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M9.5 9.3a2.5 2.5 0 1 1 3.7 2.2c-.9.5-1.2.9-1.2 1.8"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="16.8" r="0.9" fill="currentColor" />
    </svg>
  );
}

function SignOutIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M15 4H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h7M12 12h9m0 0-3.5-3.5M21 12l-3.5 3.5"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MenuItem({
  icon,
  label,
  trailing,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  trailing?: string;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: '100%',
        padding: '10px 16px',
        fontSize: 13,
        textAlign: 'left',
        background: 'transparent',
        cursor: 'pointer',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 16, color: 'var(--color-text-secondary)' }}>
        {icon}
      </span>
      <span style={{ flex: 1, color: 'var(--color-text)' }}>{label}</span>
      {trailing && (
        <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{trailing}</span>
      )}
    </button>
  );
}