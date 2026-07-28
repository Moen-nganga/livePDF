import { useState, useRef, useEffect } from 'react';
import { api, type ChatMessage } from '../lib/api';
import { PremiumRequiredDialog } from './PremiumRequiredDialog';

interface Props {
  isPremium: boolean;
  /** Plain-text summary of the current document, if one is open -- omit on screens with no document (landing, auth, upgrade). */
  documentContext?: string;
  onRequirePremium: () => void;
}

export function AIChatWidget({ isPremium, documentContext, onRequirePremium }: Props) {
  const [open, setOpen] = useState(false);
  const [premiumPromptOpen, setPremiumPromptOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Keeps the floating button clear of the page footer (present on the
  // landing screen, id="app-footer") -- without this it sits fixed to the
  // viewport bottom and ends up hovering on top of the footer's text once
  // the person scrolls all the way down. Recomputed on scroll/resize
  // rather than once on mount since the footer only exists on some screens
  // and its position shifts as the page scrolls.
  const BASE_OFFSET = 20;
  const [bottomOffset, setBottomOffset] = useState(BASE_OFFSET);

  useEffect(() => {
    function updateOffset() {
      const footer = window.document.getElementById('app-footer');
      if (!footer) {
        setBottomOffset(BASE_OFFSET);
        return;
      }
      const visibleHeight = window.innerHeight - footer.getBoundingClientRect().top;
      setBottomOffset(visibleHeight > 0 ? BASE_OFFSET + visibleHeight : BASE_OFFSET);
    }
    updateOffset();
    window.addEventListener('scroll', updateOffset, { passive: true });
    window.addEventListener('resize', updateOffset);
    return () => {
      window.removeEventListener('scroll', updateOffset);
      window.removeEventListener('resize', updateOffset);
    };
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  function handleToggle() {
    if (!isPremium) {
      setPremiumPromptOpen(true);
      return;
    }
    setOpen((v) => !v);
  }

  async function handleSend() {
    const trimmed = input.trim();
    if (!trimmed || loading) return;

    const nextMessages: ChatMessage[] = [...messages, { role: 'user', text: trimmed }];
    setMessages(nextMessages);
    setInput('');
    setLoading(true);
    setError(null);

    try {
      const reply = await api.sendChatMessage(nextMessages, documentContext);
      setMessages((m) => [...m, { role: 'model', text: reply }]);
    } catch (err) {
      if (err instanceof Error && err.message === 'upgrade_required') {
        // Subscription could have lapsed between opening the widget and
        // sending a message -- the server is the real source of truth, so
        // defer to it even if the client thought isPremium was true.
        setOpen(false);
        setPremiumPromptOpen(true);
      } else {
        setError('Something went wrong. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div style={{ position: 'fixed', bottom: bottomOffset, right: 20, zIndex: 1500, transition: 'bottom 0.1s linear' }}>
        {open && (
          <div
            className="surface-card"
            style={{
              width: 320,
              height: 420,
              display: 'flex',
              flexDirection: 'column',
              marginBottom: 12,
              overflow: 'hidden',
              boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
            }}
          >
            <div
              style={{
                padding: '12px 14px',
                borderBottom: '1px solid var(--color-border)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 600 }}>Assistant</span>
              <button
                onClick={() => setOpen(false)}
                style={{ border: 'none', background: 'none', fontSize: 14, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div ref={scrollRef} style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
              {messages.length === 0 && (
                <p style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>
                  Ask me anything about using the editor, or about the document you're working on.
                </p>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                    marginBottom: 8,
                  }}
                >
                  <div
                    style={{
                      maxWidth: '80%',
                      padding: '8px 10px',
                      borderRadius: 10,
                      fontSize: 13,
                      lineHeight: 1.4,
                      background: m.role === 'user' ? 'var(--color-accent)' : '#f1f3f4',
                      color: m.role === 'user' ? 'white' : 'var(--color-text)',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {m.text}
                  </div>
                </div>
              ))}
              {loading && (
                <div style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>Thinking…</div>
              )}
              {error && <div style={{ fontSize: 12, color: '#dc2626' }}>{error}</div>}
            </div>

            <div style={{ padding: 10, borderTop: '1px solid var(--color-border)', display: 'flex', gap: 6 }}>
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                placeholder="Ask a question…"
                style={{
                  flex: 1,
                  padding: '8px 10px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 6,
                  fontSize: 13,
                }}
              />
              <button className="btn-accent" onClick={handleSend} disabled={loading || !input.trim()}>
                Send
              </button>
            </div>
          </div>
        )}

        <button
          onClick={handleToggle}
          title={isPremium ? 'Ask the assistant' : 'Ask the assistant (Premium)'}
          style={{
            height: 48,
            padding: '0 20px 0 16px',
            borderRadius: 24,
            border: 'none',
            background: 'var(--color-accent, #1a73e8)',
            color: 'white',
            fontSize: 14,
            fontWeight: 600,
            fontFamily: 'inherit',
            cursor: 'pointer',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <svg width="17" height="17" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path d="M8 1L14 6.2L8 15L2 6.2L8 1Z" fill="white" fillOpacity="0.95" />
            <path d="M8 1L14 6.2H2L8 1Z" fill="white" fillOpacity="0.35" />
          </svg>
          AI Assistant
        </button>
      </div>

      {premiumPromptOpen && (
        <PremiumRequiredDialog
          featureName="The AI assistant"
          onClose={() => setPremiumPromptOpen(false)}
          onUpgrade={() => {
            setPremiumPromptOpen(false);
            onRequirePremium();
          }}
        />
      )}
    </>
  );
}