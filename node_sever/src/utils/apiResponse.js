/**
 * @module utils/apiResponse
 * @description Standardised API response envelope used by all controllers.
 *
 * Every HTTP response follows a consistent JSON shape:
 * ```json
 * {
 *   "success":  boolean,
 *   "message":  string,
 *   "data":     any | null,
 *   "error":    string | null,
 *   "metadata": {
 *     "timestamp":      number,      // epoch seconds
 *     "processingTime": "42ms"       // optional
 *   }
 * }
 * ```
 *
 * @see module:controllers/find — route-finding controller
 * @see module:controllers/map  — geocoding controller
 */

/**
 * Static helper class for building uniform API responses.
 *
 * @class ApiResponse
 * @example
 * // Success response
 * ApiResponse.success(res, { routes: [...] }, 'Success', startTimeMs);
 *
 * // Error response
 * ApiResponse.error(res, 'Missing param', 'Validation failed', startTimeMs, 400);
 */
class ApiResponse {
    /**
     * Sends a **success** response (HTTP 2xx).
     *
     * @param {import('express').Response} res - Express response object
     * @param {*}      [data=null]        - Payload to include in `data`
     * @param {string} [message='Success'] - Human-readable success message
     * @param {number|null} [startTimeMs=null] - `Date.now()` at the start of the
     *   request; when provided, `processingTime` is calculated and included
     * @param {number} [status=200]       - HTTP status code
     * @returns {import('express').Response}
     */
    static success(res, data = null, message = 'Success', startTimeMs = null, status = 200) {
        let processingTime;
        if (startTimeMs) {
            processingTime = `${Date.now() - startTimeMs}ms`;
        }

        return res.status(status).json({
            success: true,
            message,
            data,
            error: null,
            metadata: {
                timestamp: Math.floor(Date.now() / 1000),
                ...(processingTime && { processingTime })
            }
        });
    }

    /**
     * Sends an **error** response (HTTP 4xx/5xx).
     *
     * If `error` is an `Error` instance, only the `message` property is
     * serialised (no stack trace leakage).
     *
     * @param {import('express').Response} res - Express response object
     * @param {string|Error} error - Detailed error; `Error.message` is
     *   extracted when an `Error` object is passed
     * @param {string} [message='An error occurred'] - User-facing error message
     * @param {number|null} [startTimeMs=null] - Request start timestamp
     * @param {number} [status=400] - HTTP status code
     * @returns {import('express').Response}
     */
    static error(res, error, message = 'An error occurred', startTimeMs = null, status = 400) {
        let processingTime;
        if (startTimeMs) {
            processingTime = `${Date.now() - startTimeMs}ms`;
        }

        const errorMsg = error instanceof Error ? error.message : String(error);

        return res.status(status).json({
            success: false,
            message,
            data: null,
            error: errorMsg,
            metadata: {
                timestamp: Math.floor(Date.now() / 1000),
                ...(processingTime && { processingTime })
            }
        });
    }
}

module.exports = ApiResponse;
