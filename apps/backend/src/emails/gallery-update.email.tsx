// Digest — new matches after the first notification (docs/plan/07 §5).
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface GalleryUpdateProps {
  eventName: string;
  newCount: number;
  galleryUrl: string;
}

export function GalleryUpdateEmail({ eventName, newCount, galleryUrl }: GalleryUpdateProps) {
  return (
    <EmailLayout
      preview={`${newCount} new photos of you at ${eventName}`}
      heading={`${newCount === 1 ? 'A new photo' : `${newCount} new photos`} of you at ${eventName}`}
      ctaLabel="See what's new"
      ctaUrl={galleryUrl}
      footer="You received this email because you submitted a selfie at this event. We bundle updates so you never get more than a few emails."
    >
      <P>
        More photos from {eventName} have been processed and {newCount === 1 ? 'one of them features' : `${newCount} of them feature`} you.
      </P>
      <P>Your personal gallery has been updated.</P>
    </EmailLayout>
  );
}

export const subject = ({ newCount, eventName }: GalleryUpdateProps) =>
  `${newCount} new photo${newCount === 1 ? '' : 's'} of you at ${eventName}`;
