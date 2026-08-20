import React, { useEffect, useState, useMemo, useRef } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { useAuthStore } from '../store/authStore';
import { useSubscriptionStore } from '../store/subscriptionStore';
import { useI18nStore } from '../store/i18nStore';
import { TEMPLATES, type TemplateDefinition } from '../lib/templates';
import { api, WeeklyLimitError, type DocumentSummary, type UsageInfo } from '../lib/api';
import { AuthScreen } from './AuthScreen';
import { AccountMenu } from './AccountMenu';
import { UpgradeScreen } from './UpgradeScreen';
import { LimitReachedDialog } from './LimitReachedDialog';
import { PremiumRequiredDialog } from './PremiumRequiredDialog';
import { PrivacyPolicyScreen } from './PrivacyPolicyScreen';
import { TermsOfServiceScreen } from './TermsOfServiceScreen';
import { HelpCenterScreen } from './HelpCenterScreen';
import { AdminScreen } from './AdminScreen';
import { GoogleOneTap } from './GoogleOneTap';

interface Props {
  onEnter: () => void;
}

// Tracks whether the viewport is at or below a "mobile" breakpoint, kept in
// sync via a matchMedia listener rather than measured once on mount --
// covers both phones (fixed width) and desktop windows being resized/
// rotated devices. 640px matches the point at which the fixed-column
// recent-documents table and multi-item header row stop having room to
// breathe.
function useIsMobile(breakpoint = 640): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== 'undefined' && window.innerWidth <= breakpoint
  );

  useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint}px)`);
    const onChange = () => setIsMobile(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}

// This screen's own internal "sub-view" -- Auth, Upgrade, one of the
// static footer pages, or Admin -- layered on top of whatever the landing
// page itself is showing. Tracked in history.state.landingSub (merged into
// the same entry App.tsx already tags with `screen: 'landing'`, rather than
// a separate top-level Screen) so the browser back button steps between
// these sub-views instead of leaving the app, the same fix applied in
// App.tsx for its own Auth/Upgrade toggles.
type LandingSub = 'auth' | 'upgrade' | 'privacy' | 'terms' | 'help' | 'admin' | null;

function pushLandingSub(sub: LandingSub) {
  if ((window.history.state?.landingSub ?? null) === sub) return; // already there
  // Explicitly assert screen: 'landing' here rather than spreading whatever
  // happened to already be in history.state -- a landingSub is only ever
  // pushed while the user is looking at Landing, so this entry should say
  // so regardless of whether some other code path elsewhere left a stale
  // screen value behind. (That's exactly what caused the "stuck on
  // editor.loading after Admin -> Back" bug: a stale screen: 'editor' tag
  // got silently carried forward into this push.)
  window.history.pushState({ ...window.history.state, screen: 'landing', landingSub: sub }, '', window.location.href);
}

export function LandingScreen({ onEnter }: Props) {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const [recent, setRecent] = useState<DocumentSummary[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);
  const isMobile = useIsMobile();

  const authUser = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const subscription = useSubscriptionStore((s) => s.subscription);
  const fetchSubscription = useSubscriptionStore((s) => s.fetchSubscription);
  const t = useI18nStore((s) => s.t);
  const [showAuthScreen, setShowAuthScreen] = useState(false);
  const [showUpgradeScreen, setShowUpgradeScreen] = useState(false);
  const [staticPage, setStaticPage] = useState<'privacy' | 'terms' | 'help' | null>(null);
  const [showAdminScreen, setShowAdminScreen] = useState(false);
  const [limitReachedMessage, setLimitReachedMessage] = useState<string | null>(null);
  const [premiumTemplate, setPremiumTemplate] = useState<TemplateDefinition | null>(null);
  const [moreTemplatesOpen, setMoreTemplatesOpen] = useState(false);

  // Weekly free-tier usage, fetched read-only (no save attempt) so we can
  // gate BOTH creating new documents (already covered by WeeklyLimitError
  // from api.saveDocument) and opening old ones (a pure GET that would
  // otherwise sail right past the limit -- see openRecent below).
  const [usage, setUsage] = useState<UsageInfo | null>(null);

  type RecentSort = 'modified' | 'title';
  const [recentSort, setRecentSort] = useState<RecentSort>('modified');
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const sortMenuRef = useRef<HTMLDivElement>(null);

  const SORT_OPTIONS: { value: RecentSort; label: string }[] = [
    { value: 'modified', label: 'Last modified' },
    { value: 'title', label: 'Title (A–Z)' },
  ];

  const sortedRecent = useMemo(() => {
    const copy = [...recent];
    if (recentSort === 'title') {
      copy.sort((a, b) =>
        (a.title || 'Untitled document').localeCompare(b.title || 'Untitled document')
      );
    } else {
      copy.sort((a, b) => b.updatedAt - a.updatedAt);
    }
    return copy;
  }, [recent, recentSort]);

  // Close the sort dropdown on an outside click.
  useEffect(() => {
    if (!sortMenuOpen) return;
    function onClick(e: MouseEvent) {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) {
        setSortMenuOpen(false);
      }
    }
    window.addEventListener('mousedown', onClick);
    return () => window.removeEventListener('mousedown', onClick);
  }, [sortMenuOpen]);

  // Tag the current history entry with landingSub: null the first time this
  // screen mounts with no sub-view open, merging into whatever App.tsx has
  // already put on this entry (screen: 'landing') rather than overwriting
  // it. This gives the very first pushLandingSub() call something real to
  // return to on back, the same reasoning as App.tsx's own initial tag.
  // Also explicitly (re)asserts screen: 'landing' -- LandingScreen being
  // mounted at all means the app considers itself on the Landing screen,
  // so this entry should say so even if history.state.screen was somehow
  // left stale by another code path (see pushLandingSub above for the bug
  // this previously caused).
  useEffect(() => {
    if (!('landingSub' in (window.history.state ?? {}))) {
      window.history.replaceState({ ...window.history.state, screen: 'landing', landingSub: null }, '', window.location.href);
    }
  }, []);

  // Sync this screen's sub-view from the browser's back/forward
  // navigation. App.tsx has its own popstate listener reading
  // e.state.screen; this one reads e.state.landingSub instead, so the two
  // coexist without stepping on each other -- App's listener only cares
  // about top-level screen (which stays 'landing' the whole time the user
  // is inside any of these sub-views).
  useEffect(() => {
    function onPopState(e: PopStateEvent) {
      const sub = (e.state?.landingSub ?? null) as LandingSub;
      setShowAuthScreen(sub === 'auth');
      setShowUpgradeScreen(sub === 'upgrade');
      setStaticPage(sub === 'privacy' || sub === 'terms' || sub === 'help' ? sub : null);
      setShowAdminScreen(sub === 'admin');
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // Same client-side-only caveat as elsewhere (Toolbar, AIChatWidget) --
  // this only decides what the landing screen shows/allows. The real
  // enforcement has to live wherever documents actually get saved.
  const isPremium =
    subscription?.status === 'active' &&
    (subscription.planId === 'pro_monthly' || subscription.planId === 'pro_yearly');

  // Same caveat again: this only decides whether the Admin button/screen
  // render. The server must independently verify admin status on every
  // /api/admin/* route (and ideally on getUsage/saveDocument too, so
  // admins bypass the weekly limit for real and not just in this UI).
  const isAdmin = !!authUser?.isAdmin;

  // Non-premium visitors see the free templates up front and the premium
  // ones tucked behind a "More templates" toggle (still locked, so they can
  // browse what's available before deciding to upgrade). Premium users just
  // get everything in one grid -- there's nothing to hide from them.
  const freeTemplates = TEMPLATES.filter((tpl) => !tpl.premium);
  const extraTemplates = TEMPLATES.filter((tpl) => tpl.premium);

  useEffect(() => {
    api.listDocuments()
      .then((docs) => setRecent(docs.slice(0, 6)))
      .catch(() => setRecent([]))
      .finally(() => setLoadingRecent(false));
  }, []);

  // Checks session + subscription + weekly usage on every load. The landing
  // screen can be the very first thing a user sees, so this can't wait for
  // the ?upgraded= redirect below -- someone who subscribed last week and is
  // just opening the app normally today still needs their real plan
  // (and usage) fetched here, not left at whatever the default state was.
  useEffect(() => {
    if (authStatus === 'idle') fetchMe();
    fetchSubscription();
    api.getUsage().then(setUsage).catch(() => setUsage(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Stripe redirects back to APP_URL root after checkout (see success_url
  // in stripe.ts), landing here as ?upgraded=stripe. There's no guarantee
  // the webhook has already been processed by the time the user is
  // redirected back, so this just triggers a refetch and lets the
  // badge/plan label catch up whenever the subscriptions table is actually
  // updated -- it doesn't block on it.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const upgraded = params.get('upgraded');
    const canceled = params.get('upgradeCanceled');

    if (upgraded) {
      fetchSubscription();
      alert("You're all set! Your Premium plan should be active now.");
    } else if (canceled) {
      // No message needed -- the user just clicked "back" from checkout.
    }

    if (upgraded || canceled) {
      const url = new URL(window.location.href);
      url.searchParams.delete('upgraded');
      url.searchParams.delete('upgradeCanceled');
      window.history.replaceState({}, '', url.toString());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Same reasoning as App.tsx's identical helper: paying for Premium
  // requires an account, so an anonymous visitor (e.g. one who just hit
  // the weekly document limit without ever signing in) needs to sign in
  // first rather than landing on a checkout screen that will just fail.
  function requestUpgrade() {
    if (authStatus !== 'authenticated') {
      setShowAuthScreen(true);
      pushLandingSub('auth');
      return;
    }
    setShowUpgradeScreen(true);
    pushLandingSub('upgrade');
  }

  function openStaticPage(page: 'privacy' | 'terms' | 'help') {
    setStaticPage(page);
    pushLandingSub(page);
  }

  function openAdmin() {
    if (!isAdmin) return;
    setShowAdminScreen(true);
    pushLandingSub('admin');
  }

  async function openTemplate(template: TemplateDefinition) {
    if (creating) return;
    if (template.premium && !isPremium && !isAdmin) {
      setPremiumTemplate(template);
      return;
    }
    setCreating(template.id);
    try {
      const doc = {
        id: nanoid(),
        title: template.id === 'blank' ? 'Untitled document' : template.label,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: template.buildPages(),
      };
      await api.saveDocument(doc);
      loadDocument(doc);
      onEnter();
    } catch (err) {
      if (err instanceof WeeklyLimitError) {
        // Don't open the document at all -- it can never actually save,
        // so letting the user start editing it would just be a trap.
        setLimitReachedMessage(err.message);
        return;
      }
      // A generic failure (network hiccup, server error) — still open the
      // doc locally, autosave will retry once things recover.
      const doc = {
        id: nanoid(),
        title: template.id === 'blank' ? 'Untitled document' : template.label,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pages: template.buildPages(),
      };
      loadDocument(doc);
      onEnter();
    } finally {
      setCreating(null);
    }
  }

  async function openRecent(summary: DocumentSummary) {
    // Opening an OLD document is a pure read (api.getDocument), so it never
    // naturally hits the server's weekly_limit_reached check the way
    // creating a new one does. Gate it here using the read-only usage
    // snapshot fetched on mount, so free users who've hit their weekly cap
    // can't keep working just by reopening old files instead of new ones.
    // Admins skip this UI gate entirely (see isAdmin note above).
    if (usage?.limitReached && !isAdmin) {
      setLimitReachedMessage(
        `Free plan is limited to ${usage.limit} PDFs per week. Upgrade to Premium for unlimited.`
      );
      return;
    }
    try {
      const doc = await api.getDocument(summary.id);
      loadDocument(doc);
      onEnter();
    } catch {
      alert('Could not open that document. It may have been deleted.');
      setRecent((r) => r.filter((d) => d.id !== summary.id));
    }
  }

  if (showAuthScreen) {
    // Uses history.back() rather than setShowAuthScreen(false) directly, so
    // this on-screen Back button and the browser's own back button land on
    // the same place -- popstate above then flips showAuthScreen off in
    // sync with whatever entry we land back on.
    return <AuthScreen onBack={() => window.history.back()} />;
  }

  if (showUpgradeScreen) {
    return <UpgradeScreen onBack={() => window.history.back()} />;
  }

  if (staticPage === 'privacy') {
    return <PrivacyPolicyScreen onBack={() => window.history.back()} />;
  }

  if (staticPage === 'terms') {
    return <TermsOfServiceScreen onBack={() => window.history.back()} />;
  }

  if (staticPage === 'help') {
    return <HelpCenterScreen onBack={() => window.history.back()} />;
  }

  if (showAdminScreen) {
    return <AdminScreen onBack={() => window.history.back()} />;
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f0f4ff 0%, #f0f2f5 50%, #f5f0f8 100%)',
      fontFamily: 'var(--font-family)',
      overflowY: 'auto',
    }}>
      {/* Google's real One Tap prompt -- only ever shown to a visitor we've
          already confirmed is signed out. Renders nothing of its own; it's
          Google's script that paints the floating card, not this app. */}
      {authStatus === 'unauthenticated' && <GoogleOneTap />}

      {/* ── Top bar ────────────────────────────────────── */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1.5px solid var(--color-border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        padding: isMobile ? '0 16px' : '0 40px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 20,
        gap: 12,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <img src="/logo/PDF.png" alt="livePDF" style={{ height: isMobile ? 34 : 44, width: 'auto', flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? 14 : 16, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.2 }}>
              {t('app.name')}
            </div>
            {!isMobile && (
              <div style={{ fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                {t('app.tagline')}
              </div>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20, flexShrink: 0 }}>
          {/* Only shown once there's room -- on mobile the sign-in button
              or account menu already crowds this narrow header, and this
              line is a nice-to-have, not something a small-screen user
              needs to see. */}
          {!isMobile && (
            <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
              {t('landing.savedAutomatically')}
            </div>
          )}
          {isAdmin && (
            <button
              onClick={openAdmin}
              style={{
                fontSize: 12,
                fontWeight: 600,
                padding: isMobile ? '6px 10px' : '6px 14px',
                borderRadius: 20,
                border: '1.5px solid #1f2937',
                background: '#1f2937',
                color: 'white',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M12 2l7 3v6c0 5-3.4 8.7-7 10-3.6-1.3-7-5-7-10V5l7-3z"
                  stroke="white"
                  strokeWidth="1.8"
                  strokeLinejoin="round"
                />
              </svg>
              {!isMobile && 'Admin'}
            </button>
          )}
          {authStatus === 'authenticated' && authUser ? (
            <AccountMenu onUpgradeClick={requestUpgrade} />
          ) : (
            <button
              onClick={() => {
                setShowAuthScreen(true);
                pushLandingSub('auth');
              }}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: isMobile ? '6px 12px' : '6px 16px',
                borderRadius: 20,
                border: '1.5px solid var(--color-accent)',
                background: 'transparent',
                color: 'var(--color-accent)',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {t('landing.signIn')}
            </button>
          )}
        </div>
      </header>

      {/* ── Main content ───────────────────────────────── */}
      <div style={{
        maxWidth: 1020,
        margin: '0 auto',
        padding: isMobile ? '20px 12px 32px' : '44px 28px 48px',
      }}>

        {/* ── Templates section ──────────────────────── */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1.5px solid var(--color-border)',
          borderRadius: 14,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          marginBottom: isMobile ? 18 : 28,
          overflow: 'hidden',
        }}>
          {/* Section header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isMobile ? '14px 16px 12px' : '18px 24px 16px',
            borderBottom: '1.5px solid var(--color-border)',
            background: 'linear-gradient(to right, #fafbff, #ffffff)',
            gap: 10,
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: 'var(--color-text)' }}>
                {t('landing.startNewDocument')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {t('landing.chooseTemplate')}
              </div>
            </div>
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-accent)',
              background: 'var(--color-accent-bg)',
              padding: '4px 10px',
              borderRadius: 12,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}>
              {t('landing.templatesCount', { count: TEMPLATES.length })}
            </div>
          </div>

          {/* Template grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 104 : 132}px, 1fr))`,
            gap: isMobile ? 12 : 20,
            padding: isMobile ? '16px' : '24px',
            paddingBottom: extraTemplates.length === 0 ? (isMobile ? 16 : 24) : 8,
          }}>
            {freeTemplates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                loading={creating === template.id}
                locked={!!template.premium && !isPremium && !isAdmin}
                onClick={() => openTemplate(template)}
              />
            ))}
          </div>

          {/* More templates toggle -- shown to everyone, premium or not, to
              keep the initial grid short. The only difference for premium
              users is that nothing behind it is actually locked. */}
          {extraTemplates.length > 0 && (
            <div style={{ padding: isMobile ? '0 16px 16px' : '0 24px 24px', display: 'flex', justifyContent: 'center' }}>
              <button
                onClick={() => setMoreTemplatesOpen((v) => !v)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '9px 18px',
                  borderRadius: 20,
                  border: '1.5px solid var(--color-border)',
                  background: '#f8f9fa',
                  color: 'var(--color-text)',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                {moreTemplatesOpen
                  ? 'Show fewer templates'
                  : `More templates (${extraTemplates.length})`}
                <svg
                  width="10" height="10" viewBox="0 0 10 10" fill="none"
                  style={{
                    transform: moreTemplatesOpen ? 'rotate(180deg)' : 'none',
                    transition: 'transform 0.15s ease',
                  }}
                >
                  <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
            </div>
          )}

          {extraTemplates.length > 0 && moreTemplatesOpen && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: `repeat(auto-fill, minmax(${isMobile ? 104 : 132}px, 1fr))`,
              gap: isMobile ? 12 : 20,
              padding: isMobile ? '0 16px 16px' : '0 24px 24px',
              borderTop: '1.5px solid var(--color-border)',
              marginTop: -1,
              paddingTop: isMobile ? 16 : 24,
            }}>
              {extraTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  loading={creating === template.id}
                  locked={!isPremium && !isAdmin}
                  onClick={() => openTemplate(template)}
                />
              ))}
            </div>
          )}
        </div>

        {/* ── Recent documents section ───────────────── */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1.5px solid var(--color-border)',
          borderRadius: 14,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          overflow: 'hidden',
        }}>
          {/* Section header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: isMobile ? '14px 16px 12px' : '18px 24px 16px',
            borderBottom: '1.5px solid var(--color-border)',
            background: 'linear-gradient(to right, #fafbff, #ffffff)',
            gap: 10,
            flexWrap: 'wrap',
          }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: isMobile ? 14 : 15, fontWeight: 600, color: 'var(--color-text)' }}>
                {t('landing.recentDocuments')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                {usage?.limitReached && !isAdmin
                  ? 'Weekly limit reached — upgrade to keep editing.'
                  : t('landing.pickUpWhereYouLeftOff')}
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {recent.length > 1 && (
                <div ref={sortMenuRef} style={{ position: 'relative' }}>
                  <button
                    onClick={() => setSortMenuOpen((v) => !v)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1.5px solid var(--color-border)',
                      background: 'var(--color-surface)',
                      color: 'var(--color-text-secondary)',
                      fontSize: 12,
                      fontWeight: 500,
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <path d="M4 4h8M4 8h5M4 12h2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                      <path d="M12 8v5m0 0l-2-2m2 2l2-2" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                    {/* On mobile there just isn't room for both the icon and
                        the full label next to the document count pill --
                        the icon alone (with the dropdown itself still
                        showing full labels) keeps this row from wrapping. */}
                    {!isMobile && SORT_OPTIONS.find((o) => o.value === recentSort)?.label}
                    <svg
                      width="9" height="9" viewBox="0 0 10 10" fill="none"
                      style={{ transform: sortMenuOpen ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s ease' }}
                    >
                      <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                  {sortMenuOpen && (
                    <div style={{
                      position: 'absolute',
                      top: 'calc(100% + 6px)',
                      right: 0,
                      minWidth: 190,
                      background: 'var(--color-surface)',
                      border: '1.5px solid var(--color-border)',
                      borderRadius: 10,
                      boxShadow: '0 8px 28px rgba(0,0,0,0.15)',
                      overflow: 'hidden',
                      zIndex: 30,
                    }}>
                      {SORT_OPTIONS.map((opt) => (
                        <button
                          key={opt.value}
                          onClick={() => {
                            setRecentSort(opt.value);
                            setSortMenuOpen(false);
                          }}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            width: '100%',
                            padding: '9px 12px',
                            border: 'none',
                            background: opt.value === recentSort ? '#f8faff' : 'transparent',
                            color: 'var(--color-text)',
                            fontSize: 12.5,
                            fontWeight: opt.value === recentSort ? 600 : 400,
                            textAlign: 'left',
                            cursor: 'pointer',
                          }}
                        >
                          <span style={{ width: 14, display: 'inline-flex', color: 'var(--color-accent)' }}>
                            {opt.value === recentSort && (
                              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                <path d="M2 6.2L4.6 9L10 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            )}
                          </span>
                          {opt.label}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {recent.length > 0 && (
                <div style={{
                  fontSize: 11,
                  fontWeight: 500,
                  color: 'var(--color-text-muted)',
                  background: '#f1f3f4',
                  padding: '4px 10px',
                  borderRadius: 12,
                  whiteSpace: 'nowrap',
                }}>
                  {t('landing.documentsCount', { count: recent.length, plural: recent.length !== 1 ? 's' : '' })}
                </div>
              )}
            </div>
          </div>

          {/* Recent content */}
          {loadingRecent && (
            <div style={{ padding: '32px 24px', fontSize: 13, color: 'var(--color-text-muted)', textAlign: 'center' }}>
              Loading recent documents…
            </div>
          )}

          {!loadingRecent && recent.length === 0 && (
            <div style={{ padding: '40px 24px', textAlign: 'center' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📂</div>
              <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--color-text-secondary)', marginBottom: 6 }}>
                {t('landing.noRecentDocuments')}
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                {t('landing.createOneAbove')}
              </div>
            </div>
          )}

          {!loadingRecent && recent.length > 0 && (
            <div>
              {/* Table header row -- collapsed to just Document/Actions on
                  mobile since there's no room for a separate "Last modified"
                  column; that date instead moves under the title in each
                  row (see RecentCard). */}
              {!isMobile && (
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 140px 120px',
                  padding: '8px 24px',
                  background: '#f8f9fa',
                  borderBottom: '1px solid var(--color-border)',
                }}>
                  {[t('landing.colDocument'), t('landing.colLastModified'), t('landing.colActions')].map((h) => (
                    <div key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {h}
                    </div>
                  ))}
                </div>
              )}
              {/* Document rows */}
              {sortedRecent.map((doc, i) => (
                <RecentCard
                  key={doc.id}
                  doc={doc}
                  isLast={i === sortedRecent.length - 1}
                  locked={!!usage?.limitReached && !isAdmin}
                  isMobile={isMobile}
                  onClick={() => openRecent(doc)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Footer ─────────────────────────────────────── */}
      <footer id="app-footer" style={{
        background: '#0a0a0a',
        marginTop: 8,
      }}>
        <div style={{
          maxWidth: 1020,
          margin: '0 auto',
          padding: isMobile ? '32px 16px' : '48px 28px',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: isMobile ? 'flex-start' : 'center',
          flexDirection: isMobile ? 'column' : 'row',
          justifyContent: 'space-between',
          gap: 20,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              background: '#ffffff',
              borderRadius: 8,
              padding: '5px 8px',
            }}>
              <img src="/logo/PDF.png" alt="" style={{ height: 22, width: 'auto' }} />
            </div>
            <span style={{ fontSize: 13.5, color: '#a2a5aa' }}>
              © {new Date().getFullYear()} {t('app.name')}. All rights reserved.
            </span>
          </div>
          <nav style={{ display: 'flex', flexWrap: 'wrap', gap: isMobile ? 16 : 28 }}>
            {[
              { label: 'Privacy Policy', onClick: () => openStaticPage('privacy') },
              { label: 'Terms of Service', onClick: () => openStaticPage('terms') },
              { label: 'Help Center', onClick: () => openStaticPage('help') },
              { label: 'Contact', href: '/contact' }, // TODO: wire up once the Contact page exists
            ].map((link) =>
              'href' in link ? (
                <a
                  key={link.label}
                  href={link.href}
                  style={{
                    fontSize: 13.5,
                    color: '#a2a5aa',
                    textDecoration: 'none',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#a2a5aa')}
                >
                  {link.label}
                </a>
              ) : (
                <button
                  key={link.label}
                  onClick={link.onClick}
                  style={{
                    fontSize: 13.5,
                    color: '#a2a5aa',
                    background: 'transparent',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    fontFamily: 'inherit',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = '#ffffff')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = '#a2a5aa')}
                >
                  {link.label}
                </button>
              )
            )}
          </nav>
        </div>
      </footer>
      {limitReachedMessage && (
        <LimitReachedDialog
          message={limitReachedMessage}
          onClose={() => setLimitReachedMessage(null)}
          onUpgrade={() => {
            setLimitReachedMessage(null);
            requestUpgrade();
          }}
        />
      )}
      {premiumTemplate && (
        <PremiumRequiredDialog
          featureName={`The "${premiumTemplate.label}" template`}
          onClose={() => setPremiumTemplate(null)}
          onUpgrade={() => {
            setPremiumTemplate(null);
            requestUpgrade();
          }}
        />
      )}
    </div>
  );
}

function TemplateCard({
  template,
  loading,
  locked,
  onClick,
}: {
  template: TemplateDefinition;
  loading: boolean;
  locked: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const t = useI18nStore((s) => s.t);

  return (
    <button
      onClick={onClick}
      disabled={loading}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        padding: 0,
        border: hovered ? '2px solid var(--color-accent)' : '2px solid var(--color-border)',
        borderRadius: 10,
        background: 'var(--color-surface)',
        cursor: loading ? 'default' : 'pointer',
        overflow: 'hidden',
        transition: 'border-color 0.15s ease, box-shadow 0.15s ease',
        boxShadow: hovered ? 'var(--shadow-md)' : 'var(--shadow-sm)',
        textAlign: 'left',
        position: 'relative',
      }}
    >
      {/* Thumbnail */}
      <div style={{
        height: 108,
        background: template.color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 40,
        position: 'relative',
        overflow: 'hidden',
      }}>
        <TemplateThumbnail id={template.id} />
        {locked && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(255,255,255,0.4)',
          }} />
        )}
        {locked && (
          <div style={{
            position: 'absolute',
            top: 6,
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 3,
            padding: '3px 7px',
            borderRadius: 10,
            background: 'rgba(32,33,36,0.82)',
            color: 'white',
            fontSize: 9,
            fontWeight: 600,
            letterSpacing: '0.02em',
          }}>
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" fill="white" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="white" strokeWidth="1.4" fill="none" />
            </svg>
            PREMIUM
          </div>
        )}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: 'var(--color-text-secondary)',
          }}>
            {t('landing.creating')}
          </div>
        )}
      </div>
      {/* Label */}
      <div style={{ padding: '10px 12px 12px' }}>
        <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--color-text)', lineHeight: 1.3 }}>
          {template.label}
        </div>
        <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 3, lineHeight: 1.4 }}>
          {template.description}
        </div>
      </div>
    </button>
  );
}

