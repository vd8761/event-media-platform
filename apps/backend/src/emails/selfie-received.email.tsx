// Sent the moment a selfie is accepted, before any matching has run. Carries
// the same tokenized gallery link as every later email: the link is live
// immediately and tells the participant where their request stands, so they
// never have to wait on an email to find out what is happening.
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface SelfieReceivedProps {
  eventName: string;
  galleryUrl: string;
}

export function SelfieReceivedEmail({ eventName, galleryUrl }: SelfieReceivedProps) {
  return (
    <EmailLayout
      preview={`We received your selfie for ${eventName}`}
      heading={`We got your selfie for ${eventName} 👋`}
      ctaLabel="Check my photos"
      ctaUrl={galleryUrl}
      footer="You received this email because you submitted a selfie at this event. This link is private to you — please don't share it."
    >
      <P>
        Thanks! We're looking through the event photos for you now. This usually takes a few minutes, and longer while
        photographers are still uploading.
      </P>
      <P>
        The link below is your personal page. Open it any time: it will show that we're still looking, and turn into your
        photo gallery as soon as we find you.
      </P>
    </EmailLayout>
  );
}

export const subject = ({ eventName }: SelfieReceivedProps) => `We received your selfie for ${eventName}`;
