import { useEffect, useMemo, useState } from 'react';
import { api, type AdminAnalytics } from '../lib/api';

interface Props {
  onBack: () => void;
}

// ---- palette -------------------------------------------------------------
// Distinct from the app's single --color-accent: this screen gets its own
// small "dashboard" palette (violet / blue / pink / teal / amber) so the
// plan-mix and activity visuals can be told apart at a glance.
const INK = '#221A3D';
const INK_MUTED = '#8D86AC';
const BG_TOP = '#F4F1FF';
const BG_BOTTOM = '#EDF1FF';
const CARD = '#FFFFFF';
const CARD_BORDER = 'rgba(109, 92, 224, 0.10)';
const SHADOW = '0 12px 32px rgba(76, 61, 168, 0.10)';

const VIOLET = '#6D5CE0';
const VIOLET_SOFT = '#EDE9FE';
const BLUE = '#4C7EF3';
const BLUE_SOFT = '#E7EFFF';
const PINK = '#F0609B';
const PINK_SOFT = '#FDE7F0';
const TEAL = '#17B6A7';
const TEAL_SOFT = '#E1F7F4';

export function AdminScreen({ onBack }: Props) {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [spinning, setSpinning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getAdminAnalytics()
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load analytics');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
          setSpinning(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  return (
    <div
      style={{
        minHeight: '100vh',
        background: `linear-gradient(180deg, ${BG_TOP} 0%, ${BG_BOTTOM} 100%)`,
        fontFamily: 'var(--font-family)',
      }}
    >
      <TopBar onBack={onBack} onRefresh={() => { setSpinning(true); setRefreshTick((t) => t + 1); }} spinning={spinning} />

      <div style={{ maxWidth: 1080, margin: '0 auto', padding: '32px 24px 56px' }}>
        {loading && <SkeletonState />}

        {!loading && error && <ErrorState message={error} onRetry={() => setRefreshTick((t) => t + 1)} />}

        {!loading && !error && data && <Dashboard data={data} />}
      </div>
    </div>
  );
}

// ---- top bar ---------------------------------------------------------------

function TopBar({ onBack, onRefresh, spinning }: { onBack: () => void; onRefresh: () => void; spinning: boolean }) {
  return (
    <header
      style={{
        background: 'rgba(255,255,255,0.7)',
        backdropFilter: 'blur(10px)',
        borderBottom: `1px solid ${CARD_BORDER}`,
        padding: '0 24px',
        height: 68,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}
    >
      <button
        onClick={onBack}
        aria-label="Back"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 36,
          height: 36,
          borderRadius: 12,
          border: `1px solid ${CARD_BORDER}`,
          background: CARD,
          cursor: 'pointer',
          color: INK,
          flexShrink: 0,
        }}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
          <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15 }}>
        <div style={{ fontSize: 17, fontWeight: 800, color: INK, letterSpacing: -0.2 }}>Admin dashboard</div>
        <div style={{ fontSize: 12, color: INK_MUTED }}>Account &amp; usage overview</div>
      </div>

      <div style={{ flex: 1 }} />

      <button
        onClick={onRefresh}
        aria-label="Refresh"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          border: `1px solid ${CARD_BORDER}`,
          background: CARD,
          borderRadius: 12,
          padding: '8px 14px',
          cursor: 'pointer',
          fontSize: 13,
          fontWeight: 600,
          color: VIOLET,
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          style={{ transition: 'transform 0.6s ease', transform: spinning ? 'rotate(360deg)' : 'rotate(0deg)' }}
        >
          <path
            d="M21 12a9 9 0 11-2.64-6.36M21 3v6h-6"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        Refresh
      </button>
    </header>
  );
}

// ---- main dashboard ---------------------------------------------------------