function TemplateThumbnail({ id }: { id: string }) {
  switch (id) {
    case 'blank':                return <BlankThumbnail />;
    case 'resume':                return <ResumeThumbnail />;
    case 'invoice':                return <InvoiceThumbnail />;
    case 'letter':                return <LetterThumbnail />;
    case 'meeting':                return <MeetingThumbnail />;
    case 'report':                return <ReportThumbnail />;
    case 'certificate':                return <CertificateThumbnail />;
    case 'todo':                return <ToDoThumbnail />;
    case 'project-tracking':                return <ProjectTrackingThumbnail />;
    case 'timetable':                return <TimetableThumbnail />;
    case 'shift-schedule':                return <ShiftScheduleThumbnail />;
    case 'attendance':                return <AttendanceThumbnail />;
    case 'gradebook':                return <GradeBookThumbnail />;
    case 'expense-report':                return <ExpenseReportThumbnail />;
    case 'purchase-order':                return <PurchaseOrderThumbnail />;
    case 'annual-budget':                return <AnnualBudgetThumbnail />;
    case 'team-roster':                return <TeamRosterThumbnail />;
    case 'time-shifts':                return <TimeShiftsThumbnail />;
    case 'analytics-dashboard':                return <AnalyticsDashboardThumbnail />;
    default:            return <BlankThumbnail />;
  }
}

