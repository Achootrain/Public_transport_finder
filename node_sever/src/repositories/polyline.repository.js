/**
 * @module repositories/polyline
 * @description Loads encoded polylines from polylines.json and provides
 * decoding for path reconstruction.
 *
 * Each edge in edges.bin has a corresponding entry in polylines.json
 * at the same index (edge offset). Polylines use Google Encoded Polyline
 * format for ~90% size reduction vs raw Float64 coordinates.
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');

/** @type {string[]} Encoded polyline per edge, indexed by edge offset */
const polylines = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'polylines.json'), 'utf-8')
);

console.log(`  Polylines loaded: ${polylines.length} edges`);

/**
 * Decodes a Google Encoded Polyline string into an array of [lng, lat] pairs.
 *
 * @param {string} encoded - Google Encoded Polyline string
 * @returns {Array<[number, number]>} Array of [lng, lat] coordinate pairs
 */
function decodePolyline(encoded) {
    if (!encoded) return [];

    const points = [];
    let index = 0;
    let lat = 0, lng = 0;

    while (index < encoded.length) {
        // Decode latitude
        let shift = 0, result = 0, byte;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);

        // Decode longitude
        shift = 0; result = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);

        points.push([lng / 1e5, lat / 1e5]); // [lng, lat] order to match original
    }

    return points;
}

/**
 * Returns the decoded polyline for a given edge offset.
 *
 * @param {number} edgeOffset - Edge position in edges.bin (0-based)
 * @returns {Array<[number, number]>} Array of [lng, lat] coordinate pairs
 */
function getPolyline(edgeOffset) {
    if (edgeOffset < 0 || edgeOffset >= polylines.length) return [];
    return decodePolyline(polylines[edgeOffset]);
}

/**
 * Returns the raw encoded polyline string (for passing to frontend).
 *
 * @param {number} edgeOffset - Edge position in edges.bin (0-based)
 * @returns {string} Encoded polyline string, or empty string
 */
function getEncodedPolyline(edgeOffset) {
    if (edgeOffset < 0 || edgeOffset >= polylines.length) return '';
    return polylines[edgeOffset] || '';
}

module.exports = { getPolyline, getEncodedPolyline, decodePolyline };
