// Expiration is derived, never a stored flag: an event is expired when the
// clock passes `expires_at`. Keeping it computed means an organizer extending
// the date instantly restores every gallery link, with no sweep to wait for
// and no stale `is_expired` column to fall out of sync.
import { EventRow } from 'src/schema';

export type ExpiringEvent = Pick<EventRow, 'expiresAt' | 'purgedAt'>;

export const isEventExpired = (event: ExpiringEvent, now: Date = new Date()): boolean =>
  event.expiresAt !== null && now >= new Date(event.expiresAt);

// Media is gone. Distinct from expired: a purged event can never be revived by
// extending the date, so the UI must say something different.
export const isEventPurged = (event: ExpiringEvent): boolean => event.purgedAt !== null;

export const purgeDeadline = (expiresAt: Date, graceHours: number): Date =>
  new Date(expiresAt.getTime() + graceHours * 60 * 60 * 1000);
