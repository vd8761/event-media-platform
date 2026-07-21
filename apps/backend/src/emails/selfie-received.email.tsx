// Sent the moment a selfie is accepted, before any matching has run. Carries
// the same tokenized gallery link as every later email: the link is live
// immediately and tells the participant where their request stands, so they
// never have to wait on an email to find out what is happening.
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface SelfieReceivedProps {
  eventName: string;
  galleryUrl: string;
  // Absent when the organizer set no expiry — then the link simply does not
  // expire, and saying nothing is more honest than inventing a date.
  expiresAt?: Date | string | null;
}

// Deliberately a date rather than a countdown: emails are read hours or days
// after they are sent, so "expires in 7 days" would age into a lie.
const formatExpiry = (value: Date | string) =>
  new Date(value).toLocaleString('en-GB', {
    dateStyle: 'long',
    timeStyle: 'short',
    timeZone: 'UTC',
  });

export function SelfieReceivedEmail({ eventName, galleryUrl, expiresAt }: SelfieReceivedProps) {
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
      {expiresAt ? (
        <P>
          <strong>Your link stays open until {formatExpiry(expiresAt)} (UTC).</strong> After that the gallery closes, so
          please download anything you'd like to keep before then.
        </P>
      ) : null}
    </EmailLayout>
  );
}

export const subject = ({ eventName }: SelfieReceivedProps) => `We received your selfie for ${eventName}`;
