// Expiry decides whether a participant can still reach their photos, and the
// purge deadline decides when those photos are destroyed. Both are pure
// functions of the row plus the clock, so they are pinned here.
import { purgeDeadline, isEventExpired, isEventPurged } from 'src/utils/event-expiry';
import { describe, expect, it } from 'vitest';

const at = (iso: string) => new Date(iso);
const event = (expiresAt: string | null, purgedAt: string | null = null) =>
  ({ expiresAt: expiresAt ? at(expiresAt) : null, purgedAt: purgedAt ? at(purgedAt) : null }) as never;

describe('isEventExpired', () => {
  it('treats an event with no expiry as never expiring', () => {
    expect(isEventExpired(event(null), at('2099-01-01T00:00:00Z'))).toBe(false);
  });

  it('is live before the expiry instant', () => {
    expect(isEventExpired(event('2026-07-01T12:00:00Z'), at('2026-07-01T11:59:59Z'))).toBe(false);
  });

  it('is expired exactly at the expiry instant', () => {
    // Boundary is inclusive: the stated moment is when it closes, not the
    // last moment it works.
    expect(isEventExpired(event('2026-07-01T12:00:00Z'), at('2026-07-01T12:00:00Z'))).toBe(true);
  });

  it('is expired after the instant', () => {
    expect(isEventExpired(event('2026-07-01T12:00:00Z'), at('2026-07-01T12:00:01Z'))).toBe(true);
  });

  it('goes live again when the date is pushed out', () => {
    // Expiry is computed, never a stored flag — this is what makes "extend"
    // restore every gallery link with no sweep in between.
    const extended = event('2027-01-01T00:00:00Z');
    expect(isEventExpired(extended, at('2026-07-01T12:00:00Z'))).toBe(false);
  });
});

describe('isEventPurged', () => {
  it('is false until the media is actually deleted', () => {
    expect(isEventPurged(event('2020-01-01T00:00:00Z'))).toBe(false);
  });

  it('is true once purged, which extending can never undo', () => {
    expect(isEventPurged(event('2020-01-01T00:00:00Z', '2020-01-02T00:00:00Z'))).toBe(true);
  });
});

describe('purgeDeadline', () => {
  it('adds the grace period to the expiry instant', () => {
    expect(purgeDeadline(at('2026-07-01T12:00:00Z'), 24).toISOString()).toBe('2026-07-02T12:00:00.000Z');
  });

  it('supports sub-day grace periods', () => {
    expect(purgeDeadline(at('2026-07-01T12:00:00Z'), 1).toISOString()).toBe('2026-07-01T13:00:00.000Z');
  });

  it('never lands before the expiry it follows', () => {
    const expiresAt = at('2026-07-01T12:00:00Z');
    expect(purgeDeadline(expiresAt, 1).getTime()).toBeGreaterThan(expiresAt.getTime());
  });
});