/** Shared paper-card wrapper used by every thumbnail */
function Paper({ children }: { children: React.ReactNode }) {
  return (
    <svg width="80" height="100" viewBox="0 0 80 100" fill="none" xmlns="http://www.w3.org/2000/svg"
      style={{ filter: 'drop-shadow(0 2px 6px rgba(0,0,0,0.13))' }}>
      <rect width="80" height="100" rx="3" fill="white" />
      {children}
    </svg>
  );
}

function BlankThumbnail() {
  return (
    <Paper>
      <rect x="12" y="16" width="56" height="2" rx="1" fill="#dadce0"/>
      <rect x="12" y="22" width="56" height="2" rx="1" fill="#dadce0"/>
      <rect x="12" y="28" width="40" height="2" rx="1" fill="#dadce0"/>
      <rect x="12" y="38" width="56" height="2" rx="1" fill="#efefef"/>
      <rect x="12" y="44" width="56" height="2" rx="1" fill="#efefef"/>
      <rect x="12" y="50" width="32" height="2" rx="1" fill="#efefef"/>
      {/* folded corner */}
      <path d="M64 0 L80 0 L80 16 Z" fill="#f0f2f5"/>
      <path d="M64 0 L64 16 L80 16" fill="none" stroke="#dadce0" strokeWidth="1"/>
    </Paper>
  );
}

