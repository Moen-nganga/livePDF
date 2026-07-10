import { Resend } from 'resend';

const resend = new Resend(process.env.RESEND_API_KEY);

// Must be a domain you've verified in Resend's dashboard. Using an
// unverified "from" address will make Resend reject the send (or land in
// spam), so this is worth double-checking against your Resend setup before
// relying on it in production.
const FROM_ADDRESS = process.env.EMAIL_FROM ?? 'PDF Editor <noreply@yourdomain.com>';

export async function sendMagicLinkEmail(email: string, link: string): Promise<void> {
  const { error } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: email,
    subject: 'Your sign-in link',
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2>Sign in to PDF Editor</h2>
        <p>Click the button below to sign in. This link expires in 15 minutes and can only be used once.</p>
        <p style="margin: 24px 0;">
          <a href="${link}" style="background: #2563eb; color: #fff; padding: 12px 24px; border-radius: 6px; text-decoration: none; display: inline-block;">
            Sign in
          </a>
        </p>
        <p style="color: #666; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });

  if (error) {
    // Surfaced to the caller so the /request-link route can return a 500
    // instead of silently telling the user "check your email" when it
    // never sent.
    throw new Error(`Failed to send magic link email: ${error.message}`);
  }
}