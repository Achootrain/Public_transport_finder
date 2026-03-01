/**
 * @file buildKdTree.js
 * @description Offline build script that reads Stations.json, constructs
 * a balanced KD-tree via median splitting, and serializes it to kdtree.bin.
 *
 * Binary layout per node ({@link NODE_STRIDE} = 6 Float64 values):
 *   `[lat, lng, stationId, stationType, leftChildIndex, rightChildIndex]`
 *
 * Child indices of -1 indicate a null (leaf) branch.
 *
 * @example
 * // Run from server root:
 * // node scripts/buildKdTree.js
 * // — or —
 * // npm run build:kdtree
 */

const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const Stations = JSON.parse(fs.readFileSync(path.join(dataDir, 'Stations.json'), 'utf-8'));

/** @constant {number} Number of Float64 values per KD-tree node */
const NODE_STRIDE = 6;

/* Deduplicate stations by stationId */
const seen = new Set();

/** @type {Array<{ lat: number, lng: number, stationId: number, stationType: number }>} */
const points = [];
for (const s of Stations) {
    if (!seen.has(s.stationId)) {
        seen.add(s.stationId);
        points.push({
            lat: s.lat,
            lng: s.lng,
            stationId: s.stationId,
            stationType: s.stationType || 1,
        });
    }
}

console.log(`Building KD-tree from ${points.length} unique stations...`);

/** @type {Array<{ lat: number, lng: number, stationId: number, stationType: number, left: number, right: number }>} */
const nodes = [];

/**
 * Recursively builds a balanced KD-tree by median splitting.
 * Even depths split on latitude, odd depths split on longitude.
 *
 * @param {Array<{ lat: number, lng: number, stationId: number, stationType: number }>} pts - Points to partition
 * @param {number} depth - Current tree depth (determines split axis)
 * @returns {number} Index of the root node of this subtree (-1 if empty)
 */
function buildTree(pts, depth) {
    if (pts.length === 0) return -1;

    const axis = depth % 2;
    pts.sort((a, b) => axis === 0 ? a.lat - b.lat : a.lng - b.lng);

    const median = Math.floor(pts.length / 2);
    const p = pts[median];

    const idx = nodes.length;
    nodes.push({ lat: p.lat, lng: p.lng, stationId: p.stationId, stationType: p.stationType, left: -1, right: -1 });

    nodes[idx].left = buildTree(pts.slice(0, median), depth + 1);
    nodes[idx].right = buildTree(pts.slice(median + 1), depth + 1);

    return idx;
}

buildTree(points, 0);

/* Write to Float64Array binary */
const buffer = new Float64Array(nodes.length * NODE_STRIDE);
for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    buffer[i * NODE_STRIDE + 0] = n.lat;
    buffer[i * NODE_STRIDE + 1] = n.lng;
    buffer[i * NODE_STRIDE + 2] = n.stationId;
    buffer[i * NODE_STRIDE + 3] = n.stationType;
    buffer[i * NODE_STRIDE + 4] = n.left;
    buffer[i * NODE_STRIDE + 5] = n.right;
}

const outPath = path.join(dataDir, 'kdtree.bin');
fs.writeFileSync(outPath, Buffer.from(buffer.buffer));

const sizeKB = (nodes.length * NODE_STRIDE * 8 / 1024).toFixed(1);
console.log(`Nodes: ${nodes.length}`);
console.log(`Written: ${outPath} (${sizeKB} KB)`);
