/**
 * @module controllers/find
 * @description Handles route-finding HTTP requests with a 3-tier caching
 * strategy backed by Redis.
 *
 * ## 3-Tier Caching Architecture
 *
 * ```
 *  Request
 *    │
 *    ▼
 *  ┌──────────────────────────────────────────┐
 *  │ Tier 1 — Personalised Cache              │  1 km fuzzy match
 *  │ Key: <cacheId>:recent_paths              │  TTL: 30 d (user) / 7 d (guest)
 *  │ Stores last 10 queries per identity      │
 *  └──────────┬───────────────────────────────┘
 *             │ MISS
 *             ▼
 *  ┌──────────────────────────────────────────┐
 *  │ Tier 2 — Global Coordinate Cache         │  Exact rounded coords (4 dp)
 *  │ Key: route:<lat>,<lng>:<lat>,<lng>       │  TTL: 60 s
 *  │ Shared across all users & guests         │
 *  └──────────┬───────────────────────────────┘
 *             │ MISS
 *             ▼
 *  ┌──────────────────────────────────────────┐
 *  │ Tier 3 — Live Pathfinding Computation    │  Eppstein K-shortest paths
 *  │ Writes result back to Tier 1 + Tier 2    │
 *  └──────────────────────────────────────────┘
 * ```
 *
 * The `cacheId` is provided by {@link module:middlewares/guestSession} and
 * takes the form `user:<uid>` (Firebase) or `guest:<session_uuid>` (cookie).
 *
 * ## Personalised Cache — Redis GEO Design
 * Instead of iterating through a JSON list and computing haversine
 * distances in application code (O(n) per request), Tier 1 now uses
 * **Redis GEO sorted sets** for O(log n) spatial lookups:
 *
 * | Key                        | Type   | Purpose                           |
 * |----------------------------|--------|-----------------------------------|
 * | `<cacheId>:geo:starts`     | GEO    | Start-coordinate spatial index    |
 * | `<cacheId>:geo:ends`       | GEO    | End-coordinate spatial index      |
 * | `<cacheId>:data:<member>`  | STRING | JSON route result payload         |
 * | `<cacheId>:order`          | LIST   | LRU eviction queue (max 10)       |
 *
 * Lookup: `GEOSEARCH` on both start/end GEO sets, intersect member
 * names, fetch the first matching data key.
 *
 * @see module:services/pathFind — Eppstein K-shortest paths engine
 * @see module:services/redis    — Redis wrapper (GEO, LIST, STRING)
 * @see module:middlewares/guestSession — cache identity provider
 */
const { findKroute } = require('../services/pathFind.service');
const { getStationById, getRouteById } = require('../repositories/station.repository');
const redisService = require('../services/redis.service');
const ApiResponse = require('../utils/apiResponse');

/** @constant {number} MAX_PERSONAL_CACHE Maximum personalised cache entries per identity */
const MAX_PERSONAL_CACHE = 10;

/** @constant {number} GEO_RADIUS_KM Fuzzy matching radius for personalised cache (km) */
const GEO_RADIUS_KM = 1.0;

/** @constant {number} USER_TTL_SECONDS TTL for authenticated user cache (7 days) */
const USER_TTL_SECONDS = 7 * 24 * 60 * 60;

/** @constant {number} GUEST_TTL_SECONDS TTL for guest session cache (30 minutes) */
const GUEST_TTL_SECONDS = 60 * 30;//

// ─── Personalised Cache Helpers ────────────────────────────

/**
 * Generates a deterministic member name for a start/end coordinate pair.
 * Uses 6 decimal places (~0.1 m precision) for deduplication.
 *
 * @param {{ lat: number, lng: number }} start
 * @param {{ lat: number, lng: number }} end
 * @returns {string} e.g. `"21.028500_105.854200:21.030000_105.850000"`
 */
function geoMemberKey(start, end) {
    return `${start.lat.toFixed(6)}_${start.lng.toFixed(6)}:${end.lat.toFixed(6)}_${end.lng.toFixed(6)}`;
}

/**
 * Looks up the personalised cache using two Redis GEO sets.
 *
 * 1. `GEOSEARCH <cacheId>:geo:starts` within 1 km of `start` → candidate set A
 * 2. `GEOSEARCH <cacheId>:geo:ends`   within 1 km of `end`   → candidate set B
 * 3. Intersect A ∩ B → matching member(s)
 * 4. Fetch `<cacheId>:data:<first_match>` → cached route result
 *
 * Time complexity: O(log n + m) per GEO search (Redis-side),
 * versus O(n) haversine iteration in the previous implementation.
 *
 * @param {string} cacheId - Identity key prefix (e.g. `user:abc` or `guest:uuid`)
 * @param {{ lat: number, lng: number }} start - Query start coordinate
 * @param {{ lat: number, lng: number }} end   - Query end coordinate
 * @returns {Promise<*|null>} Cached route result, or `null` on miss
 */
