/**
 * @module app
 * @description Application entry point and Express server bootstrap.
 *
 * ## Startup Lifecycle
 * 1. Configure CORS (with credentials for guest session cookies)
 * 2. Mount JSON body parser
 * 3. Register route handlers (`/Find`, `/Map`)
 * 4. Bind to `config.PORT` (default 3001)
 * 5. Initialize Firebase Admin SDK for JWT verification
 * 6. Start hourly traffic simulation service
 *
 * **Redis** is intentionally not started here — it connects lazily
 * on first cache operation via {@link module:services/redis}.
 *
 * ## Middleware Pipeline (per route group)
 * - `/Find/*` → optionalAuth → guestSession → controller
 * - `/Map/*`  → rateLimiter → controller
 *
 * @see module:routes/find — transit route-finding endpoints
 * @see module:routes/map  — geocoding & autocomplete endpoints
 */
const express = require('express');
const cors = require('cors');
const config = require('./config');
const { startTrafficService } = require('./services/traffic.service');
const authService = require('./services/auth.service');

const app = express();

/**
 * CORS configuration.
 * - `origin: true`      — reflects the request’s `Origin` header (allows any origin)
 * - `credentials: true`  — permits cross-origin `Set-Cookie` / `Cookie` headers,
 *   required for the `guest_sid` session cookie used by {@link module:middlewares/guestSession}
 */
app.use(cors({
    origin: true,
    credentials: true,
}));

/** Parse incoming JSON bodies for POST/PUT endpoints */
app.use(express.json());

/** @type {import('express').Router} Transit route-finding endpoints */
const findRoutes = require('./routes/find.routes');
/** @type {import('express').Router} Geocoding & autocomplete endpoints */
const mapRoutes = require('./routes/map.routes');

app.use('/Find', findRoutes);
app.use('/Map', mapRoutes);

/**
 * Starts the HTTP server and initialises infrastructure services.
 * Firebase Admin is initialised **after** the server is listening so
 * that the port is available immediately for health checks.
 * Redis connects lazily on first cache operation.
 */
app.listen(config.PORT, async () => {
    console.log(`Server running at port ${config.PORT}`);

    authService.initialize();

    // Hourly traffic simulation (randomised velocities with time-of-day model)
    startTrafficService();
});
