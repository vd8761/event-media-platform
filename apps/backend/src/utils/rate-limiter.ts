// Sliding-window in-memory rate limiter for the public selfie intake
// (docs/plan/07 §2: 5/hour per IP, 3/day per email per event). Per-process —
// fine for the single-API v1; swap for a Redis window if the API tier scales
// out (docs/plan/01 §4).
export class RateLimiter {
  private hits = new Map<string, number[]>();

  constructor(
    private limit: number,
    private windowMs: number,
  ) {}

  // returns true when the call is allowed
  consume(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const timestamps = (this.hits.get(key) ?? []).filter((t) => t > cutoff);
    if (timestamps.length >= this.limit) {
      this.hits.set(key, timestamps);
      return false;
    }
    timestamps.push(now);
    this.hits.set(key, timestamps);

    // lazy cleanup so the map cannot grow unboundedly
    if (this.hits.size > 10_000) {
      for (const [mapKey, value] of this.hits) {
        if (value.every((t) => t <= cutoff)) {
          this.hits.delete(mapKey);
        }
      }
    }
    return true;
  }
}