function ResumeThumbnail() {
  return (
    <Paper>
      {/* header band */}
      <rect width="80" height="22" rx="3" fill="#4a90d9"/>
      {/* avatar circle */}
      <circle cx="16" cy="11" r="7" fill="white" fillOpacity="0.25"/>
      <circle cx="16" cy="9" r="3" fill="white" fillOpacity="0.5"/>
      <path d="M9 18 Q16 14 23 18" fill="white" fillOpacity="0.5"/>
      {/* name lines */}
      <rect x="27" y="7" width="30" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      <rect x="27" y="13" width="20" height="2" rx="1" fill="white" fillOpacity="0.5"/>
      {/* section label */}
      <rect x="8" y="28" width="18" height="2" rx="1" fill="#4a90d9"/>
      {/* content lines */}
      <rect x="8" y="33" width="64" height="1.5" rx="0.75" fill="#e0e0e0"/>
      <rect x="8" y="37" width="55" height="1.5" rx="0.75" fill="#e0e0e0"/>
      <rect x="8" y="41" width="60" height="1.5" rx="0.75" fill="#e0e0e0"/>
      {/* section label 2 */}
      <rect x="8" y="49" width="22" height="2" rx="1" fill="#4a90d9"/>
      <rect x="8" y="54" width="64" height="1.5" rx="0.75" fill="#e0e0e0"/>
      <rect x="8" y="58" width="48" height="1.5" rx="0.75" fill="#e0e0e0"/>
      {/* skills dots */}
      <rect x="8" y="66" width="14" height="2" rx="1" fill="#e0e0e0"/>
      <rect x="25" y="66" width="14" height="2" rx="1" fill="#e0e0e0"/>
      <rect x="42" y="66" width="14" height="2" rx="1" fill="#e0e0e0"/>
    </Paper>
  );
}

