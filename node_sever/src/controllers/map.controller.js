/**
 * @module controllers/map
 * @description Proxies geocoding and autocomplete requests to the Goong Maps API.
 */
const axios = require('axios');
const config = require('../config');
const ApiResponse = require('../utils/apiResponse');

/**
 * GET /Map/get
 *
 * Geocodes an address string into up to 3 lat/lng coordinates
 * using the Goong geocoding API.
 *
 * @param {import('express').Request} req - Expects `?address=...`
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function geocode(req, res) {
    const startTimeMs = Date.now();
    try {
        const { address } = req.query;
        if (!address) {
            return ApiResponse.error(res, 'Address parameter is required', 'Validation failed', startTimeMs, 400);
        }

        const url = `https://rsapi.goong.io/geocode?address=${encodeURIComponent(address)}&api_key=${config.GOONG_API}`;
        const response = await axios.get(url);
        const results = response.data.results;

        if (!results || results.length === 0) {
            return ApiResponse.error(res, 'No results found', 'Not found', startTimeMs, 404);
        }

        const coordinates = results.slice(0, 3).map((r) => ({
            lat: r.geometry.location.lat,
            lng: r.geometry.location.lng,
        }));

        return ApiResponse.success(res, coordinates, 'Success', startTimeMs);
    } catch (error) {
        console.error('Error fetching geocode data:', error.message);
        return ApiResponse.error(res, error, 'Internal Server Error', startTimeMs, 500);
    }
}

/**
 * GET /Map/autoComplete
 *
 * Returns place suggestions for a partial input string
 * using the Goong Place AutoComplete API.
 *
 * @param {import('express').Request} req - Expects `?input=...`
 * @param {import('express').Response} res
 * @returns {Promise<void>}
 */
async function autoComplete(req, res) {
    const startTimeMs = Date.now();
    try {
        const { input } = req.query;
        if (!input) {
            return ApiResponse.error(res, "The 'input' parameter is required.", 'Validation failed', startTimeMs, 400);
        }

        const url = `https://rsapi.goong.io/Place/AutoComplete?api_key=${config.GOONG_API}&input=${encodeURIComponent(input)}`;
        const response = await axios.get(url);
        const { predictions } = response.data;

        if (!predictions || predictions.length === 0) {
            return ApiResponse.error(res, 'No predictions found', 'Not found', startTimeMs, 404);
        }

        const refinedData = predictions.map((p, i) => ({
            id: i + 1,
            main_text: p.structured_formatting.main_text,
            secondary_text: p.structured_formatting.secondary_text,
            description: p.description,
        }));

        return ApiResponse.success(res, refinedData, 'Success', startTimeMs);
    } catch (error) {
        console.error('Error fetching autocomplete data:', error.message);
        return ApiResponse.error(res, error, 'Internal Server Error', startTimeMs, 500);
    }
}

module.exports = { geocode, autoComplete };
