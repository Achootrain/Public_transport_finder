/**
 * @module services/redis
 * @description Singleton Redis client wrapper with automatic JSON
 * serialisation/deserialisation and graceful degradation.
 *
 * All public methods return safe defaults (`null` / `false`) when the
 * connection is down, so callers can continue with a cache-miss path
 * without explicit error handling.
 *
 * ## Key Patterns Used by the Application
 * | Pattern                                          | Type     | TTL     | Owner                        |
 * |--------------------------------------------------|----------|---------|------------------------------|
 * | `route:<lat>,<lng>:<lat>,<lng>`                  | STRING   | 60 s    | Global coordinate cache      |
 * | `<cacheId>:geo:starts`                           | GEO      | 30/7 d  | Personalised start-coord idx |
 * | `<cacheId>:geo:ends`                             | GEO      | 30/7 d  | Personalised end-coord idx   |
 * | `<cacheId>:data:<member>`                        | STRING   | 30/7 d  | Personalised route result    |
 * | `<cacheId>:order`                                | LIST     | 30/7 d  | LRU eviction queue (max 10)  |
 *
 * @see module:controllers/find — primary consumer of cache reads/writes
 */
const { createClient } = require('redis');
const config = require('../config');

/**
 * Encapsulates a Redis client connection and provides strongly-typed
 * JSON get/set/del operations.
 *
 * @class RedisService
 * @example
 * const redis = require('./services/redis.service');
 * await redis.connect();
 * await redis.set('myKey', { foo: 'bar' }, 120);
 * const val = await redis.get('myKey'); // { foo: 'bar' }
 */
class RedisService {
    constructor() {
        /** @type {import('redis').RedisClientType|null} Underlying node-redis client */
        this.client = null;

        /** @type {boolean} Whether the client has an active connection */
        this.isConnected = false;

        /**
         * Redis connection URL.
         * Falls back to localhost if `REDIS_URL` is not set in the environment.
         * @type {string}
         */
        this.redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

        /** @type {Promise<boolean>|null} In-flight connect promise (dedup guard) */
        this._connectPromise = null;
    }

    /**
     * Establishes the Redis connection and registers event listeners.
     *
     * Safe to call multiple times — concurrent calls share the same
     * in-flight promise, and subsequent calls are no-ops when already
     * connected.
     *
     * @returns {Promise<boolean>} `true` when connected, `false` on failure
     * @fires RedisClient#connect
     * @fires RedisClient#ready
     * @fires RedisClient#error
     * @fires RedisClient#end
     */
    async connect() {
        if (this.isConnected) return true;
        if (this._connectPromise) return this._connectPromise;

        this._connectPromise = this._doConnect();
        const ok = await this._connectPromise;
        this._connectPromise = null;
        return ok;
    }

    /** @private */
    async _doConnect() {
        if (!this.client) {
            this.client = createClient({ url: this.redisUrl });

            this.client.on('error', (err) => {
                console.error('[Redis] Client Error:', err.message);
                this.isConnected = false;
            });

            this.client.on('connect', () => {
                console.log(`[Redis] Connected to ${this.redisUrl}`);
                this.isConnected = true;
            });

            this.client.on('ready', () => {
                console.log('[Redis] Ready to accept commands.');
            });

            this.client.on('end', () => {
                console.log('[Redis] Connection closed.');
                this.isConnected = false;
                this.client = null;  // allow re-create on next attempt
            });
        }

        try {
            await this.client.connect();
            return true;
        } catch (error) {
            console.error('[Redis] Failed to connect:', error.message);
            return false;
        }
    }

    /**
     * Ensures a live Redis connection before issuing a command.
     * Triggers a lazy connect on first use; returns `false` if Redis
     * is unreachable so callers fall through to the cache-miss path.
     *
     * @returns {Promise<boolean>}
     */
    async ensureConnected() {
        if (this.isConnected) return true;
        return this.connect();
    }

    /**
     * Gracefully closes the Redis connection via `QUIT`.
     * Resets internal state so that {@link connect} can be called again.
     *
     * @returns {Promise<void>}
     */
    async disconnect() {
        if (this.client) {
            await this.client.quit();
            this.client = null;
            this.isConnected = false;
        }
    }

    /**
     * Retrieves and JSON-parses a cached value.
     *
     * Returns `null` on connection failure, key miss, or parse error —
     * callers should treat `null` as a cache miss.
     *
     * @param {string} key - Redis key
     * @returns {Promise<*|null>} Parsed value or `null`
     */
    async get(key) {
        if (!(await this.ensureConnected())) return null;
        try {
            const data = await this.client.get(key);
            if (!data) return null;
            return JSON.parse(data);
        } catch (error) {
            console.error(`[Redis] Error getting key ${key}:`, error.message);
            return null;
        }
    }

    /**
     * Serialises a value to JSON and stores it with an expiration.
     *
     * Uses the Redis `SETEX` command (atomic set + expire).
     *
     * @param {string} key - Redis key
     * @param {*}      value - Any JSON-serialisable value
     * @param {number} [ttlSeconds=60] - Time-to-live in seconds
     * @returns {Promise<boolean>} `true` on success, `false` on failure
     */
    async set(key, value, ttlSeconds = 60) {
        if (!(await this.ensureConnected())) return false;
        try {
            const stringValue = JSON.stringify(value);
            await this.client.setEx(key, ttlSeconds, stringValue);
            return true;
        } catch (error) {
            console.error(`[Redis] Error setting key ${key}:`, error.message);
            return false;
        }
    }

