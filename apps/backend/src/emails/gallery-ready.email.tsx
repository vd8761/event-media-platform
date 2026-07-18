// First match(es) for a participant (docs/plan/07 §5). No media URLs — only
// the tokenized gallery link (presigned URLs would be dead within an hour).
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface GalleryReadyProps {
  eventName: string;
  matchCount: number;
  galleryUrl: string;
}

export function GalleryReadyEmail({ eventName, matchCount, galleryUrl }: GalleryReadyProps) {
  return (
    <EmailLayout
      preview={`Your photos from ${eventName} are ready`}
      heading={`Your photos from ${eventName} are ready 📸`}
      ctaLabel="Open my gallery"
      ctaUrl={galleryUrl}
      footer="You received this email because you submitted a selfie at this event. The gallery keeps updating as more photos are processed."
    >
      <P>
        Great news — we found {matchCount === 1 ? 'a photo' : `${matchCount} photos`} of you at {eventName}.
      </P>
      <P>Open your personal gallery to view and download them. The link is private to you.</P>
    </EmailLayout>
  );
}

export const subject = ({ eventName }: GalleryReadyProps) => `Your photos from ${eventName} are ready`;
