/**
 * @module middlewares/guestSession
 * @description Provides a unified cache identity for every incoming request,
 * regardless of authentication status. This enables the 3-tier caching
 * strategy to apply personalised route history to both logged-in users
 * and anonymous guests.
 *
 * ## How it works
 * - **Authenticated callers** — identified via `req.user.uid` (set by the
 *   upstream {@link module:middlewares/auth~optionalAuthenticateFirebaseToken}
 *   middleware). Cache identity: `user:<firebase_uid>`.
 * - **Guest callers** — identified via a `guest_sid` HTTP-only cookie. If the
 *   cookie is absent, a new UUID v4 is generated and set with a 7-day expiry.
 *   Cache identity: `guest:<uuid>`.
 *
 * ## Middleware ordering
 * This middleware **must** be mounted **after** the optional Firebase auth
 * middleware so that `req.user` is already populated when available.
 *
 * ## Properties injected onto `req`
 * | Property         | Type      | Description                                               |
 * |------------------|-----------|-----------------------------------------------------------|
 * | `req.cacheId`    | `string`  | Redis key prefix for personalised cache (e.g. `user:abc`) |
 * | `req.cacheIsUser`| `boolean` | `true` if the caller is a verified Firebase user          |
 *
 * @see module:controllers/find~findBusRoute — consumer of `req.cacheId`
 * @see module:middlewares/auth — upstream auth middleware
 */
const { randomUUID } = require('crypto');

// ─── Constants ─────────────────────────────────────────────

/** @constant {string} COOKIE_NAME — Name of the guest session cookie */
const COOKIE_NAME = 'guest_sid';

/** @constant {number} GUEST_COOKIE_MAX_AGE_MS — 7 days in milliseconds */
const GUEST_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// ─── Helpers ───────────────────────────────────────────────

/**
 * Lightweight cookie parser that avoids adding the `cookie-parser`
 * package as a dependency. Extracts key-value pairs from the raw
 * `Cookie` header.
 *
 * @param {import('express').Request} req - Express request object
 * @returns {Object.<string, string>} Map of cookie name → decoded value
 * @example
 * // req.headers.cookie = 'guest_sid=abc123; theme=dark'
 * parseCookies(req) // → { guest_sid: 'abc123', theme: 'dark' }
 */
function parseCookies(req) {
    const cookies = {};
    const header = req.headers.cookie;
    if (!header) return cookies;
    header.split(';').forEach((part) => {
        const [name, ...rest] = part.trim().split('=');
        if (name) cookies[name] = decodeURIComponent(rest.join('='));
    });
    return cookies;
}

// ─── Middleware ────────────────────────────────────────────

/**
 * Express middleware that assigns a deterministic `req.cacheId` for
 * personalised caching in the route-finding controller.
 *
 * **Identity resolution order:**
 * 1. If `req.user.uid` exists (Firebase-authenticated) → `user:<uid>`
 * 2. If a `guest_sid` cookie is present → `guest:<cookie_value>`
 * 3. Otherwise → generate a new UUID v4 guest session, set cookie, → `guest:<new_uuid>`
 *
 * @param {import('express').Request}  req  - Express request (may have `req.user` from auth middleware)
 * @param {import('express').Response} res  - Express response (used to set `Set-Cookie` for guests)
 * @param {import('express').NextFunction} next - Express next middleware
 * @returns {void}
 *
 * @example
 * // Mount after optional auth
 * router.get('/bus/route',
 *   optionalAuthenticateFirebaseToken,
 *   guestSession,
 *   findBusRoute
 * );
 */
function guestSession(req, res, next) {
    // Authenticated users — use their Firebase UID (no cookie needed)
    if (req.user && req.user.uid) {
        req.cacheId = `user:${req.user.uid}`;
        req.cacheIsUser = true;
        return next();
    }

    // Guest users — look for an existing session cookie, or create one
    const cookies = parseCookies(req);
    let guestId = cookies[COOKIE_NAME];

    if (!guestId) {
        guestId = randomUUID();
        res.cookie(COOKIE_NAME, guestId, {
            maxAge: GUEST_COOKIE_MAX_AGE_MS,
            httpOnly: true,   // prevent XSS access
            sameSite: 'lax',  // CSRF protection while allowing top-level navigations
        });
    }

    req.cacheId = `guest:${guestId}`;
    req.cacheIsUser = false;
    next();
}

module.exports = { guestSession };
