// SelfieProcess found no face — ask for a clearer photo (docs/plan/07 §5).
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface NoFaceProps {
  eventName: string;
  eventUrl: string;
}

export function NoFaceDetectedEmail({ eventName, eventUrl }: NoFaceProps) {
  return (
    <EmailLayout
      preview="We couldn't detect a face in your selfie"
      heading="We couldn't detect a face in your selfie"
      ctaLabel="Try again"
      ctaUrl={eventUrl}
      footer="You received this email because you submitted a selfie at this event."
    >
      <P>
        Thanks for signing up for your photos from {eventName} — unfortunately we couldn't find a clear face in the
        selfie you submitted.
      </P>
      <P>Please try again with a well-lit, front-facing photo without sunglasses or masks.</P>
    </EmailLayout>
  );
}

export const subject = () => `We couldn't detect a face in your selfie`;