async function findPersonalizedCache(cacheId, start, end) {
    const startKey = `${cacheId}:geo:starts`;
    const endKey   = `${cacheId}:geo:ends`;

    // Step 1 – find cached routes whose start is within 1 km
    const startMatches = await redisService.geoSearch(startKey, start.lng, start.lat, GEO_RADIUS_KM);
    if (!startMatches || startMatches.length === 0) return null;

    // Step 2 – find cached routes whose end is within 1 km
    const endMatches = await redisService.geoSearch(endKey, end.lng, end.lat, GEO_RADIUS_KM);
    if (!endMatches || endMatches.length === 0) return null;

    // Step 3 – intersect (GEO results are small — max 10 entries)
    const endSet = new Set(endMatches);
    const match = startMatches.find((m) => endSet.has(m));
    if (!match) return null;

    // Step 4 – fetch the cached route data
    return redisService.get(`${cacheId}:data:${match}`);
}

/**
 * Saves a route result into the personalised GEO-based cache and
 * enforces the {@link MAX_PERSONAL_CACHE} limit via LRU eviction.
 *
 * Keys written per save:
 * - `GEOADD <cacheId>:geo:starts`  (start coordinate → member)
 * - `GEOADD <cacheId>:geo:ends`    (end coordinate   → member)
 * - `SET    <cacheId>:data:<member>` (JSON payload with TTL)
 * - `LPUSH  <cacheId>:order`        (LRU tracking list)
 *
 * When the list exceeds 10, the oldest member is popped and its
 * GEO entries + data key are deleted.
 *
 * @param {string}  cacheId     - Identity key prefix
 * @param {boolean} cacheIsUser - `true` → 30-day TTL, `false` → 7-day TTL
 * @param {{ lat: number, lng: number }} start
 * @param {{ lat: number, lng: number }} end
 * @param {*}       result      - Route result payload to cache
 * @returns {Promise<void>}
 */
async function savePersonalizedCache(cacheId, cacheIsUser, start, end, result) {
    const member   = geoMemberKey(start, end);
    const startKey = `${cacheId}:geo:starts`;
    const endKey   = `${cacheId}:geo:ends`;
    const dataKey  = `${cacheId}:data:${member}`;
    const orderKey = `${cacheId}:order`;
    const ttl      = cacheIsUser ? USER_TTL_SECONDS : GUEST_TTL_SECONDS;

    // Store coordinates in GEO indices
    await redisService.geoAdd(startKey, start.lng, start.lat, member);
    await redisService.geoAdd(endKey, end.lng, end.lat, member);

    // Store route data with TTL
    await redisService.set(dataKey, result, ttl);

    // Update LRU order list — remove duplicates first, then prepend
    await redisService.lRem(orderKey, member);
    await redisService.lPush(orderKey, member);

    // Evict oldest entries beyond MAX_PERSONAL_CACHE
    const len = await redisService.lLen(orderKey);
    if (len > MAX_PERSONAL_CACHE) {
        const evicted = await redisService.rPop(orderKey);
        if (evicted) {
            await redisService.zRem(startKey, evicted);
            await redisService.zRem(endKey, evicted);
            await redisService.del(`${cacheId}:data:${evicted}`);
        }
    }

    // Refresh TTL on structural keys
    await redisService.expire(startKey, ttl);
    await redisService.expire(endKey, ttl);
    await redisService.expire(orderKey, ttl);
}

/**
 * Safely parses a query-string value that is expected to be a JSON object.
 * Express may have already parsed the value (when `extended` qs is enabled),
 * so this function handles both raw strings and pre-parsed objects.
 *
 * @param {string|Object|null|undefined} value - Raw query-string value
 * @param {string} name - Parameter name (used in error messages)
 * @returns {Object} Parsed object with expected shape `{ lat: number, lng: number }`
 * @throws {Error} If `value` is `null`/`undefined` or cannot be parsed as JSON
 *
 * @example
 * parseJsonQueryParam('{"lat":21.03,"lng":105.85}', 'start');
 * // → { lat: 21.03, lng: 105.85 }
 */
function parseJsonQueryParam(value, name) {
    if (value == null) throw new Error(`Missing '${name}'`);
    if (typeof value === 'object') return value;
    try {
        return JSON.parse(value);
    } catch {
        throw new Error(`Invalid JSON for '${name}'`);
    }
}