    /**
     * Removes a key from the cache.
     *
     * @param {string} key - Redis key to delete
     * @returns {Promise<boolean>} `true` on success, `false` on failure
     */
    async del(key) {
        if (!(await this.ensureConnected())) return false;
        try {
            await this.client.del(key);
            return true;
        } catch (error) {
            console.error(`[Redis] Error deleting key ${key}:`, error.message);
            return false;
        }
    }

    // ─── GEO Commands ───────────────────────────────────────────

    /**
     * Adds a geospatial member to a GEO sorted set.
     *
     * Wraps `GEOADD key longitude latitude member`.
     *
     * @param {string} key       - Redis GEO key
     * @param {number} longitude - Longitude (−180 … 180)
     * @param {number} latitude  - Latitude  (−85.05 … 85.05)
     * @param {string} member    - Member name (used as lookup handle)
     * @returns {Promise<boolean>} `true` on success, `false` on failure
     */
    async geoAdd(key, longitude, latitude, member) {
        if (!(await this.ensureConnected())) return false;
        try {
            await this.client.geoAdd(key, { longitude, latitude, member });
            return true;
        } catch (error) {
            console.error(`[Redis] Error GEOADD ${key}:`, error.message);
            return false;
        }
    }

    /**
     * Searches a GEO sorted set for members within a radius of a point.
     *
     * Wraps `GEOSEARCH key FROMLONLAT lng lat BYRADIUS radius km ASC`.
     * Leverages Redis's internal geohash indexing for O(log n + m)
     * lookups, far more scalable than application-side iteration.
     *
     * @param {string} key       - Redis GEO key
     * @param {number} longitude - Search centre longitude
     * @param {number} latitude  - Search centre latitude
     * @param {number} radiusKm  - Search radius in kilometres
     * @returns {Promise<string[]>} Array of matching member names, or `[]`
     */
    async geoSearch(key, longitude, latitude, radiusKm) {
        if (!(await this.ensureConnected())) return [];
        try {
            return await this.client.geoSearch(key,
                { longitude, latitude },
                { radius: radiusKm, unit: 'km' },
                { SORT: 'ASC' }
            );
        } catch (error) {
            console.error(`[Redis] Error GEOSEARCH ${key}:`, error.message);
            return [];
        }
    }

    // ─── Sorted-Set Helpers (GEO keys are sorted sets) ──────────

    /**
     * Removes one or more members from a sorted set (including GEO keys).
     *
     * @param {string} key     - Redis sorted-set / GEO key
     * @param {string|string[]} members - Member name(s) to remove
     * @returns {Promise<boolean>}
     */
    async zRem(key, members) {
        if (!(await this.ensureConnected())) return false;
        try {
            await this.client.zRem(key, members);
            return true;
        } catch (error) {
            console.error(`[Redis] Error ZREM ${key}:`, error.message);
            return false;
        }
    }

    // ─── List Commands (for LRU eviction tracking) ──────────────

    /**
     * Prepends a value to a Redis list.
     *
     * @param {string} key   - Redis list key
     * @param {string} value - Value to push
     * @returns {Promise<number>} New list length, or `0` on failure
     */
    async lPush(key, value) {
        if (!(await this.ensureConnected())) return 0;
        try {
            return await this.client.lPush(key, value);
        } catch (error) {
            console.error(`[Redis] Error LPUSH ${key}:`, error.message);
            return 0;
        }
    }

    /**
     * Returns the length of a Redis list.
     *
     * @param {string} key - Redis list key
     * @returns {Promise<number>} List length, or `0` on failure
     */
    async lLen(key) {
        if (!(await this.ensureConnected())) return 0;
        try {
            return await this.client.lLen(key);
        } catch (error) {
            console.error(`[Redis] Error LLEN ${key}:`, error.message);
            return 0;
        }
    }

    /**
     * Removes occurrences of a value from a Redis list.
     *
     * @param {string} key   - Redis list key
     * @param {string} value - Value to remove
     * @param {number} [count=0] - Number of occurrences to remove (0 = all)
     * @returns {Promise<number>} Number removed, or `0` on failure
     */
    async lRem(key, value, count = 0) {
        if (!(await this.ensureConnected())) return 0;
        try {
            return await this.client.lRem(key, count, value);
        } catch (error) {
            console.error(`[Redis] Error LREM ${key}:`, error.message);
            return 0;
        }
    }

    /**
     * Removes and returns the last (oldest) element of a Redis list.
     *
     * @param {string} key - Redis list key
     * @returns {Promise<string|null>} Popped value, or `null`
     */
    async rPop(key) {
        if (!(await this.ensureConnected())) return null;
        try {
            return await this.client.rPop(key);
        } catch (error) {
            console.error(`[Redis] Error RPOP ${key}:`, error.message);
            return null;
        }
    }

    // ─── Key Expiry ─────────────────────────────────────────────

    /**
     * Sets a TTL on an existing key.
     *
     * @param {string} key        - Redis key
     * @param {number} ttlSeconds - Expiration in seconds
     * @returns {Promise<boolean>}
     */
    async expire(key, ttlSeconds) {
        if (!(await this.ensureConnected())) return false;
        try {
            await this.client.expire(key, ttlSeconds);
            return true;
        } catch (error) {
            console.error(`[Redis] Error EXPIRE ${key}:`, error.message);
            return false;
        }
    }
}

// Export as a singleton
const redisService = new RedisService();
module.exports = redisService;
