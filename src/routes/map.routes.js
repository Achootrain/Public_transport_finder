/**
 * @module routes/map
 * @description Route definitions for geocoding and place autocomplete
 * endpoints, proxied through to the Goong Maps API.
 *
 * All endpoints are rate-limited to **10 requests per minute** per
 * client IP to prevent abuse and stay within Goong API quotas.
 *
 * @see module:controllers/map — handler implementations
 * @see module:middlewares/rateLimiter — rate-limiting configuration
 */
const express = require('express');
const router = express.Router();
const { limiter } = require('../middlewares/rateLimiter');
const { geocode, autoComplete } = require('../controllers/map.controller');

/**
 * GET /Map/get
 * Geocodes a free-text address string to up to 3 lat/lng coordinates.
 *
 * @name GET /Map/get
 * @function
 * @memberof module:routes/map
 * @see module:controllers/map~geocode
 */
router.get('/get', limiter, geocode);

/**
 * GET /Map/autoComplete
 * Returns place suggestions for a partial input string.
 *
 * @name GET /Map/autoComplete
 * @function
 * @memberof module:routes/map
 * @see module:controllers/map~autoComplete
 */
router.get('/autoComplete', limiter, autoComplete);

module.exports = router;
