/**
 * @file buildBinaryGraph.js
 * @description Offline build script that reads Routes.json + Stations.json
 * and produces three output files in the data/ directory:
 *  @param {number} targetIndex - Relative Index of the target node in node.bin 
 * that the egde lead to 
 * - **nodes.bin** — Float64Array, {@link NODE_STRIDE} values per node:
 *   `[stationId, edgeOffset]`
 *
 * - **edges.bin** — Float64Array, {@link EDGE_STRIDE} values per edge:
 *   `[targetIndex, weight, routeId, edgeType]`* 
 *
 * - **meta.json** — String data + stationId↔index mapping
 * Edge weight = distance in km (velocity applied at runtime)
 *
 * Edge types:
 * | Value | Meaning       |
 * |-------|---------------|
 * | 1     | Bus           |
 * | 2     | Walk-to-bus   |
 * | 3     | Metro         |
 * | 4     | Walk-to-metro |
 *
 */

const fs = require('fs');
const path = require('path');
const { getNearestStations, haversine } = require('../src/repositories/kdtree.repository');

// Speed constants removed — velocity is now applied at runtime in graph.traverse.js

/** @constant {number} Number of Float64 values per node record */
const NODE_STRIDE = 2;

/** @constant {number} Number of Float64 values per edge record */
const EDGE_STRIDE = 4;

const dataDir = path.join(__dirname, '..', 'data');
const Routes = JSON.parse(fs.readFileSync(path.join(dataDir, 'Routes.json'), 'utf-8'));
const Stations = JSON.parse(fs.readFileSync(path.join(dataDir, 'Stations.json'), 'utf-8'));

/**
 * Computes the total haversine distance along a polyline path string.
 * @param {string} pathStr - Space-separated "lng,lat" coordinate pairs
 * @returns {number} Total distance in km
 */
function computePathDistance(pathStr) {
    if (!pathStr || pathStr.trim() === '') return 0;
    const points = pathStr.trim().split(/\s+/).map(p => {
        const [lng, lat] = p.split(',').map(Number);
        return { lat, lng };
    });
    if (points.length < 2) return 0;
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += haversine(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
    }
    return total;
}

// speedForType() removed — velocity is now applied at runtime

/**
 * Encodes a "lng,lat lng,lat ..." path string into Google Encoded Polyline format.
 * Each coordinate is rounded to 5 decimal places and delta-encoded.
 * @param {string} pathStr - Space-separated "lng,lat" pairs
 * @returns {string} Encoded polyline string (empty if no valid points)
 */
function encodePolyline(pathStr) {
    if (!pathStr || pathStr.trim() === '') return '';
    const points = pathStr.trim().split(/\s+/).map(p => {
        const [lng, lat] = p.split(',').map(Number);
        return [lat, lng]; // Google encoded polyline uses [lat, lng] order
    });
    if (points.length < 2) return '';

    let prevLat = 0, prevLng = 0;
    let encoded = '';

    for (const [lat, lng] of points) {
        const dLat = Math.round((lat - prevLat) * 1e5);
        const dLng = Math.round((lng - prevLng) * 1e5);
        prevLat = lat;
        prevLng = lng;

        for (const delta of [dLat, dLng]) {
            let val = delta < 0 ? ~(delta << 1) : (delta << 1);
            while (val >= 0x20) {
                encoded += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
                val >>= 5;
            }
            encoded += String.fromCharCode(val + 63);
        }
    }
    return encoded;
}

/* ── Step 1: Collect unique stations ────────────────────── */
console.log('Step 1: Collecting unique stations...');

/** @type {Map<number, { lat: number, lng: number, name: string, address: string, stationType: number }>} */
const stationMap = new Map();

for (const station of Stations) {
    if (!stationMap.has(station.stationId)) {
        stationMap.set(station.stationId, {
            lat: station.lat,
            lng: station.lng,
            name: station.stationName || '',
            address: station.stationAddress || '',
            stationType: station.stationType || 1,
        });
    }
}

const stationIds = Array.from(stationMap.keys()).sort((a, b) => a - b);

/** @type {Map<number, number>} Maps stationId → sequential index */
const stationIdToIndex = new Map();
for (let i = 0; i < stationIds.length; i++) {
    stationIdToIndex.set(stationIds[i], i);
}

console.log(`  Found ${stationIds.length} unique stations`);

/* ── Step 2: Build adjacency list ───────────────────────── */
console.log('Step 2: Building adjacency list...');

/** @type {Map<number, Array<{ targetIndex: number, weight: number, routeId: number, edgeType: number, pathString: string }>>} */
const adjacency = new Map();
for (let i = 0; i < stationIds.length; i++) {
    adjacency.set(i, []);
}

// Walking and metro edges removed — only bus edges (edgeType 1) are built

