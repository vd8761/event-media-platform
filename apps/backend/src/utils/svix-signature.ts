// Svix webhook signature verification (Resend signs with Svix).
//
// Implemented against node:crypto rather than pulling in the `svix` SDK: the
// scheme is a single HMAC and the endpoint is unauthenticated, so the fewer
// moving parts between the internet and the database, the better.
//
// Signed payload is `${id}.${timestamp}.${rawBody}`, HMAC-SHA256 with the
// base64-decoded portion of the `whsec_…` secret, compared base64.
import { createHmac, timingSafeEqual } from 'node:crypto';

// Bounds replay of a captured request. Svix's own default.
const TOLERANCE_SECONDS = 5 * 60;

export interface SvixHeaders {
  id?: string;
  timestamp?: string;
  signature?: string;
}

export type SvixResult = { valid: true } | { valid: false; reason: string };

const decodeSecret = (secret: string): Buffer => {
  // Both `whsec_<base64>` and a bare base64 secret are accepted.
  const raw = secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret;
  return Buffer.from(raw, 'base64');
};

// Constant-time compare that cannot throw on a length mismatch.
const safeEqual = (a: string, b: string): boolean => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

export function verifySvixSignature(
  rawBody: string,
  headers: SvixHeaders,
  secret: string,
  now: Date = new Date(),
): SvixResult {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) {
    return { valid: false, reason: 'missing svix-id, svix-timestamp or svix-signature header' };
  }

  const sentAt = Number(timestamp);
  if (!Number.isFinite(sentAt)) {
    return { valid: false, reason: 'svix-timestamp is not a unix timestamp' };
  }
  // Rejects both an old replayed request and one dated far in the future.
  const driftSeconds = Math.abs(Math.floor(now.getTime() / 1000) - sentAt);
  if (driftSeconds > TOLERANCE_SECONDS) {
    return { valid: false, reason: `timestamp outside tolerance (${driftSeconds}s)` };
  }

  const expected = createHmac('sha256', decodeSecret(secret))
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest('base64');

  // The header carries a space-separated list of versioned signatures, so a
  // secret can be rotated without dropping deliveries. Any v1 match passes.
  for (const entry of signature.split(' ')) {
    const [version, value] = entry.split(',');
    if (version === 'v1' && value && safeEqual(value, expected)) {
      return { valid: true };
    }
  }

  return { valid: false, reason: 'no matching v1 signature' };
}