function InvoiceThumbnail() {
  return (
    <Paper>
      {/* INVOICE title */}
      <rect x="8" y="8" width="30" height="4" rx="2" fill="#1a73e8"/>
      {/* logo placeholder */}
      <rect x="56" y="8" width="16" height="8" rx="2" fill="#e8f0fe"/>
      {/* divider */}
      <rect x="8" y="18" width="64" height="1" rx="0.5" fill="#e0e0e0"/>
      {/* from / to blocks */}
      <rect x="8" y="22" width="12" height="1.5" rx="0.75" fill="#9aa0a6"/>
      <rect x="8" y="25.5" width="24" height="1.5" rx="0.75" fill="#dadce0"/>
      <rect x="8" y="29" width="20" height="1.5" rx="0.75" fill="#dadce0"/>
      <rect x="44" y="22" width="12" height="1.5" rx="0.75" fill="#9aa0a6"/>
      <rect x="44" y="25.5" width="28" height="1.5" rx="0.75" fill="#dadce0"/>
      <rect x="44" y="29" width="20" height="1.5" rx="0.75" fill="#dadce0"/>
      {/* table header */}
      <rect x="8" y="36" width="64" height="6" rx="1" fill="#e8f0fe"/>
      <rect x="10" y="38.5" width="20" height="1.5" rx="0.75" fill="#1a73e8" fillOpacity="0.6"/>
      <rect x="58" y="38.5" width="12" height="1.5" rx="0.75" fill="#1a73e8" fillOpacity="0.6"/>
      {/* table rows */}
      {[0,1,2].map(i => (
        <g key={i}>
          <rect x="8" y={44 + i*7} width="64" height="5" rx="0.5" fill={i % 2 === 0 ? '#f8f9fa' : 'white'}/>
          <rect x="10" y={46 + i*7} width="28" height="1.5" rx="0.75" fill="#dadce0"/>
          <rect x="60" y={46 + i*7} width="10" height="1.5" rx="0.75" fill="#dadce0"/>
        </g>
      ))}
      {/* total */}
      <rect x="44" y="67" width="28" height="5" rx="1" fill="#1a73e8"/>
      <rect x="46" y="69" width="20" height="1.5" rx="0.75" fill="white" fillOpacity="0.8"/>
    </Paper>
  );
}

