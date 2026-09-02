import { StaticPageLayout, StaticSection } from './StaticPageLayout';

interface Props {
  onBack: () => void;
}

export function PrivacyPolicyScreen({ onBack }: Props) {
  return (
    <StaticPageLayout title="Privacy Policy" lastUpdated="August 31, 2026" onBack={onBack}>
      <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--color-text-secondary)' }}>
        This Privacy Policy explains what information livePDF ("we", "us", "our") collects when you use
        our document editor, and how we use, store, and protect it. By using livePDF, you agree to the
        practices described below.
      </p>

      <StaticSection title="1. Information We Collect">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Account information.</strong> You sign in to livePDF using your Google account. We
            receive your name, email address, and profile picture from Google. We never see or store
            your Google password.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Document content.</strong> The documents, pages, and objects you create are stored so
            you can access, edit, and download them later.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Payment information.</strong> If you subscribe to Premium, payments are processed by
            Stripe. We receive confirmation that a payment succeeded, but we never see or
            store your card number or wallet credentials.
          </li>
          <li>
            <strong>Usage information.</strong> Basic technical data, such as browser type and general
            feature usage, used to keep the product working and to improve it.
          </li>
        </ul>
      </StaticSection>

      <StaticSection title="2. How We Use Your Information">
        <p>We use the information above to:</p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>Provide, maintain, and sync your documents across sessions</li>
          <li>Authenticate you via Google Sign-In</li>
          <li>Process and manage Premium subscriptions</li>
          <li>Respond to support requests</li>
          <li>Improve the reliability and features of the editor</li>
        </ul>
      </StaticSection>

      <StaticSection title="3. The AI Assistant">
        <p>
          If you use the AI assistant, the portion of your document content relevant to your request is
          sent to our AI processing provider to generate a response. That content is used only to fulfill
          your request and is not used by us or our provider to train AI models. Don't use the AI
          assistant on documents containing information you don't want processed by a third-party AI
          system.
        </p>
      </StaticSection>

      <StaticSection title="4. Document Sharing">
        <p>
          If you generate a share link for a document, anyone with that link can view it. And, if you
          chose an "edit" link, modify it, without needing an account. Treat share links the way you'd
          treat a shared file: only send them to people you trust with the content.
        </p>
      </StaticSection>

      <StaticSection title="5. Data Storage, Security & Retention">
        <p>
          Your documents and account data are stored on secured servers. We use reasonable technical and
          organizational measures to protect your information, but no method of storage or transmission
          over the internet is 100% secure, and we can't guarantee absolute security. We retain your
          documents and account data for as long as your account is active. If you delete your account,
          we delete your documents and personal information within 30 days, except where we're required
          to keep records for legal, tax, or fraud-prevention purposes.
        </p>
      </StaticSection>

      <StaticSection title="6. Cookies & Local Storage">
        <p>
          We use a session cookie to keep you signed in, and local/offline storage in your browser so you
          can keep viewing your most recently opened document if you lose your connection. We don't use
          third-party advertising cookies.
        </p>
      </StaticSection>

      <StaticSection title="7. Third-Party Services">
        <p>
          We rely on a small number of third parties to operate livePDF, including Stripe and Binance Pay
          for payment processing, Google for account sign-in, and an AI processing provider for the AI
          assistant. Each of these providers has its own privacy policy governing how it handles data on
          our behalf.
        </p>
      </StaticSection>

      <StaticSection title="8. Your Privacy Rights">
        <p>
          Depending on where you live, you may have the right to request a copy of your personal
          information, ask us to correct it, ask us to delete it, or opt out of certain uses. We do not
          sell your personal information. You can exercise these rights at any time by contacting us at{' '}
          <strong>[privacy@livepdf.com]</strong>.
        </p>
      </StaticSection>

      <StaticSection title="9. Children's Privacy">
        <p>
          livePDF is not directed at children under 13, and we do not knowingly collect personal
          information from children under that age.
        </p>
      </StaticSection>

      <StaticSection title="10. Changes to This Policy">
        <p>
          We may update this policy from time to time. If we make material changes, we'll update the
          "Last updated" date above.
        </p>
      </StaticSection>

      <StaticSection title="11. Contact Us">
        <p>
          Questions about this policy or your data can be sent to <strong>[privacy@livepdf.com]</strong>.
        </p>
      </StaticSection>

      <p style={{ marginTop: 28, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        This is a template policy and should be reviewed by a lawyer before being relied on as your
        official privacy policy.
      </p>
    </StaticPageLayout>
  );
}