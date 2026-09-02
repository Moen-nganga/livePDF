import { StaticPageLayout, StaticSection } from './StaticPageLayout';

interface Props {
  onBack: () => void;
}

export function TermsOfServiceScreen({ onBack }: Props) {
  return (
    <StaticPageLayout title="Terms of Service" lastUpdated="August 31, 2026" onBack={onBack}>
      <p style={{ fontSize: 14, lineHeight: 1.75, color: 'var(--color-text-secondary)' }}>
        These Terms of Service govern your use of livePDF, operated by {'livePDF staff'}.
        By creating an account or using the editor, you agree to
        these Terms.
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
          You sign in to livePDF using your Google account. You're responsible for keeping that Google
          account secure and for all activity that happens under your livePDF account. If you lose
          access to your Google account, you may lose access to your livePDF account as well.
        </p>
      </StaticSection>

      <StaticSection title="3. Free & Premium Plans">
        <p>
          The free plan includes a limited number of document saves per week, and PDFs are
          capped to only 20 pages per week. Premium plans (billed monthly or yearly) remove that
          limit and unlock premium templates, signatures, the spell checking feature, and the AI assistant.
        </p>
        <p style={{ marginTop: 8 }}>
          Premium subscriptions are billed in advance through Stripe. Subscriptions
          renew automatically at the end of each billing period unless you cancel before the renewal
          date. You can cancel anytime from your account settings; cancellation takes effect at the end
          of the current billing period, and we don't provide prorated refunds for partial periods.
          Payments made via Binance Pay are settled in cryptocurrency and, due to the nature of
          blockchain transactions, are final and cannot be reversed once confirmed.
        </p>
      </StaticSection>

      <StaticSection title="4. Your Content">
        <p>
          You own the documents you create in livePDF. By using the service, you grant us a limited
          license to store, process, and display that content solely as needed to provide the editor to
          you — for example, saving it, rendering it on the canvas, generating the PDF you download, or
          processing it through the AI assistant when you choose to use that feature.
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

      <StaticSection title="6. Copyright Complaints (DMCA)">
        <p>
          If you believe content stored or shared through livePDF infringes your copyright, send a
          notice to <strong>[reports@livepdf.com]</strong> including a description of the work, the location
          of the material, and your contact information. We'll respond in accordance with the Digital
          Millennium Copyright Act, which may include removing or disabling access to the content.
        </p>
      </StaticSection>

      <StaticSection title="7. Suspension & Termination">
        <p>
          We may suspend or terminate your access to livePDF if you violate these Terms or misuse the
          service. You can stop using livePDF and delete your
          account at any time. Sections of these Terms that by their nature should survive termination
          (such as limitation of liability) will continue to apply.
        </p>
      </StaticSection>

      <StaticSection title="8. Service Availability">
        <p>
          livePDF is provided on an "as is" and "as available" basis. We aim for high reliability but
          don't guarantee the service will be uninterrupted or error-free.
        </p>
      </StaticSection>

      <StaticSection title="9. Disclaimer & Limitation of Liability">
        <p>
          To the fullest extent permitted by law, livePDF is provided without warranties of any kind, and
          our liability for any claim relating to the service is limited to the amount you paid us in the
          12 months before the claim arose.
        </p>
      </StaticSection>

      <StaticSection title="10. Governing Law">
        <p>
          These Terms are governed by the laws of the State of <strong>Michigan</strong>, United
          States, without regard to conflict-of-law principles. Any disputes will be resolved in the
          state or federal courts located in <strong>Michigan</strong>, and you consent to that
          jurisdiction.
        </p>
      </StaticSection>

      <StaticSection title="11. Changes to These Terms">
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