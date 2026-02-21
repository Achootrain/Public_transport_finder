/**
 * @module middlewares/rateLimiter
 * @description Express rate limiting middleware.
 * Restricts clients to a configurable number of requests per time window.
 */
const rateLimit = require('express-rate-limit');

/**
 * Rate limiter — allows max 10 requests per minute per client IP.
 * @type {import('express').RequestHandler}
 */
const limiter = rateLimit({
    windowMs: 1 * 60 * 1000,
    max: 10,
    message: { error: 'Too many requests, please try again later.' },
});

module.exports = { limiter };