/**
 * **GET /Find/bus/route**
 *
 * Finds up to K (default 3) diverse public-transit routes between two
 * geographic coordinates using the 3-tier cache-first architecture
 * described in the module header.
 *
 * ### Query Parameters
 * | Param   | Type   | Required | Description                          |
 * |---------|--------|----------|--------------------------------------|
 * | `start` | JSON   | Yes      | `{ "lat": number, "lng": number }`   |
 * | `end`   | JSON   | Yes      | `{ "lat": number, "lng": number }`   |
 *
 * ### Response Shape (via {@link module:utils/apiResponse~ApiResponse})
 * ```json
 * {
 *   "success": true,
 *   "message": "Success" | "Success (Served from Personalized Cache)" | "Success (Served from Global Cache)",
 *   "data": [ RouteResult, ... ],
 *   "error":  null,
 *   "metadata": { "timestamp": 1700000000, "processingTime": "42ms" }
 * }
 * ```
 *
 * ### Cache Behaviour
 * - **Tier 1 hit** → returns `"Served from Personalized Cache"` (user or guest)
 * - **Tier 2 hit** → returns `"Served from Global Cache"`, also writes to Tier 1
 * - **Tier 3 (compute)** → writes result to both Tier 1 and Tier 2
 *
 * @param {import('express').Request}  req - Express request; expects `req.cacheId` (set by guestSession middleware)
 * @param {import('express').Response} res - Express response
 * @returns {Promise<void>}
 *
 * @example
 * // GET /Find/bus/route?start={"lat":21.0285,"lng":105.8542}&end={"lat":21.03,"lng":105.85}
 * // → 200 { success: true, message: "Success", data: [...] }
 */
async function findBusRoute(req, res) {
    const startTimeMs = Date.now();
    try {
        let { start, end } = req.query;

        start = parseJsonQueryParam(start, 'start');
        end = parseJsonQueryParam(end, 'end');

        if (
            !Number.isFinite(start?.lat) || !Number.isFinite(start?.lng) ||
            !Number.isFinite(end?.lat) || !Number.isFinite(end?.lng)
        ) {
            return ApiResponse.error(res, "'start' and 'end' must have numeric lat/lng", 'Validation failed', startTimeMs, 400);
        }

        // ─── Tier 1: Personalised Recent Routes Cache (Redis GEO) ──
        // Uses GEOSEARCH on two GEO sorted sets (starts + ends) to
        // find a previously cached route whose start AND end are both
        // within 1 km of the requested coordinates.  O(log n + m)
        // via Redis geohash indexing — no application-side iteration.
        if (req.cacheId) {
            const cached = await findPersonalizedCache(req.cacheId, start, end);
            if (cached) {
                console.log(`[Cache Hit] Serving path from Personalized Cache (${req.cacheId})`);
                return ApiResponse.success(res, cached, 'Success (Served from Personalized Cache)', startTimeMs);
            }
        }

        // ─── Tier 2: Global Coordinate Cache ─────────────────────
        // Constructs a deterministic key from coordinates rounded to
        // 4 decimal places (~11 m precision). This key is shared
        // across all callers so repeated nearby lookups are served
        // without recomputation.  TTL = 60 s to stay close to
        // real-time traffic updates.
        const cacheKey = `route:${start.lat.toFixed(4)},${start.lng.toFixed(4)}:${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;

        const cachedResult = await redisService.get(cacheKey);
        if (cachedResult) {
            console.log(`[Cache Hit] Serving path from Global Redis for ${cacheKey}`);

            // Save this global-cache hit to the caller's personalised GEO cache
            if (req.cacheId) {
                await savePersonalizedCache(req.cacheId, req.cacheIsUser, start, end, cachedResult);
            }

            return ApiResponse.success(res, cachedResult, 'Success (Served from Global Cache)', startTimeMs);
        }

        // ─── Tier 3: Live Pathfinding Computation ─────────────────
        // Full cache miss — run Eppstein’s K-shortest-paths over the
        // augmented transit graph.  Results are written back to both
        // Tier 1 (personalised) and Tier 2 (global) caches.
        const result = findKroute(start.lat, start.lng, end.lat, end.lng, 3);
        if (!Array.isArray(result) || result.length === 0) {
            return ApiResponse.error(res, 'No valid transit route could be found between these locations', 'Route not found', startTimeMs, 404);
        }

        const finalResult = result.map((part) => {
            const stationIds = part.passedRoutePairs.map((p) => p.passed);
            const stationMap = new Map();
            for (const sid of stationIds) {
                const st = getStationById(sid);
                if (st) stationMap.set(sid, st);
            }

            return {
                passed:
                    part.passedRoutePairs && part.passedRoutePairs.length > 2
                        ? part.passedRoutePairs
                            .slice(1, -1)
                            .filter((p) => stationMap.has(p.passed))
                            .map((p) => ({ station: stationMap.get(p.passed), route: p.routeId }))
                        : [],
                pathSegments: part.pathSegments || [],
                routes: Array.isArray(part.routes)
                    ? part.routes.map((rid) => getRouteById(rid)).filter(Boolean)
                    : [],
                routeChanges: part.routeChanges,
                time: part.time,
                distance: part.distance,
            };
        });

        // Save to Global Redis Cache with a TTL of 60 seconds (so it updates closely with live traffic)
        await redisService.set(cacheKey, finalResult, 60);

        // Save to personalized GEO cache (logged-in users: 30 days, guests: 7 days)
        if (req.cacheId) {
            await savePersonalizedCache(req.cacheId, req.cacheIsUser, start, end, finalResult);
        }

        return ApiResponse.success(res, finalResult, 'Success', startTimeMs);
    } catch (error) {
        return ApiResponse.error(res, error, 'Internal Server Error', startTimeMs, 500);
    }
}

module.exports = { findBusRoute };
