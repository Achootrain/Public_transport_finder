/**
 * @module repositories/kdtree
 * @description Loads the serialized KD-tree (kdtree.bin) into a Float64Array
 * and provides K-nearest-neighbor search over transit stations.
 *
 * Binary layout per node (NODE_STRIDE = 6):
 *   [lat, lng, stationId, stationType, leftChildIndex, rightChildIndex]
 */
const fs = require('fs');
const path = require('path');
const { haversine } = require('../utils/haversine');

const dataDir = path.join(__dirname, '..', '..', 'data');
const raw = fs.readFileSync(path.join(dataDir, 'kdtree.bin'));

/** @type {Float64Array} Flat KD-tree node array */
const tree = new Float64Array(raw.buffer, raw.byteOffset, raw.byteLength / 8);

/** @constant {number} Fields per KD-tree node */
const NODE_STRIDE = 6;

/** @type {number} Total number of nodes in the tree */
const nodeCount = tree.length / NODE_STRIDE;

/**
 * @param {number} i - Node index
 * @returns {number} Latitude
 */
function nLat(i) { return tree[i * NODE_STRIDE]; }

/**
 * @param {number} i - Node index
 * @returns {number} Longitude
 */
function nLng(i) { return tree[i * NODE_STRIDE + 1]; }

/**
 * @param {number} i - Node index
 * @returns {number} Station ID
 */
function nId(i) { return tree[i * NODE_STRIDE + 2]; }

/**
 * @param {number} i - Node index
 * @returns {number} Station type (1 = bus, 3 = metro)
 */
function nType(i) { return tree[i * NODE_STRIDE + 3]; }

/**
 * @param {number} i - Node index
 * @returns {number} Left child index (-1 if none)
 */
function nLeft(i) { return tree[i * NODE_STRIDE + 4]; }

/**
 * @param {number} i - Node index
 * @returns {number} Right child index (-1 if none)
 */
function nRight(i) { return tree[i * NODE_STRIDE + 5]; }

/**
 * Squared coordinate distance for fast tree pruning (not geodesic).
 * @param {number} lat1
 * @param {number} lng1
 * @param {number} lat2
 * @param {number} lng2
 * @returns {number}
 */
function distSq(lat1, lng1, lat2, lng2) {
    return (lat1 - lat2) ** 2 + (lng1 - lng2) ** 2;
}

/**
 * Finds the K nearest transit stations to a given coordinate.
 * Uses the binary KD-tree for efficient spatial search, then filters
 * results by haversine distance.
 *
 * @param {number} lat - Query latitude
 * @param {number} lng - Query longitude
 * @param {number} [k=8] - Maximum number of neighbors to return
 * @param {number} [maxDistKm=0.5] - Maximum haversine distance in km
 * @returns {Array<{ id: number, lat: number, lng: number, distance: number, type: number }>}
 *   Nearest stations sorted by distance, each containing:
 *   - `id`       — original stationId
 *   - `lat/lng`  — station coordinates
 *   - `distance` — haversine distance in km
 *   - `type`     — station type (1 = bus, 3 = metro)
 */
function getNearestStations(lat, lng, k = 8, maxDistKm = 2) {
    if (nodeCount === 0) return [];

    /** @type {Array<{ idx: number, dSq: number }>} */
    const nearest = [];

    /**
     * Recursively searches the KD-tree, pruning branches that cannot
     * contain closer points than the current K-th nearest.
     * @param {number} idx - Current tree node index
     * @param {number} depth - Current depth (determines split axis)
     */
    function search(idx, depth) {
        if (idx === -1) return;

        const la = nLat(idx);
        const lo = nLng(idx);
        const dSq = distSq(la, lo, lat, lng);

        nearest.push({ idx, dSq });
        nearest.sort((a, b) => a.dSq - b.dSq);
        if (nearest.length > k) nearest.pop();

        const axis = depth % 2;
        const val = axis === 0 ? lat : lng;
        const nodeVal = axis === 0 ? la : lo;

        const first = val < nodeVal ? nLeft(idx) : nRight(idx);
        const second = val < nodeVal ? nRight(idx) : nLeft(idx);

        search(first, depth + 1);

        const axisDiff = (nodeVal - val) ** 2;
        if (nearest.length < k || axisDiff < nearest[nearest.length - 1].dSq) {
            search(second, depth + 1);
        }
    }

    search(0, 0);

    const result = [];
    for (const n of nearest) {
        const dist = haversine(lat, lng, nLat(n.idx), nLng(n.idx));
        if (dist <= maxDistKm) {
            result.push({
                id: nId(n.idx),
                lat: nLat(n.idx),
                lng: nLng(n.idx),
                distance: dist,
                type: nType(n.idx),
            });
        }
    }

    return result;
}

module.exports = { getNearestStations, haversine };
