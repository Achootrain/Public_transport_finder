/**
 * @module routes/find
 * @description Route definitions for transit pathfinding endpoints.
 *
 * ## Middleware Pipeline
 * Every request passes through three middleware layers in order:
 * 1. {@link module:middlewares/auth~optionalAuthenticateFirebaseToken} —
 *    if a valid `Authorization: Bearer <token>` header is present,
 *    `req.user` is populated with the decoded Firebase claims.
 * 2. {@link module:middlewares/guestSession~guestSession} —
 *    assigns `req.cacheId` and `req.cacheIsUser` for the 3-tier
 *    cache strategy (works for both logged-in users and anonymous guests).
 * 3. {@link module:controllers/find~findBusRoute} —
 *    validates input, checks caches, computes route if needed.
 *
 * @see module:controllers/find  — controller logic & caching
 * @see module:middlewares/auth  — optional Firebase token verification
 * @see module:middlewares/guestSession — cache identity assignment
 */
const express = require('express');
const router = express.Router();
const { findBusRoute } = require('../controllers/find.controller');
const { optionalAuthenticateFirebaseToken } = require('../middlewares/auth.middleware');
const { guestSession } = require('../middlewares/guestSession');

/**
 * GET /Find/bus/route
 * Finds diverse public-transit routes between two coordinates.
 * Requires JSON-encoded `start` and `end` query parameters.
 *
 * @name GET /Find/bus/route
 * @function
 * @memberof module:routes/find
 * @see module:controllers/find~findBusRoute
 */
router.get('/bus/route', optionalAuthenticateFirebaseToken, guestSession, findBusRoute);

module.exports = router;
