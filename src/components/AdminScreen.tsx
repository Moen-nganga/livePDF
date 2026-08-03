import { useEffect, useState } from 'react';
import { api, type AdminAnalytics } from '../lib/api';

interface Props {
  onBack: () => void;
}

// Simple analytics dashboard for admin accounts. Mirrors the "onBack calls
// history.back()" pattern used by AuthScreen/UpgradeScreen/etc. so this
// screen plugs into LandingScreen's existing history.state.landingSub
// back/forward handling without needing its own popstate listener.
export function AdminScreen({ onBack }: Props) {
  const [data, setData] = useState<AdminAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', background: '#f5f6f8', fontFamily: 'var(--font-family)' }}>
      <header
        style={{
          background: 'var(--color-surface)',
          borderBottom: '1.5px solid var(--color-border)',
          padding: '0 24px',
          height: 60,
          display: 'flex',
          alignItems: 'center',
          gap: 16,
        }}
      >
        <button
          onClick={onBack}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            fontSize: 13,
            color: 'var(--color-text-secondary)',
            padding: '6px 8px',
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back
        </button>
        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)' }}>Admin Dashboard</div>
      </header>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
        {loading && (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Loading analytics…
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              padding: 20,
              borderRadius: 10,
              background: '#fef2f2',
              border: '1.5px solid #fecaca',
              color: '#b91c1c',
              fontSize: 13,
            }}
          >
            {error}
          </div>
        )}

        {!loading && !error && data && (
          <>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                gap: 16,
                marginBottom: 24,
              }}
            >
              <StatCard label="Total users" value={data.totalUsers} />
              <StatCard label="Logged in (24h)" value={data.loggedInLast24h} />
              <StatCard label="Free plan" value={data.freePlanUsers} />
              <StatCard label="Premium (total)" value={data.premiumUsers} accent />
              <StatCard label="Premium monthly" value={data.premiumMonthly} />
              <StatCard label="Premium yearly" value={data.premiumYearly} />
              <StatCard label="Docs created this week" value={data.documentsCreatedThisWeek} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
              Last updated: {new Date(data.generatedAt).toLocaleString()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: number; accent?: boolean }) {
  return (
    <div
      style={{
        background: 'var(--color-surface)',
        border: '1.5px solid var(--color-border)',
        borderRadius: 12,
        padding: '18px 20px',
        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
      }}
    >
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 6 }}>{label}</div>
      <div
        style={{
          fontSize: 26,
          fontWeight: 700,
          color: accent ? 'var(--color-accent)' : 'var(--color-text)',
        }}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}