function LetterThumbnail() {
  return (
    <Paper>
      {/* date line */}
      <rect x="8" y="8" width="28" height="2" rx="1" fill="#e0e0e0"/>
      {/* recipient */}
      <rect x="8" y="16" width="36" height="2" rx="1" fill="#dadce0"/>
      <rect x="8" y="20" width="28" height="2" rx="1" fill="#dadce0"/>
      <rect x="8" y="24" width="32" height="2" rx="1" fill="#dadce0"/>
      {/* salutation */}
      <rect x="8" y="32" width="40" height="2" rx="1" fill="#c0c0c0"/>
      {/* body paragraphs */}
      <rect x="8" y="38" width="64" height="1.5" rx="0.75" fill="#e8e8e8"/>
      <rect x="8" y="41.5" width="64" height="1.5" rx="0.75" fill="#e8e8e8"/>
      <rect x="8" y="45" width="64" height="1.5" rx="0.75" fill="#e8e8e8"/>
      <rect x="8" y="48.5" width="48" height="1.5" rx="0.75" fill="#e8e8e8"/>
      <rect x="8" y="55" width="64" height="1.5" rx="0.75" fill="#e8e8e8"/>
      <rect x="8" y="58.5" width="64" height="1.5" rx="0.75" fill="#e8e8e8"/>
      <rect x="8" y="62" width="40" height="1.5" rx="0.75" fill="#e8e8e8"/>
      {/* sign-off */}
      <rect x="8" y="70" width="32" height="2" rx="1" fill="#dadce0"/>
      <rect x="8" y="78" width="40" height="2" rx="1" fill="#dadce0"/>
      <rect x="8" y="82" width="24" height="2" rx="1" fill="#dadce0"/>
    </Paper>
  );
}

function MeetingThumbnail() {
  return (
    <Paper>
      {/* title bar */}
      <rect x="8" y="8" width="50" height="4" rx="2" fill="#188038"/>
      <rect x="8" y="15" width="36" height="2" rx="1" fill="#e0e0e0"/>
      {/* divider */}
      <rect x="8" y="21" width="64" height="1" rx="0.5" fill="#e0e0e0"/>
      {/* agenda items with checkboxes */}
      {[0,1,2,3].map(i => (
        <g key={i}>
          <rect x="8" y={26 + i*10} width="6" height="6" rx="1" stroke="#dadce0" strokeWidth="1" fill="white"/>
          {i < 2 && <path d={`M9.5 ${29 + i*10} l2 2 l3 -3`} stroke="#188038" strokeWidth="1.5" fill="none"/>}
          <rect x="18" y={28 + i*10} width="36" height="2" rx="1" fill="#e0e0e0"/>
        </g>
      ))}
      {/* notes section */}
      <rect x="8" y="68" width="22" height="2" rx="1" fill="#188038"/>
      <rect x="8" y="73" width="64" height="1.5" rx="0.75" fill="#efefef"/>
      <rect x="8" y="77" width="55" height="1.5" rx="0.75" fill="#efefef"/>
      <rect x="8" y="81" width="60" height="1.5" rx="0.75" fill="#efefef"/>
    </Paper>
  );
}

function ReportThumbnail() {
  return (
    <Paper>
      {/* cover color band */}
      <rect width="80" height="42" rx="3" fill="#5c6bc0"/>
      {/* decorative lines on cover */}
      <rect x="0" y="30" width="80" height="2" fill="white" fillOpacity="0.1"/>
      <rect x="0" y="35" width="80" height="1" fill="white" fillOpacity="0.08"/>
      {/* title lines */}
      <rect x="10" y="12" width="44" height="4" rx="2" fill="white" fillOpacity="0.9"/>
      <rect x="10" y="19" width="32" height="2.5" rx="1.25" fill="white" fillOpacity="0.55"/>
      <rect x="10" y="24" width="24" height="2" rx="1" fill="white" fillOpacity="0.35"/>
      {/* bar chart on lower half */}
      <rect x="8" y="50" width="14" height="2" rx="1" fill="#9fa8da"/>
      <rect x="14" y="72" width="8" height="18" rx="1" fill="#9fa8da"/>
      <rect x="26" y="62" width="8" height="28" rx="1" fill="#5c6bc0"/>
      <rect x="38" y="56" width="8" height="34" rx="1" fill="#9fa8da"/>
      <rect x="50" y="68" width="8" height="22" rx="1" fill="#5c6bc0"/>
      <rect x="62" y="60" width="8" height="30" rx="1" fill="#9fa8da"/>
      <rect x="8" y="91" width="64" height="1" rx="0.5" fill="#e0e0e0"/>
    </Paper>
  );
}

function CertificateThumbnail() {
  return (
    <Paper>
      {/* ornate border */}
      <rect x="4" y="4" width="72" height="92" rx="2" fill="none" stroke="#c8a84b" strokeWidth="2"/>
      <rect x="7" y="7" width="66" height="86" rx="1" fill="none" stroke="#c8a84b" strokeWidth="0.75" strokeDasharray="3 2"/>
      {/* header */}
      <rect x="20" y="13" width="40" height="3" rx="1.5" fill="#c8a84b"/>
      {/* certificate of text */}
      <rect x="16" y="19" width="48" height="2" rx="1" fill="#e0c97a" fillOpacity="0.7"/>
      {/* trophy / medal */}
      <circle cx="40" cy="40" r="12" fill="#fff8e7" stroke="#c8a84b" strokeWidth="1.5"/>
      <path d="M34 40 Q40 34 46 40 Q40 48 34 40Z" fill="#c8a84b" fillOpacity="0.5"/>
      <circle cx="40" cy="40" r="4" fill="#c8a84b"/>
      {/* recipient name area */}
      <rect x="14" y="58" width="52" height="3" rx="1.5" fill="#c8a84b" fillOpacity="0.4"/>
      {/* description lines */}
      <rect x="18" y="65" width="44" height="1.5" rx="0.75" fill="#e0e0e0"/>
      <rect x="22" y="69" width="36" height="1.5" rx="0.75" fill="#e0e0e0"/>
      {/* signature lines */}
      <rect x="13" y="82" width="22" height="1" rx="0.5" fill="#c8a84b" fillOpacity="0.5"/>
      <rect x="45" y="82" width="22" height="1" rx="0.5" fill="#c8a84b" fillOpacity="0.5"/>
    </Paper>
  );
}

