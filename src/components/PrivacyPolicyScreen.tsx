import { StaticPageLayout, StaticSection } from './StaticPageLayout';

interface Props {
  onBack: () => void;
}

export function PrivacyPolicyScreen({ onBack }: Props) {
  return (
    <StaticPageLayout title="Privacy Policy" lastUpdated="July 28, 2026" onBack={onBack}>
      <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--color-text-secondary)' }}>
        This Privacy Policy explains what information livePDF ("we", "us", "our") collects when you use
        our document editor, and how we use, store, and protect it. By using livePDF, you agree to the
        practices described below.
      </p>

      <StaticSection title="1. Information We Collect">
        <ul style={{ margin: 0, paddingLeft: 20 }}>
          <li style={{ marginBottom: 6 }}>
            <strong>Account information.</strong> When you sign in, we collect the email address you use
            for your one-time magic sign-in link.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Document content.</strong> The documents, pages, and objects you create are stored so
            you can access, edit, and download them later.
          </li>
          <li style={{ marginBottom: 6 }}>
            <strong>Payment information.</strong> If you subscribe to Premium, payments are processed by
            Stripe. We receive confirmation that a payment succeeded, but we never see or store your
            card number.
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
          <li>Authenticate you via magic sign-in links</li>
          <li>Authenticate user accounts</li>
          <li>Process and manage Premium subscriptions</li>
          <li>Respond to support requests</li>
          <li>Improve the reliability and features of the editor</li>
        </ul>
      </StaticSection>

      <StaticSection title="3. Document Sharing">
        <p>
          If you generate a share link for a document, anyone with that link can view it — and, if you
          chose an "edit" link, modify it — without needing an account. Treat share links the way you'd
          treat a shared file: only send them to people you trust with the content.
        </p>
      </StaticSection>

      <StaticSection title="4. Data Storage & Security">
        <p>
          Your documents and account data are stored on secured servers. We use reasonable technical and
          organizational measures to protect your information, but no method of storage or transmission
          over the internet is 100% secure, and we can't guarantee absolute security.
        </p>
      </StaticSection>

      <StaticSection title="5. Cookies & Local Storage">
        <p>
          We use a session cookie to keep you signed in, and local/offline storage in your browser so you
          can keep viewing your most recently opened document if you lose your connection. We don't use
          third-party advertising cookies.
        </p>
      </StaticSection>

      <StaticSection title="6. Third-Party Services">
        <p>
          We rely on a small number of third parties to operate livePDF, including Stripe for payment
          processing and an email provider for delivering sign-in links. Each of these providers has its
          own privacy policy governing how it handles data on our behalf.
        </p>
      </StaticSection>

      <StaticSection title="7. Your Rights">
        <p>
          You can request a copy of your account data, ask us to correct it, or ask us to delete your
          account and associated documents at any time. A dedicated Contact page is coming soon — in the
          meantime, requests can be sent from your account email.
        </p>
      </StaticSection>

      <StaticSection title="8. Children's Privacy">
        <p>
          livePDF is not directed at children under 13, and we do not knowingly collect personal
          information from children under that age.
        </p>
      </StaticSection>

      <StaticSection title="9. Changes to This Policy">
        <p>
          We may update this policy from time to time. If we make material changes, we'll update the
          "Last updated" date above.
        </p>
      </StaticSection>

      <p style={{ marginTop: 28, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        This is a template policy and should be reviewed by a lawyer before being relied on as your
        official privacy policy.
      </p>
    </StaticPageLayout>
  );
}