function Dashboard({ data }: { data: AdminAnalytics }) {
  const activePct = data.totalUsers > 0 ? Math.round((data.loggedInLast24h / data.totalUsers) * 100) : 0;
  const freePct = data.totalUsers > 0 ? Math.round((data.freePlanUsers / data.totalUsers) * 100) : 0;
  const premiumPct = data.totalUsers > 0 ? Math.round((data.premiumUsers / data.totalUsers) * 100) : 0;

  return (
    <>
      {/* Hero row: headline stat + three pill stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.3fr) 1fr', gap: 18, marginBottom: 18 }}>
        <HeroCard totalUsers={data.totalUsers} generatedAt={data.generatedAt} />

        <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: 14 }}>
          <PillStat
            label="Free plan"
            value={data.freePlanUsers}
            sub={`${freePct}% of users`}
            color={BLUE}
            soft={BLUE_SOFT}
            icon={<UserIcon />}
          />
          <PillStat
            label="Premium (total)"
            value={data.premiumUsers}
            sub={`${premiumPct}% of users`}
            color={VIOLET}
            soft={VIOLET_SOFT}
            icon={<CrownIcon />}
          />
          <PillStat
            label="Docs created this week"
            value={data.documentsCreatedThisWeek}
            sub="across all accounts"
            color={TEAL}
            soft={TEAL_SOFT}
            icon={<DocIcon />}
          />
        </div>
      </div>

      {/* Second row: plan mix donut / monthly vs yearly bars / active users gauge */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        <PlanMixCard data={data} />
        <PremiumSplitCard data={data} />
        <ActiveUsersCard activePct={activePct} loggedIn={data.loggedInLast24h} total={data.totalUsers} />
      </div>

      <div style={{ marginTop: 20, fontSize: 12, color: INK_MUTED, textAlign: 'center' }}>
        Last updated {new Date(data.generatedAt).toLocaleString()}
      </div>
    </>
  );
}

// ---- hero card ---------------------------------------------------------------

function HeroCard({ totalUsers, generatedAt }: { totalUsers: number; generatedAt: string }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: `linear-gradient(135deg, ${VIOLET} 0%, #8B7CF0 55%, ${BLUE} 100%)`,
        borderRadius: 24,
        padding: '28px 28px',
        color: '#fff',
        boxShadow: '0 16px 36px rgba(109, 92, 224, 0.32)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        minHeight: 220,
      }}
    >
      {/* decorative blobs */}
      <div
        style={{
          position: 'absolute',
          right: -60,
          top: -60,
          width: 220,
          height: 220,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.10)',
        }}
      />
      <div
        style={{
          position: 'absolute',
          right: 30,
          bottom: -70,
          width: 160,
          height: 160,
          borderRadius: '50%',
          background: 'rgba(255,255,255,0.08)',
        }}
      />

      <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            background: 'rgba(255,255,255,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <UserIcon />
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, opacity: 0.9 }}>Total users</div>
      </div>

      <div style={{ position: 'relative' }}>
        <div style={{ fontSize: 48, fontWeight: 800, letterSpacing: -1, lineHeight: 1 }}>
          {totalUsers.toLocaleString()}
        </div>
        <div style={{ fontSize: 13, opacity: 0.85, marginTop: 8 }}>
          Every signed-in and anonymous account on record as of {new Date(generatedAt).toLocaleDateString()}
        </div>
      </div>
    </div>
  );
}

// ---- pill stat -----------------------------------------------------------

function PillStat({
  label,
  value,
  sub,
  color,
  soft,
  icon,
}: {
  label: string;
  value: number;
  sub: string;
  color: string;
  soft: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 20,
        padding: '14px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        boxShadow: SHADOW,
      }}
    >
      <div
        style={{
          width: 42,
          height: 42,
          borderRadius: 13,
          background: soft,
          color,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 12, color: INK_MUTED, fontWeight: 600 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color: INK, letterSpacing: -0.3, lineHeight: 1.3 }}>
          {value.toLocaleString()}
        </div>
      </div>
      <div style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 700, color, background: soft, padding: '4px 8px', borderRadius: 999, whiteSpace: 'nowrap' }}>
        {sub}
      </div>
    </div>
  );
}