function ToDoThumbnail() {
  return (
    <Paper>
      <rect width="80" height="20" rx="3" fill="#f4511e"/>
      <rect x="10" y="7" width="40" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3,4].map(i => (
        <g key={i}>
          <rect x="10" y={28 + i*13} width="6" height="6" rx="1" stroke="#dadce0" strokeWidth="1" fill="white"/>
          {i < 2 && <path d={`M11.5 ${31+i*13} l1.5 1.5 l2.5 -2.5`} stroke="#f4511e" strokeWidth="1.5" fill="none"/>}
          <rect x="20" y={30 + i*13} width="46" height="2" rx="1" fill="#e0e0e0"/>
        </g>
      ))}
    </Paper>
  );
}

function ProjectTrackingThumbnail() {
  return (
    <Paper>
      <rect width="80" height="18" rx="3" fill="#00897b"/>
      <rect x="10" y="6" width="36" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      <rect x="8" y="24" width="64" height="6" rx="1" fill="#e0f2f1"/>
      {[0,1,2,3].map(i => (
        <g key={i}>
          <rect x="8" y={32 + i*11} width="64" height="9" rx="0.5" fill={i % 2 === 0 ? '#f8f9fa' : 'white'}/>
          <rect x="10" y={35.5 + i*11} width="24" height="2" rx="1" fill="#dadce0"/>
          <rect x="56" y={35.5 + i*11} width="14" height="2" rx="1" fill="#00897b" fillOpacity="0.5"/>
        </g>
      ))}
    </Paper>
  );
}

function TimetableThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#8e24aa"/>
      <rect x="10" y="5.5" width="34" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3,4].map(row => (
        <g key={row}>
          {[0,1,2,3,4,5].map(col => (
            <rect key={col} x={8 + col*11} y={22 + row*13} width="10" height="11" fill={row===0 ? '#f3e5f5' : 'white'} stroke="#e0e0e0" strokeWidth="0.5"/>
          ))}
        </g>
      ))}
    </Paper>
  );
}

function ShiftScheduleThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#43a047"/>
      <rect x="10" y="5.5" width="42" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3].map(row => (
        <g key={row}>
          <rect x="8" y={22 + row*15} width="20" height="12" fill="#e8f5e9" stroke="#dadce0" strokeWidth="0.5"/>
          {[0,1,2,3].map(col => (
            <rect key={col} x={30 + col*11} y={22 + row*15} width="10" height="12" fill="white" stroke="#e0e0e0" strokeWidth="0.5"/>
          ))}
        </g>
      ))}
    </Paper>
  );
}

function AttendanceThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#d81b60"/>
      <rect x="10" y="5.5" width="38" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3,4].map(row => (
        <g key={row}>
          <rect x="8" y={22+row*13} width="26" height="10" fill="white" stroke="#f5d0e0" strokeWidth="0.5"/>
          {[0,1,2,3].map(col => (
            <circle key={col} cx={40+col*10} cy={27+row*13} r="3" fill={col<3 ? '#fce4ec' : 'white'} stroke="#d81b60" strokeWidth="0.6"/>
          ))}
        </g>
      ))}
    </Paper>
  );
}

function GradeBookThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#fb8c00"/>
      <rect x="10" y="5.5" width="34" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3,4].map(row => (
        <g key={row}>
          <rect x="8" y={22+row*13} width="22" height="11" fill="white" stroke="#f7d9ad" strokeWidth="0.5"/>
          {[0,1,2].map(col => (
            <rect key={col} x={32+col*15} y={22+row*13} width="14" height="11" fill={row===0?'#fff3e0':'white'} stroke="#f0e0c8" strokeWidth="0.5"/>
          ))}
        </g>
      ))}
    </Paper>
  );
}

function ExpenseReportThumbnail() {
  return (
    <Paper>
      <rect x="8" y="8" width="30" height="4" rx="2" fill="#3949ab"/>
      <rect x="8" y="18" width="64" height="1" fill="#e0e0e0"/>
      <rect x="8" y="26" width="64" height="6" rx="1" fill="#e8eaf6"/>
      {[0,1,2].map(i => (
        <g key={i}>
          <rect x="8" y={34+i*8} width="64" height="6" rx="0.5" fill={i%2===0?'white':'#f8f9fa'}/>
          <rect x="10" y={36+i*8} width="24" height="1.5" rx="0.75" fill="#dadce0"/>
          <rect x="58" y={36+i*8} width="12" height="1.5" rx="0.75" fill="#dadce0"/>
        </g>
      ))}
      <rect x="44" y="66" width="28" height="6" rx="1" fill="#3949ab"/>
      <rect x="46" y="68" width="20" height="1.5" rx="0.75" fill="white" fillOpacity="0.8"/>
    </Paper>
  );
}

function PurchaseOrderThumbnail() {
  return (
    <Paper>
      <rect x="8" y="8" width="34" height="4" rx="2" fill="#6d4c41"/>
      <rect x="56" y="8" width="16" height="8" rx="2" fill="#efebe9"/>
      <rect x="8" y="18" width="64" height="1" fill="#e0e0e0"/>
      <rect x="8" y="36" width="64" height="6" rx="1" fill="#efebe9"/>
      {[0,1,2].map(i => (
        <g key={i}>
          <rect x="8" y={44+i*7} width="64" height="5" rx="0.5" fill={i%2===0?'#f8f9fa':'white'}/>
          <rect x="10" y={46+i*7} width="28" height="1.5" rx="0.75" fill="#dadce0"/>
          <rect x="60" y={46+i*7} width="10" height="1.5" rx="0.75" fill="#dadce0"/>
        </g>
      ))}
      <rect x="44" y="67" width="28" height="5" rx="1" fill="#6d4c41"/>
    </Paper>
  );
}

function AnnualBudgetThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#f9a825"/>
      <rect x="10" y="5.5" width="36" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3].map(row => (
        <g key={row}>
          <rect x="8" y={22+row*11} width="26" height="9" fill="white" stroke="#fbe6b0" strokeWidth="0.5"/>
          {[0,1,2].map(col => (
            <rect key={col} x={34+col*13} y={22+row*11} width="12" height="9" fill={row===0?'#fef7e0':'white'} stroke="#f0e2b0" strokeWidth="0.5"/>
          ))}
        </g>
      ))}
      <rect x="8" y="68" width="64" height="6" rx="1" fill="#202124"/>
    </Paper>
  );
}

function TeamRosterThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#1e88e5"/>
      <rect x="10" y="5.5" width="34" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3].map(i => (
        <g key={i}>
          <circle cx="14" cy={28+i*15} r="5" fill="#e3f2fd" stroke="#1e88e5" strokeWidth="0.8"/>
          <rect x="24" y={24+i*15} width="40" height="2" rx="1" fill="#dadce0"/>
          <rect x="24" y={28+i*15} width="30" height="1.5" rx="0.75" fill="#e8e8e8"/>
        </g>
      ))}
    </Paper>
  );
}

function TimeShiftsThumbnail() {
  return (
    <Paper>
      <rect x="8" y="8" width="34" height="4" rx="2" fill="#5e35b1"/>
      <circle cx="64" cy="14" r="8" fill="#ede7f6" stroke="#5e35b1" strokeWidth="1"/>
      <path d="M64 9 L64 14 L68 16" stroke="#5e35b1" strokeWidth="1.2" fill="none" strokeLinecap="round"/>
      <rect x="8" y="26" width="64" height="6" rx="1" fill="#ede7f6"/>
      {[0,1,2,3].map(i => (
        <g key={i}>
          <rect x="8" y={34+i*9} width="64" height="7" rx="0.5" fill={i%2===0?'white':'#f8f9fa'}/>
          <rect x="10" y={36.5+i*9} width="20" height="1.5" rx="0.75" fill="#dadce0"/>
          <rect x="50" y={36.5+i*9} width="20" height="1.5" rx="0.75" fill="#dadce0"/>
        </g>
      ))}
    </Paper>
  );
}

function AnalyticsDashboardThumbnail() {
  return (
    <Paper>
      <rect width="80" height="16" rx="3" fill="#0097a7"/>
      <rect x="10" y="5.5" width="42" height="3" rx="1.5" fill="white" fillOpacity="0.9"/>
      {[0,1,2,3].map(i => (
        <rect key={i} x={8+i*17} y="22" width="14" height="12" rx="1.5" fill="#e0f7fa" stroke="#0097a7" strokeWidth="0.5"/>
      ))}
      {/* bar chart */}
      <rect x="8" y="42" width="30" height="34" rx="1" fill="#f8f9fa" stroke="#dadce0" strokeWidth="0.5"/>
      <rect x="12" y="64" width="4" height="10" fill="#0097a7"/>
      <rect x="18" y="58" width="4" height="16" fill="#0097a7"/>
      <rect x="24" y="50" width="4" height="24" fill="#0097a7"/>
      <rect x="30" y="60" width="4" height="14" fill="#0097a7"/>
      {/* second bar chart */}
      <rect x="42" y="42" width="30" height="34" rx="1" fill="#f8f9fa" stroke="#dadce0" strokeWidth="0.5"/>
      <rect x="46" y="52" width="5" height="22" fill="#3949ab"/>
      <rect x="53" y="60" width="5" height="14" fill="#3949ab"/>
      <rect x="60" y="66" width="5" height="8" fill="#3949ab"/>
    </Paper>
  );
}

function RecentCard({
  doc,
  isLast,
  locked,
  isMobile,
  onClick,
}: {
  doc: DocumentSummary;
  isLast: boolean;
  locked: boolean;
  isMobile: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const t = useI18nStore((s) => s.t);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        // Mobile drops the separate "Last modified" column entirely (see
        // below, it's folded into the title cell instead) and gives the
        // Actions cell just enough width for the compact Open button/badge.
        gridTemplateColumns: isMobile ? '1fr 84px' : '1fr 140px 120px',
        alignItems: 'center',
        padding: isMobile ? '12px 16px' : '14px 24px',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
        background: hovered && !locked ? '#f8faff' : 'transparent',
        opacity: locked ? 0.55 : 1,
        transition: 'background 0.12s ease, opacity 0.12s ease',
        cursor: 'pointer',
        gap: 8,
      }}
      onClick={onClick}
    >
      {/* Name + icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 12, overflow: 'hidden', minWidth: 0 }}>
        <div style={{
          width: isMobile ? 30 : 36, height: isMobile ? 37 : 44, flexShrink: 0,
          background: 'var(--color-accent-bg)',
          borderRadius: 5,
          border: '1px solid #c5d9f8',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <svg width="18" height="22" viewBox="0 0 18 22" fill="none">
            <rect x="1" y="1" width="16" height="20" rx="2" fill="white" stroke="#1a73e8" strokeWidth="1.2"/>
            <rect x="4" y="5" width="10" height="1.4" rx="0.7" fill="#1a73e8" fillOpacity="0.45"/>
            <rect x="4" y="8.5" width="10" height="1.4" rx="0.7" fill="#1a73e8" fillOpacity="0.45"/>
            <rect x="4" y="12" width="7" height="1.4" rx="0.7" fill="#1a73e8" fillOpacity="0.45"/>
          </svg>
        </div>
        <div style={{ minWidth: 0, overflow: 'hidden' }}>
          <div style={{
            fontSize: 13, fontWeight: 500, color: 'var(--color-text)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {doc.title || 'Untitled document'}
          </div>
          {/* Last-modified date, folded in here only on mobile since there's
              no separate column for it at this width. */}
          {isMobile && (
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)', marginTop: 2 }}>
              {formatAgo(doc.updatedAt)}
            </div>
          )}
        </div>
      </div>

      {/* Last modified -- desktop/tablet only, mobile shows it under the title instead */}
      {!isMobile && (
        <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
          {formatAgo(doc.updatedAt)}
        </div>
      )}

      {/* Open button */}
      <div style={{ textAlign: 'right' }}>
        {locked ? (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontSize: isMobile ? 10 : 11,
              fontWeight: 600,
              padding: isMobile ? '5px 8px' : '5px 12px',
              borderRadius: 20,
              background: 'rgba(32,33,36,0.08)',
              color: 'var(--color-text-muted)',
              whiteSpace: 'nowrap',
            }}
          >
            <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor" />
              <path d="M5 7V5a3 3 0 0 1 6 0v2" stroke="currentColor" strokeWidth="1.4" fill="none" />
            </svg>
            {!isMobile && 'Limit reached'}
          </span>
        ) : (
          <button
            onClick={(e) => { e.stopPropagation(); onClick(); }}
            style={{
              fontSize: isMobile ? 11 : 12,
              padding: isMobile ? '5px 10px' : '5px 14px',
              borderRadius: 20,
              border: '1.5px solid var(--color-accent)',
              background: hovered ? 'var(--color-accent)' : 'transparent',
              color: hovered ? 'white' : 'var(--color-accent)',
              fontWeight: 500,
              transition: 'background 0.15s ease, color 0.15s ease',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            {t('landing.open')}
          </button>
        )}
      </div>
    </div>
  );
}

function formatAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}