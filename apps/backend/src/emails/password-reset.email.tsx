// Sent when a super admin resets an organization account's password.
//
// The email carries a single-use, expiring link — never a password. A mailed
// password stays valid for as long as nobody changes it, which in practice is
// forever, and turns the mailbox itself into the credential. A token here dies
// on first use or at expiry, whichever comes first.
//
// The link is also never shown to the admin who triggered the reset. An admin
// who can read it can sign in as that organization and act as them inside an
// account holding other people's photos, with the audit trail showing the
// organization rather than the admin.
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface PasswordResetProps {
  name: string;
  resetUrl: string;
  expiresInHours: number;
}

export function PasswordResetEmail({ name, resetUrl, expiresInHours }: PasswordResetProps) {
  return (
    <EmailLayout
      preview="Set a new EventLens password"
      heading={`Set a new password, ${name}`}
      ctaLabel="Choose a new password"
      ctaUrl={resetUrl}
      footer="You received this email because an administrator reset the password on your EventLens account. If you weren't expecting this, contact us immediately."
    >
      <P>
        An EventLens administrator has reset the password on your account. Your old password no longer works, and
        anywhere you were already signed in has been signed out.
      </P>
      <P>
        Use the button below to choose a new one. The link works <strong>once</strong> and expires in{' '}
        <strong>{expiresInHours} hours</strong>. If it expires before you get to it, ask us to send another.
      </P>
      <P>
        If you did not expect this reset, please get in touch with us straight away rather than using the link — someone
        may have requested it on your behalf.
      </P>
    </EmailLayout>
  );
}

export const subject = () => 'Set a new EventLens password';
