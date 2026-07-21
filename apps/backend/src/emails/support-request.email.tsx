// Internal notification to the support inbox. Unlike the participant emails
// this one goes to us, not to a customer, so it optimises for triage: who,
// where from, and the message verbatim.
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface SupportRequestProps {
  source: 'organization' | 'public';
  message: string;
  // Best available identity. Public submissions may have neither.
  name?: string | null;
  email?: string | null;
  orgName?: string | null;
  eventName?: string | null;
  adminUrl: string;
}

export function SupportRequestEmail({ source, message, name, email, orgName, eventName, adminUrl }: SupportRequestProps) {
  const who = name || email || 'Anonymous';

  return (
    <EmailLayout
      preview={`New ${source} support request from ${who}`}
      heading="New support request"
      ctaLabel="Open in admin"
      ctaUrl={adminUrl}
      footer="Sent automatically by EventLens when someone submits the Help form."
    >
      <P>
        <strong>From:</strong> {who}
        {email ? ` (${email})` : ''}
      </P>
      <P>
        <strong>Source:</strong> {source === 'organization' ? 'Organiser' : 'Public page'}
        {orgName ? ` · ${orgName}` : ''}
        {eventName ? ` · ${eventName}` : ''}
      </P>
      <P>{message}</P>
    </EmailLayout>
  );
}

export const subject = ({ source, name, email }: SupportRequestProps) =>
  `[EventLens support] ${source === 'organization' ? 'Organiser' : 'Public'} request from ${name || email || 'anonymous'}`;
