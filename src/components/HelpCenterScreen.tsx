import { useState } from 'react';
import { StaticPageLayout } from './StaticPageLayout';

interface Props {
  onBack: () => void;
}

interface FaqGroup {
  heading: string;
  items: { q: string; a: string }[];
}

const FAQ_GROUPS: FaqGroup[] = [
  {
    heading: 'Getting started',
    items: [
      {
        q: 'How do I create a new document?',
        a: 'From the home screen, pick a template or choose "Blank document" under Start a new document. Your document opens straight into the editor and starts autosaving.',
      },
      {
        q: 'Do I need an account?',
        a: "You can create and edit documents without signing in. Signing in through your Google account lets your documents sync and lets you subscribe to Premium.",
      },
    ],
  },
  {
    heading: 'Saving & documents',
    items: [
      {
        q: 'Does livePDF save my work automatically?',
        a: 'Yes, changes are saved automatically about a second after you stop editing. You can see the current save status in the top-right of the editor.',
      },
      {
        q: 'Why does it say "Weekly limit reached"?',
        a: 'Free accounts can save a limited number of documents per week. Upgrading to Premium removes this limit and allows you to edit as many documents as you want.',
      },
      {
        q: 'Can I use livePDF offline?',
        a: "Your most recently opened document is cached for offline viewing. Editing while offline isn't saved until you're back online.",
      },
    ],
  },
  {
    heading: 'Templates',
    items: [
      {
        q: 'What templates are available?',
        a: 'Free templates include Blank document, Resume/CV, Invoice, Letter, Meeting notes, Report cover page, and Certificate. Click "More templates" on the landing screen to see additional templates.',
      },
      {
        q: 'Why are some templates locked?',
        a: 'Templates marked PREMIUM require an active Premium subscription. You can still preview them — upgrading unlocks them instantly.',
      },
    ],
  },
  {
    heading: 'Sharing',
    items: [
      {
        q: 'How do I share a document?',
        a: 'Use the File menu to generate a share link. You can choose whether people with the link can only view the document, or also edit it.',
      },
      {
        q: 'Can I stop sharing later?',
        a: 'Yes, share links can be revoked from the File menu at any time.',
      },
    ],
  },
  {
    heading: 'Premium & billing',
    items: [
      {
        q: 'What does Premium include?',
        a: 'Premium removes the weekly save limit, removes the 20-pages per PDF cap, and unlocks premium templates, the signature tool, and the AI assistant.',
      },
      {
        q: 'What payment methods are supported?',
        a: 'We support card payments via Stripe.',
      },
    ],
  },
  {
    heading: 'Editing tools',
    items: [
      {
        q: 'How do I add a signature?',
        a: 'Click "+ Signature" in the toolbar (a Premium feature) to draw or type a signature, which is inserted as an image you can move and resize.',
      },
      {
        q: 'How do I check spelling?',
        a: 'Click "Check Spelling" in the toolbar to scan every text box in the document and jump straight to any misspelled words.',
      },
    ],
  },
];

export function HelpCenterScreen({ onBack }: Props) {
  return (
    <StaticPageLayout title="Help Center" onBack={onBack}>
      <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--color-text-secondary)', marginBottom: 0 }}>
        Answers to common questions about using livePDF. Can't find what you need? The Contact page is
        coming soon.
      </p>

      {FAQ_GROUPS.map((group) => (
        <div key={group.heading} style={{ marginTop: 28 }}>
          <h2 style={{ fontSize: 15, fontWeight: 600, color: 'var(--color-text)', margin: '0 0 6px' }}>
            {group.heading}
          </h2>
          {group.items.map((item) => (
            <FaqItem key={item.q} question={item.q} answer={item.a} />
          ))}
        </div>
      ))}
    </StaticPageLayout>
  );
}

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div style={{ borderTop: '1px solid var(--color-border)' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '12px 0',
          border: 'none',
          background: 'transparent',
          textAlign: 'left',
          cursor: 'pointer',
          fontSize: 14,
          fontWeight: 500,
          color: 'var(--color-text)',
        }}
      >
        {question}
        <svg
          width="11" height="11" viewBox="0 0 10 10" fill="none" aria-hidden="true"
          style={{
            flexShrink: 0,
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.15s ease',
            color: 'var(--color-text-muted)',
          }}
        >
          <path d="M1.5 3.5L5 7L8.5 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
      {open && (
        <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.7, color: 'var(--color-text-secondary)' }}>
          {answer}
        </p>
      )}
    </div>
  );
}