// ---- card shell ------------------------------------------------------------

function CardShell({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div
      style={{
        background: CARD,
        border: `1px solid ${CARD_BORDER}`,
        borderRadius: 22,
        padding: '20px 22px',
        boxShadow: SHADOW,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: INK }}>{title}</div>
        {subtitle && <div style={{ fontSize: 11.5, color: INK_MUTED, marginTop: 2 }}>{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

// ---- plan mix donut --------------------------------------------------------

function PlanMixCard({ data }: { data: AdminAnalytics }) {
  const segments = useMemo(() => {
    const total = Math.max(data.freePlanUsers + data.premiumMonthly + data.premiumYearly, 1);
    const parts = [
      { label: 'Free', value: data.freePlanUsers, color: BLUE },
      { label: 'Monthly', value: data.premiumMonthly, color: VIOLET },
      { label: 'Yearly', value: data.premiumYearly, color: PINK },
    ];
    const r = 54;
    const circumference = 2 * Math.PI * r;
    let offset = 0;
    return parts.map((p) => {
      const frac = p.value / total;
      const dash = frac * circumference;
      const seg = { ...p, dash, gap: circumference - dash, offset, r, circumference, pct: Math.round(frac * 100) };
      offset -= dash;
      return seg;
    });
  }, [data]);

  return (
    <CardShell title="Plan mix" subtitle="Share of total users by plan">
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
          <g transform="translate(70,70) rotate(-90)">
            <circle r="54" fill="none" stroke={VIOLET_SOFT} strokeWidth="16" />
            {segments.map((s) =>
              s.dash > 0 ? (
                <circle
                  key={s.label}
                  r={s.r}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="16"
                  strokeDasharray={`${s.dash} ${s.gap}`}
                  strokeDashoffset={s.offset}
                  strokeLinecap="butt"
                />
              ) : null
            )}
          </g>
          <text x="70" y="66" textAnchor="middle" fontSize="20" fontWeight="800" fill={INK}>
            {data.totalUsers.toLocaleString()}
          </text>
          <text x="70" y="84" textAnchor="middle" fontSize="10" fill={INK_MUTED}>
            users
          </text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
          {segments.map((s) => (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 9, height: 9, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <span style={{ fontSize: 12.5, color: INK, flex: 1 }}>{s.label}</span>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{s.pct}%</span>
            </div>
          ))}
        </div>
      </div>
    </CardShell>
  );
}

// ---- premium monthly vs yearly bars ---------------------------------------

function PremiumSplitCard({ data }: { data: AdminAnalytics }) {
  const max = Math.max(data.premiumMonthly, data.premiumYearly, 1);
  const rows = [
    { label: 'Monthly', value: data.premiumMonthly, color: VIOLET, soft: VIOLET_SOFT },
    { label: 'Yearly', value: data.premiumYearly, color: PINK, soft: PINK_SOFT },
  ];

  return (
    <CardShell title="Premium subscriptions" subtitle="Monthly vs. yearly billing">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 22, justifyContent: 'center', flex: 1, paddingTop: 6 }}>
        {rows.map((r) => (
          <div key={r.label}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12.5 }}>
              <span style={{ color: INK, fontWeight: 600 }}>{r.label}</span>
              <span style={{ color: INK, fontWeight: 800 }}>{r.value.toLocaleString()}</span>
            </div>
            <div style={{ height: 10, borderRadius: 999, background: r.soft, overflow: 'hidden' }}>
              <div
                style={{
                  height: '100%',
                  width: `${Math.max((r.value / max) * 100, r.value > 0 ? 4 : 0)}%`,
                  borderRadius: 999,
                  background: r.color,
                  transition: 'width 0.5s ease',
                }}
              />
            </div>
          </div>
        ))}
        <div style={{ fontSize: 11.5, color: INK_MUTED, marginTop: 2 }}>
          {(data.premiumMonthly + data.premiumYearly).toLocaleString()} paying subscribers in total
        </div>
      </div>
    </CardShell>
  );
}