/* 2b: Route edges (bus/metro) */
console.log('  Adding route edges...');
for (const route of Routes) {
    for (let i = 0; i < route.stations.length - 1; i++) {
        const curr = route.stations[i];
        const next = route.stations[i + 1];

        if (curr.stationId === next.stationId) continue;
        if (!stationIdToIndex.has(curr.stationId) || !stationIdToIndex.has(next.stationId)) continue;

        const fromIdx = stationIdToIndex.get(curr.stationId);
        const toIdx = stationIdToIndex.get(next.stationId);

        const pathString = [
            `${curr.lng},${curr.lat}`,
            next.pathPoints?.trim(),
            `${next.lng},${next.lat}`
        ].filter(Boolean).join(' ');

        const distance = computePathDistance(pathString);
        const edgeType = 1; // bus only
        const weight = distance; // raw distance in km

        adjacency.get(fromIdx).push({ targetIndex: toIdx, weight, routeId: next.routeId, edgeType, pathString });
    }
}

/* 2c: Walking edges (Type 5) */
const walkEdgesPath = path.join(dataDir, 'walking_edges.json');
if (fs.existsSync(walkEdgesPath)) {
    console.log('  Adding pre-computed OSRM walking edges...');
    const walkEdges = JSON.parse(fs.readFileSync(walkEdgesPath, 'utf-8'));
    let addedWalkEdges = 0;

    for (const edge of walkEdges) {
        if (!stationIdToIndex.has(edge.fromStation) || !stationIdToIndex.has(edge.toStation)) continue;

        const fromIdx = stationIdToIndex.get(edge.fromStation);
        const toIdx = stationIdToIndex.get(edge.toStation);

        adjacency.get(fromIdx).push({
            targetIndex: toIdx,
            weight: edge.distanceKm,
            routeId: -1,
            edgeType: edge.type || 5, // 5 = Walking
            pathString: null,
            preEncodedPolyline: edge.polyline // OSRM geometry is already encoded
        });

        addedWalkEdges++;
    }
    console.log(`    Added ${addedWalkEdges} walking edges into the base graph.`);
}

/* ── Step 3: Flatten into binary Float64Arrays ──────────── */

console.log('Step 3: Writing binary files...');

let totalEdges = 0;
for (const edges of adjacency.values()) {
    totalEdges += edges.length;
}

const nodeBuffer = new Float64Array(stationIds.length * NODE_STRIDE);
const edgeBuffer = new Float64Array(totalEdges * EDGE_STRIDE);

let edgeOffset = 0;
/** @type {string[]} Encoded polyline per edge, indexed by edge offset */
const polylines = [];

for (let i = 0; i < stationIds.length; i++) {
    const sid = stationIds[i];
    const edges = adjacency.get(i);

    nodeBuffer[i * NODE_STRIDE + 0] = sid;
    nodeBuffer[i * NODE_STRIDE + 1] = edgeOffset;

    for (const edge of edges) {
        edgeBuffer[edgeOffset * EDGE_STRIDE + 0] = edge.targetIndex;
        edgeBuffer[edgeOffset * EDGE_STRIDE + 1] = edge.weight;
        edgeBuffer[edgeOffset * EDGE_STRIDE + 2] = edge.routeId;
        edgeBuffer[edgeOffset * EDGE_STRIDE + 3] = edge.edgeType;

        const poly = edge.preEncodedPolyline || encodePolyline(edge.pathString);
        polylines.push(poly);
        edgeOffset++;
    }
}

fs.writeFileSync(path.join(dataDir, 'nodes.bin'), Buffer.from(nodeBuffer.buffer));
fs.writeFileSync(path.join(dataDir, 'edges.bin'), Buffer.from(edgeBuffer.buffer));

/* ── Step 4: Write meta.json ────────────────────────────── */
const stationNames = {};
const stationAddresses = {};
const idToIndex = {};

for (let i = 0; i < stationIds.length; i++) {
    const sid = stationIds[i];
    const info = stationMap.get(sid);
    stationNames[i] = info.name;
    stationAddresses[i] = info.address;
    idToIndex[sid] = i;
}

const meta = {
    nodeCount: stationIds.length,
    edgeCount: totalEdges,
    NODE_STRIDE,
    EDGE_STRIDE,
    stationIdToIndex: idToIndex,
    stationNames,
    stationAddresses,
};

fs.writeFileSync(path.join(dataDir, 'meta.json'), JSON.stringify(meta));

/* ── Step 5: Write polylines.json ───────────────────────── */
const polylinesJson = JSON.stringify(polylines);
fs.writeFileSync(path.join(dataDir, 'polylines.json'), polylinesJson);
const nonEmpty = polylines.filter(p => p.length > 0).length;
console.log(`  Polylines: ${nonEmpty}/${polylines.length} edges have geometry`);

/* ── Summary ────────────────────────────────────────────── */
const nodeFileSize = (stationIds.length * NODE_STRIDE * 8 / 1024).toFixed(1);
const edgeFileSize = (totalEdges * EDGE_STRIDE * 8 / 1024).toFixed(1);

console.log(`\nDone!`);
console.log(`  Nodes: ${stationIds.length} (${nodeFileSize} KB)`);
console.log(`  Edges: ${totalEdges} (${edgeFileSize} KB)`);
console.log(`  Avg degree: ${(totalEdges / stationIds.length).toFixed(1)}`);
console.log(`  Files written to: ${dataDir}`);
