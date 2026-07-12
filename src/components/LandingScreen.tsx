import React, { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import { useEditorStore } from '../store/editorStore';
import { useAuthStore } from '../store/authStore';
import { TEMPLATES, type TemplateDefinition } from '../lib/templates';
import { api, type DocumentSummary } from '../lib/api';
import { LoginDialog } from './LoginDialog';

interface Props {
  onEnter: () => void;
}

export function LandingScreen({ onEnter }: Props) {
  const loadDocument = useEditorStore((s) => s.loadDocument);
  const [recent, setRecent] = useState<DocumentSummary[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);
  const [creating, setCreating] = useState<string | null>(null);

  const authUser = useAuthStore((s) => s.user);
  const authStatus = useAuthStore((s) => s.status);
  const fetchMe = useAuthStore((s) => s.fetchMe);
  const logout = useAuthStore((s) => s.logout);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);

  useEffect(() => {
    api.listDocuments()
      .then((docs) => setRecent(docs.slice(0, 6)))
      .catch(() => setRecent([]))
      .finally(() => setLoadingRecent(false));
  }, []);

  // The landing screen can be the very first thing a user sees, so check
  // session status here too — App.tsx's own fetchMe() call covers the case
  // where a document is already open, but that effect doesn't run before
  // this component mounts if the app boots straight into the landing screen.
  useEffect(() => {
    if (authStatus === 'idle') fetchMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openTemplate(template: TemplateDefinition) {
    if (creating) return;
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
    } catch {
      // Backend save failed — still open the doc locally, autosave will retry
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
    try {
      const doc = await api.getDocument(summary.id);
      loadDocument(doc);
      onEnter();
    } catch {
      alert('Could not open that document. It may have been deleted.');
      setRecent((r) => r.filter((d) => d.id !== summary.id));
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(160deg, #f0f4ff 0%, #f0f2f5 50%, #f5f0f8 100%)',
      fontFamily: 'var(--font-family)',
      overflowY: 'auto',
    }}>
      {/* ── Top bar ────────────────────────────────────── */}
      <header style={{
        background: 'var(--color-surface)',
        borderBottom: '1.5px solid var(--color-border)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.07)',
        padding: '0 40px',
        height: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'sticky',
        top: 0,
        zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="#1a73e8" />
            <rect x="8" y="9" width="16" height="2.2" rx="1.1" fill="white" />
            <rect x="8" y="14" width="16" height="2.2" rx="1.1" fill="white" />
            <rect x="8" y="19" width="11" height="2.2" rx="1.1" fill="white" />
            <rect x="8" y="24" width="7" height="2" rx="1" fill="white" fillOpacity="0.7" />
          </svg>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--color-text)', lineHeight: 1.2 }}>
              PDF Editor
            </div>
            <div style={{ fontSize: 10, color: 'var(--color-text-muted)', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
              Document Studio
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
            Your documents are saved automatically
          </div>
          {authStatus === 'authenticated' && authUser ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>{authUser.email}</span>
              <button
                onClick={() => logout()}
                style={{
                  fontSize: 12,
                  padding: '6px 14px',
                  borderRadius: 20,
                  border: '1.5px solid var(--color-border)',
                  background: 'transparent',
                  cursor: 'pointer',
                }}
              >
                Sign out
              </button>
            </div>
          ) : (
            <button
              onClick={() => setLoginDialogOpen(true)}
              style={{
                fontSize: 12,
                fontWeight: 500,
                padding: '6px 16px',
                borderRadius: 20,
                border: '1.5px solid var(--color-accent)',
                background: 'transparent',
                color: 'var(--color-accent)',
                cursor: 'pointer',
              }}
            >
              Sign in
            </button>
          )}
        </div>
      </header>

      {loginDialogOpen && <LoginDialog onClose={() => setLoginDialogOpen(false)} />}

      {/* ── Main content ───────────────────────────────── */}
      <div style={{ maxWidth: 1020, margin: '0 auto', padding: '44px 28px 100px' }}>

        {/* ── Templates section ──────────────────────── */}
        <div style={{
          background: 'var(--color-surface)',
          border: '1.5px solid var(--color-border)',
          borderRadius: 14,
          boxShadow: '0 2px 12px rgba(0,0,0,0.06)',
          marginBottom: 28,
          overflow: 'hidden',
        }}>
          {/* Section header */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '18px 24px 16px',
            borderBottom: '1.5px solid var(--color-border)',
            background: 'linear-gradient(to right, #fafbff, #ffffff)',
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                Start a new document
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Choose a template or start from scratch
              </div>
            </div>
            <div style={{
              fontSize: 11,
              fontWeight: 500,
              color: 'var(--color-accent)',
              background: 'var(--color-accent-bg)',
              padding: '4px 10px',
              borderRadius: 12,
            }}>
              {TEMPLATES.length} templates
            </div>
          </div>

          {/* Template grid */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
            gap: 20,
            padding: '24px',
          }}>
            {TEMPLATES.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                loading={creating === template.id}
                onClick={() => openTemplate(template)}
              />
            ))}
          </div>
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
            padding: '18px 24px 16px',
            borderBottom: '1.5px solid var(--color-border)',
            background: 'linear-gradient(to right, #fafbff, #ffffff)',
          }}>
            <div>
              <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)' }}>
                Recent documents
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 2 }}>
                Pick up where you left off
              </div>
            </div>
            {recent.length > 0 && (
              <div style={{
                fontSize: 11,
                fontWeight: 500,
                color: 'var(--color-text-muted)',
                background: '#f1f3f4',
                padding: '4px 10px',
                borderRadius: 12,
              }}>
                {recent.length} document{recent.length !== 1 ? 's' : ''}
              </div>
            )}
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
                No recent documents yet
              </div>
              <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                Create a document above and it will appear here next time.
              </div>
            </div>
          )}

          {!loadingRecent && recent.length > 0 && (
            <div>
              {/* Table header row */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '1fr 140px 120px',
                padding: '8px 24px',
                background: '#f8f9fa',
                borderBottom: '1px solid var(--color-border)',
              }}>
                {['Document', 'Last modified', 'Actions'].map((h) => (
                  <div key={h} style={{ fontSize: 11, fontWeight: 600, color: 'var(--color-text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                    {h}
                  </div>
                ))}
              </div>
              {/* Document rows */}
              {recent.map((doc, i) => (
                <RecentCard
                  key={doc.id}
                  doc={doc}
                  isLast={i === recent.length - 1}
                  onClick={() => openRecent(doc)}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  loading,
  onClick,
}: {
  template: TemplateDefinition;
  loading: boolean;
  onClick: () => void;
}) {
  const [hovered, setHovered] = useState(false);

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
        {loading && (
          <div style={{
            position: 'absolute', inset: 0,
            background: 'rgba(255,255,255,0.7)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, color: 'var(--color-text-secondary)',
          }}>
            Creating…
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
    case 'blank':       return <BlankThumbnail />;
    case 'resume':      return <ResumeThumbnail />;
    case 'invoice':     return <InvoiceThumbnail />;
    case 'letter':      return <LetterThumbnail />;
    case 'meeting':     return <MeetingThumbnail />;
    case 'report':      return <ReportThumbnail />;
    case 'certificate': return <CertificateThumbnail />;
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

function RecentCard({ doc, isLast, onClick }: { doc: DocumentSummary; isLast: boolean; onClick: () => void }) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 120px',
        alignItems: 'center',
        padding: '14px 24px',
        borderBottom: isLast ? 'none' : '1px solid var(--color-border)',
        background: hovered ? '#f8faff' : 'transparent',
        transition: 'background 0.12s ease',
        cursor: 'pointer',
      }}
      onClick={onClick}
    >
      {/* Name + icon */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, overflow: 'hidden' }}>
        <div style={{
          width: 36, height: 44, flexShrink: 0,
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
        <span style={{
          fontSize: 13, fontWeight: 500, color: 'var(--color-text)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
        }}>
          {doc.title || 'Untitled document'}
        </span>
      </div>

      {/* Last modified */}
      <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
        {formatAgo(doc.updatedAt)}
      </div>

      {/* Open button */}
      <div>
        <button
          onClick={(e) => { e.stopPropagation(); onClick(); }}
          style={{
            fontSize: 12,
            padding: '5px 14px',
            borderRadius: 20,
            border: '1.5px solid var(--color-accent)',
            background: hovered ? 'var(--color-accent)' : 'transparent',
            color: hovered ? 'white' : 'var(--color-accent)',
            fontWeight: 500,
            transition: 'background 0.15s ease, color 0.15s ease',
            cursor: 'pointer',
          }}
        >
          Open
        </button>
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