/**
 * @module middlewares/auth
 * @description Firebase Authentication middleware for Express.
 *
 * Provides two middleware variants:
 * - **`authenticateFirebaseToken`** — strict guard; rejects unauthenticated
 *   requests with 401/403.
 * - **`optionalAuthenticateFirebaseToken`** — soft guard; populates
 *   `req.user` when a valid token is present but never blocks the request.
 *
 * Both variants extract the Bearer token from the `Authorization` header
 * and verify it against the Firebase Admin SDK.
 *
 * ## Token Flow
 * ```
 *  Client                    Server
 *  │  Authorization: Bearer <idToken>  │
 *  │───────────────────────────────────────▶│
 *  │                                   │  verifyIdToken(idToken)
 *  │                                   │  req.user = { uid, email, … }
 *  │               200 / 401 / 403     │
 *  │◀───────────────────────────────────────│
 * ```
 *
 * @see module:services/auth — Firebase Admin SDK wrapper
 */
const authService = require('../services/auth.service');

/**
 * **Strict** Firebase token authentication middleware.
 *
 * Rejects the request with an appropriate HTTP status if the token
 * is missing, expired, revoked, or otherwise invalid.
 *
 * | Scenario               | HTTP Status | Error Code              |
 * |------------------------|-------------|-------------------------|
 * | No / malformed header  | 401         | `Unauthorized`          |
 * | Token expired          | 401         | `auth/id-token-expired` |
 * | Token revoked          | 401         | `auth/id-token-revoked` |
 * | Invalid / forged token | 403         | `Forbidden`             |
 *
 * On success, `req.user` is populated with the decoded Firebase token
 * payload (contains `uid`, `email`, `email_verified`, `iat`, `exp`, etc.).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function authenticateFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({
            error: 'Unauthorized',
            message: 'No token provided or invalid Authorization header format. Expected "Bearer <token>".'
        });
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await authService.verifyIdToken(idToken);
        req.user = decodedToken; // Attach user info (uid, email, etc.) to the request
        next();
    } catch (error) {
        console.error('[Auth Middleware] Token verification failed:', error.message);

        // Handle specific Firebase errors for better client feedback
        if (error.code === 'auth/id-token-expired') {
            return res.status(401).json({ error: 'Unauthorized', message: 'Token has expired.' });
        }
        if (error.code === 'auth/id-token-revoked') {
            return res.status(401).json({ error: 'Unauthorized', message: 'Token has been revoked.' });
        }

        return res.status(403).json({
            error: 'Forbidden',
            message: 'Invalid or forged token.'
        });
    }
}

/**
 * **Optional** Firebase token authentication middleware.
 *
 * Behaves identically to {@link authenticateFirebaseToken} when a valid
 * Bearer token is present, but **never rejects** the request.  If the
 * token is missing or verification fails, the request continues with
 * `req.user = undefined`.
 *
 * Use this on endpoints that should be accessible to both authenticated
 * and anonymous callers (e.g. route finding with guest caching).
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 * @returns {Promise<void>}
 */
async function optionalAuthenticateFirebaseToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return next();
    }

    const idToken = authHeader.split('Bearer ')[1];

    try {
        const decodedToken = await authService.verifyIdToken(idToken);
        req.user = decodedToken; // Attach user info
    } catch (error) {
        // Silently ignore verification failures for optional routes
        console.warn('[Auth Middleware] Optional token verification failed:', error.message);
    }

    next();
}

module.exports = {
    authenticateFirebaseToken,
    optionalAuthenticateFirebaseToken
};