// ---- active users gauge -----------------------------------------------------

function ActiveUsersCard({ activePct, loggedIn, total }: { activePct: number; loggedIn: number; total: number }) {
  const r = 54;
  const circumference = 2 * Math.PI * r;
  const dash = (Math.min(activePct, 100) / 100) * circumference;

  return (
    <CardShell title="Active in last 24h" subtitle="Share of users with a live session">
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="140" height="140" viewBox="0 0 140 140" style={{ flexShrink: 0 }}>
          <g transform="translate(70,70) rotate(-90)">
            <circle r="54" fill="none" stroke={TEAL_SOFT} strokeWidth="16" />
            <circle
              r={r}
              fill="none"
              stroke={TEAL}
              strokeWidth="16"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeLinecap="round"
            />
          </g>
          <text x="70" y="66" textAnchor="middle" fontSize="22" fontWeight="800" fill={INK}>
            {activePct}%
          </text>
          <text x="70" y="84" textAnchor="middle" fontSize="10" fill={INK_MUTED}>
            active
          </text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: INK }}>{loggedIn.toLocaleString()}</div>
            <div style={{ fontSize: 11.5, color: INK_MUTED }}>logged in, last 24h</div>
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 800, color: INK }}>{total.toLocaleString()}</div>
            <div style={{ fontSize: 11.5, color: INK_MUTED }}>total users</div>
          </div>
        </div>
      </div>
    </CardShell>
  );
}

// ---- loading / error states ------------------------------------------------

function SkeletonState() {
  const shimmer: React.CSSProperties = {
    background: `linear-gradient(90deg, ${VIOLET_SOFT} 25%, #F7F5FF 37%, ${VIOLET_SOFT} 63%)`,
    backgroundSize: '400% 100%',
    animation: 'admin-shimmer 1.4s ease infinite',
    borderRadius: 20,
  };
  return (
    <>
      <style>{`@keyframes admin-shimmer { 0% { background-position: 100% 50%; } 100% { background-position: 0 50%; } }`}</style>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1.3fr) 1fr', gap: 18, marginBottom: 18 }}>
        <div style={{ ...shimmer, minHeight: 220 }} />
        <div style={{ display: 'grid', gridTemplateRows: 'repeat(3, 1fr)', gap: 14 }}>
          <div style={{ ...shimmer, minHeight: 60 }} />
          <div style={{ ...shimmer, minHeight: 60 }} />
          <div style={{ ...shimmer, minHeight: 60 }} />
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 18 }}>
        <div style={{ ...shimmer, minHeight: 200 }} />
        <div style={{ ...shimmer, minHeight: 200 }} />
        <div style={{ ...shimmer, minHeight: 200 }} />
      </div>
    </>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div
      style={{
        padding: 32,
        borderRadius: 22,
        background: PINK_SOFT,
        border: `1px solid rgba(240, 96, 155, 0.25)`,
        color: '#9C2A5D',
        textAlign: 'center',
      }}
    >
      <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Couldn't load analytics</div>
      <div style={{ fontSize: 13, marginBottom: 16 }}>{message}</div>
      <button
        onClick={onRetry}
        style={{
          border: 'none',
          background: PINK,
          color: '#fff',
          fontWeight: 700,
          fontSize: 13,
          padding: '9px 18px',
          borderRadius: 12,
          cursor: 'pointer',
        }}
      >
        Try again
      </button>
    </div>
  );
}

// ---- icons -------------------------------------------------------------

function UserIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <circle cx="12" cy="8" r="4" stroke="currentColor" strokeWidth="2" />
      <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function CrownIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path
        d="M3 8l4 3 5-6 5 6 4-3-2 10H5L3 8z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
      <path d="M7 3h7l5 5v13a1 1 0 01-1 1H7a1 1 0 01-1-1V4a1 1 0 011-1z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M14 3v5h5" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}