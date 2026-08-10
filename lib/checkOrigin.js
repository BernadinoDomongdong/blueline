/**
 * lib/checkOrigin.js — rejects cross-site requests when ALLOWED_ORIGIN
 * is configured in the environment. Requests with no Origin header
 * (same-origin navigations in some browsers, non-browser tools like
 * curl) are allowed through, since that header can't be relied on to
 * always be present for legitimate same-origin calls — this narrows
 * the attack surface without being a complete CSRF solution on its own.
 * Left unset (the default), this check is skipped entirely — fine for
 * local dev.
 */

'use strict';

const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN;

/** @param {import('http').IncomingMessage} req @returns {boolean} */
function isOriginAllowed(req) {
  if (!ALLOWED_ORIGIN) return true;
  const origin = req.headers.origin;
  if (!origin) return true;
  return origin === ALLOWED_ORIGIN;
}

module.exports = { isOriginAllowed };
