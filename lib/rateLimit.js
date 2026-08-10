/**
 * lib/rateLimit.js — best-effort, in-memory rate limiter.
 *
 * SCOPE, HONESTLY STATED: Vercel serverless functions are stateless and
 * can run as multiple concurrent instances; this in-memory store lives
 * inside a single instance, not shared across the fleet. A distributed
 * attacker can exceed these limits by fanning requests across instances.
 * This is a real first line of defense against casual abuse and
 * single-source hammering — not a substitute for Vercel's own
 * platform-level DDoS protection, or a shared store (Upstash Redis via
 * @upstash/ratelimit) if this ever needs fleet-wide limiting. Swapping
 * this module's internals for a Redis-backed one is a drop-in change —
 * callers only depend on checkRateLimit()'s return shape.
 *
 * checkRateLimit() also doubles as a global (non-per-IP) budget when
 * called with a fixed constant key instead of a client IP — see
 * GLOBAL_RATE_LIMIT_KEY usage in the api/ handlers. That's the specific
 * defense against a distributed flood (many IPs, low volume each) aimed
 * at exhausting this deployment's Claude API budget — a pattern per-IP
 * limiting alone is blind to.
 */

'use strict';

/** @typedef {{ allowed: boolean, remaining: number, retryAfterSeconds: number }} RateLimitResult */

/** @type {Map<string, { count: number, windowStart: number }>} */
const buckets = new Map();

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
/** @type {NodeJS.Timeout|null} */
let sweepTimer = null;

/**
 * Checks and records one request against a sliding window for `key`.
 * @param {string} key - Usually a client IP, or a fixed constant for a
 *   global (all-visitors) budget.
 * @param {{ windowMs: number, max: number }} options
 * @returns {RateLimitResult}
 */
function checkRateLimit(key, { windowMs, max }) {
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now - bucket.windowStart >= windowMs) {
    buckets.set(key, { count: 1, windowStart: now });
    return { allowed: true, remaining: max - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  const allowed = bucket.count <= max;
  const retryAfterSeconds = Math.max(1, Math.ceil((bucket.windowStart + windowMs - now) / 1000));
  return { allowed, remaining: Math.max(0, max - bucket.count), retryAfterSeconds };
}

/**
 * Extracts a best-effort client identifier from the request. Vercel
 * puts the client IP first in x-forwarded-for; only the first entry is
 * trusted — later entries are proxies we don't control, and trusting
 * them would let a client spoof its way into a fresh bucket.
 * @param {import('http').IncomingMessage} req
 * @returns {string}
 */
function clientKeyFromRequest(req) {
  const forwarded = req.headers['x-forwarded-for'];
  const ip = typeof forwarded === 'string' ? forwarded.split(',')[0].trim() : null;
  return ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * Starts a periodic sweep that evicts stale buckets so this Map can't
 * grow unbounded over a long-lived instance's lifetime. Safe to call on
 * every request — only schedules once per instance.
 * @param {number} maxWindowMs - Largest windowMs in use, so nothing is swept early.
 */
function ensureSweepScheduled(maxWindowMs) {
  if (sweepTimer) return;
  sweepTimer = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart >= maxWindowMs) buckets.delete(key);
    }
  }, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

module.exports = { checkRateLimit, clientKeyFromRequest, ensureSweepScheduled };
