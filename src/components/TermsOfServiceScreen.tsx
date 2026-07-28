import { StaticPageLayout, StaticSection } from './StaticPageLayout';

interface Props {
  onBack: () => void;
}

export function TermsOfServiceScreen({ onBack }: Props) {
  return (
    <StaticPageLayout title="Terms of Service" lastUpdated="July 28, 2026" onBack={onBack}>
      <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--color-text-secondary)' }}>
        These Terms of Service ("Terms") govern your use of livePDF. By creating an account or using the
        editor, you agree to these Terms.
      </p>

      <StaticSection title="1. The Service">
        <p>
          livePDF is a browser-based tool for creating, editing, and downloading PDF documents, including
          templates, text and shape tools, image and signature insertion, document sharing, and an AI
          assistant.
        </p>
      </StaticSection>

      <StaticSection title="2. Your Account">
        <p>
          You're responsible for keeping access to your sign-in email secure and for all activity that
          happens under your account. Sign-in uses a one-time magic link sent to your email — don't
          forward that link to anyone else.
        </p>
      </StaticSection>

      <StaticSection title="3. Free & Premium Plans">
        <p>
          The free plan includes a limited number of document saves per week, and PDFs are 
          capped to only 20 pages per week. Premium plans (billed monthly or yearly) remove that 
          limit and unlock premium templates, signatures, and the AI assistant.
        </p>
        <p style={{ marginTop: 8 }}>
          Premium subscriptions are billed in advance through Stripe or Binance Pay. 
        </p>
      </StaticSection>

      <StaticSection title="4. Your Content">
        <p>
          You own the documents you create in livePDF. By using the service, you grant us a limited
          license to store, process, and display that content solely as needed to provide the editor to
          you — for example, saving it, rendering it on the canvas, or generating the PDF you download.
        </p>
      </StaticSection>

      <StaticSection title="5. Acceptable Use">
        <p>You agree not to use livePDF to:</p>
        <ul style={{ margin: '8px 0 0', paddingLeft: 20 }}>
          <li>Create or share unlawful, fraudulent, or infringing content</li>
          <li>Upload malware or attempt to disrupt the service</li>
          <li>Use share links to distribute harmful or abusive content</li>
          <li>Attempt to bypass usage limits or subscription gating</li>
        </ul>
      </StaticSection>

      <StaticSection title="6. Service Availability">
        <p>
          livePDF is provided on an "as is" and "as available" basis. We aim for high reliability but
          don't guarantee the service will be uninterrupted or error-free.
        </p>
      </StaticSection>

      <StaticSection title="7. Disclaimer & Limitation of Liability">
        <p>
          To the fullest extent permitted by law, livePDF is provided without warranties of any kind, and
          our liability for any claim relating to the service is limited to the amount you paid us in the
          12 months before the claim arose.
        </p>
      </StaticSection>

      <StaticSection title="8. Changes to These Terms">
        <p>
          We may update these Terms from time to time. Continuing to use livePDF after a change means you
          accept the updated Terms.
        </p>
      </StaticSection>

      <p style={{ marginTop: 28, fontSize: 12, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
        This is a template Terms of Service and should be reviewed by a lawyer before being relied on as
        your official terms.
      </p>
    </StaticPageLayout>
  );
}