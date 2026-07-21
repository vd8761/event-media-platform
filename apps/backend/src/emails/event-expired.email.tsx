// Organizer-facing, unlike every other template here. Sent once when an event
// passes its expiry date: the participant links are already closed, and the
// media will be deleted after the grace period unless someone acts.
//
// The tone is deliberately plain about consequences — this is the last message
// before photos are destroyed, and it must not read like marketing.
import * as React from 'react';
import { EmailLayout, P } from 'src/emails/components';

export interface EventExpiredProps {
  eventName: string;
  organizerName: string;
  expiresAt: Date | string;
  purgeAfter: Date | string;
  assetCount: number;
  manageUrl: string;
}

const formatDate = (value: Date | string) =>
  new Date(value).toLocaleString('en-GB', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' });

export function EventExpiredEmail({
  eventName,
  organizerName,
  expiresAt,
  purgeAfter,
  assetCount,
  manageUrl,
}: EventExpiredProps) {
  return (
    <EmailLayout
      preview={`${eventName} has closed — its photos will be deleted on ${formatDate(purgeAfter)}`}
      heading={`${eventName} has closed`}
      ctaLabel="Manage this event"
      ctaUrl={manageUrl}
      footer="You're receiving this because you own the organization this event belongs to."
    >
      <P>Hi {organizerName},</P>
      <P>
        <strong>{eventName}</strong> reached its expiry date on {formatDate(expiresAt)} (UTC). Guest gallery links are
        now closed — anyone opening one sees a message saying the event has ended.
      </P>
      <P>
        The photos are still stored. Unless you act, all{' '}
        <strong>
          {assetCount.toLocaleString('en-GB')} file{assetCount === 1 ? '' : 's'}
        </strong>{' '}
        will be permanently deleted after <strong>{formatDate(purgeAfter)} (UTC)</strong>. This cannot be undone.
      </P>
      <P>From the event page you can:</P>
      <P>
        • <strong>Extend</strong> — pick a new date. Guest links start working again straight away.
        <br />• <strong>Delete now</strong> — free the storage immediately instead of waiting.
        <br />• <strong>Do nothing</strong> — the photos are deleted on the date above.
      </P>
    </EmailLayout>
  );
}

export const subject = ({ eventName }: EventExpiredProps) => `${eventName} has closed — photos will be deleted soon`;
