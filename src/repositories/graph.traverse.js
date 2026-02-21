/**
 * @module repositories/graph.traverse
 * @description Low-level graph traversal layer over binary Float64Arrays.
 *
 * ## Architecture
 * The **base forward and reverse adjacency lists** are built **once** at
 * module load time (server startup, ~20 ms). Per-query, only the virtual
 * source/sink nodes are injected (O(k) where k ≈ 8 nearest stations).
 *
 * All node references use **sequential indices** (0…N−1) matching
 * `nodes.bin`.  Virtual nodes use indices N (source) and N+1 (sink).
 *
 * ## Velocity Layer
 * Each edge carries a velocity value (km/h) in {@link velocityArray}.
 * Weights are derived as `(distance_km / velocity_kmh) * 3600` seconds.
 * Velocities can be updated at runtime by
 * {@link injectTrafficData} (TomTom feed) or initialised randomly
 * within a configurable range at startup.
 *
 * ## Exports
 * | Symbol              | Description                                     |
 * |---------------------|-------------------------------------------------|
 * | `buildAugmentedGraph` | Creates per-query graph with virtual src/sink |
 * | `effectiveWeight`   | Adds waiting-time penalty for transfers          |
 * | `N`                 | Total base node count                            |
 * | `velocityArray`     | Mutable Int32Array of per-edge speeds            |
 * | `distanceArray`     | Immutable Float64Array of per-edge distances     |
 * | `rebuildWeights`    | Recalculates all edge weights from velocities    |
 * | `injectTrafficData` | Applies TomTom segment speeds to matching edges  |
 *
 * @see module:services/pathFind — Eppstein K-shortest paths consumer
 * @see module:services/traffic — TomTom polling service
 */
const graphRepo = require('../repositories/graph.repository');
const { getNearestStations, haversine } = require('../repositories/kdtree.repository');
const { getPolyline } = require('../repositories/polyline.repository');
const config = require('../config');

const N = graphRepo.getNodeCount();

// ─── Types ─────────────────────────────────────────────────

/**
 * @typedef {Object} EdgeView
 * @property {number} target - Target node INDEX (0-based sequential)
 * @property {number} weight - Travel time in seconds (includes waiting penalty for transfers)
 * @property {number} routeId - Route ID (-1 for walking/virtual)
 * @property {number} edgeType - 1=bus, 2=walk-to-bus, 3=metro, 4=walk-to-metro, 5=virtual-walk
 * @property {number} edgeOffset - Position in edges.bin for polyline lookup (-1 for virtual)
 */

/**
 * @typedef {Object} AugmentedGraph
 * @property {number} nodeCount - Total nodes including virtual source/sink
 * @property {number} srcIndex - Virtual source node index
 * @property {number} sinkIndex - Virtual sink node index
 * @property {function(number): EdgeView[]} getEdges - Forward edges for a node
 * @property {function(number): EdgeView[]} getRevEdges - Reverse edges for a node
 * @property {function(number): number} getStationId - StationId for a node
 */

// ─── Effective Weight ──────────────────────────────────────

/**
 * Computes the effective weight for an edge, including waiting penalty
 * for route transfers. Walking edges (type 2/4) always represent a
 * transfer and incur a waiting cost.
 *
 * @param {number} weight - Base travel time in seconds
 * @param {number} edgeType - Edge type
 * @returns {number} Effective weight in seconds
 */
function effectiveWeight(weight, edgeType) {
    if (edgeType === 2) return weight + config.WAITING_BUS;
    if (edgeType === 4) return weight + config.WAITING_METRO;
    return weight;
}

// ─── One-Time Startup: Build Base Adjacency ────────────────

console.time('graph.traverse: building base adjacency');

const totalEdges = graphRepo.meta.edgeCount;

/**
 * Per-edge velocity in km/h.
 * Bus edges: randomly initialized between DEFAULT_VELOCITY_MIN and DEFAULT_VELOCITY_MAX.
 * Train/metro edges: fixed at METRO_SPEED.
 * Can be updated at runtime for real-time traffic.
 * @type {Int32Array}
 */
const velocityArray = new Int32Array(totalEdges);
const vMin = 15;
const vMax = 35;

/**
 * Per-edge raw distance in km (read from binary, immutable).
 * @type {Float64Array}
 */
const distanceArray = new Float64Array(totalEdges);

/**
 * Base forward adjacency — built from binary data + velocity layer.
 * weight = (distance / velocity) * 3600 + waiting penalty
 * @type {EdgeView[][]}
 */
const baseFwd = new Array(N);

/**
 * Cached midpoints of all bus edges for fast spatial mapping with TomTom.
 * @type {Array<{ edgeOffset: number, lat: number, lng: number }>}
 */
const busEdgeMidpoints = [];
for (let i = 0; i < N; i++) {
    const raw = graphRepo.getEdges(i);
    const edgeStart = graphRepo.getEdgeStart(i);
    baseFwd[i] = raw
        .filter((e) => e.edgeType === 1 || e.edgeType === 5) // keep bus and walking edges
        .map((e, _j, filtered) => {
            // Find the original edge index in binary data
            const originalIdx = raw.indexOf(e);
            const globalEdgeIdx = edgeStart + originalIdx;

            // Store raw distance
            distanceArray[globalEdgeIdx] = e.weight; // binary weight is now distance in km

            // Set velocity: fixed for train/walk, random for bus
            if (e.edgeType === 3) {
                velocityArray[globalEdgeIdx] = config.METRO_SPEED;
            } else if (e.edgeType === 5) {
                velocityArray[globalEdgeIdx] = config.WALKING_SPEED;
            } else {
                velocityArray[globalEdgeIdx] = vMin + Math.floor(Math.random() * (vMax - vMin + 1));

                // Cache polyline midpoint for bus edges
                if (e.edgeType === 1) {
                    const poly = getPolyline(globalEdgeIdx);
                    if (poly && poly.length > 0) {
                        const midIndex = Math.floor(poly.length / 2);
                        busEdgeMidpoints.push({
                            edgeOffset: globalEdgeIdx,
                            lat: poly[midIndex][1], // [lng, lat]
                            lng: poly[midIndex][0]
                        });
                    }
                }
            }

            // Compute time = (distance_km / velocity_kmh) * 3600  →  seconds
            const velocity = velocityArray[globalEdgeIdx];
            const timeWeight = velocity > 0 ? (e.weight / velocity) * 3600 : e.weight;

            return {
                target: e.targetIndex,
                weight: effectiveWeight(timeWeight, e.edgeType),
                routeId: e.routeId,
                edgeType: e.edgeType,
                edgeOffset: globalEdgeIdx,
            };
        });
}

/**
 * Base reverse adjacency — built once from forward edges.
 * For each edge u→v in forward graph, stores v→u.
 * @type {EdgeView[][]}
 */
const baseRev = new Array(N);
for (let i = 0; i < N; i++) baseRev[i] = [];

for (let u = 0; u < N; u++) {
    for (const e of baseFwd[u]) {
        baseRev[e.target].push({
            target: u,
            weight: e.weight,
            routeId: e.routeId,
            edgeType: e.edgeType,
            edgeOffset: e.edgeOffset,
        });
    }
}

/**
 * Rebuilds all edge weights in baseFwd and baseRev from current velocities.
 * Call after updating velocityArray with real-time traffic data.
 */
function rebuildWeights() {
    // Rebuild forward
    for (let i = 0; i < N; i++) {
        for (const edge of baseFwd[i]) {
            const dist = distanceArray[edge.edgeOffset];
            const vel = velocityArray[edge.edgeOffset];
            const timeWeight = vel > 0 ? (dist / vel) * 3600 : dist;
            edge.weight = effectiveWeight(timeWeight, edge.edgeType);
        }
    }
    // Rebuild reverse
    for (let i = 0; i < N; i++) baseRev[i] = [];
    for (let u = 0; u < N; u++) {
        for (const e of baseFwd[u]) {
            baseRev[e.target].push({
                target: u,
                weight: e.weight,
                routeId: e.routeId,
                edgeType: e.edgeType,
                edgeOffset: e.edgeOffset,
            });
        }
    }
}

console.timeEnd('graph.traverse: building base adjacency');
console.log(`  Nodes: ${N}, Edges: ${totalEdges}, Velocity range: ${vMin}-${vMax} km/h`);

// ─── Per-Query: Augmented Graph with Virtual Nodes ─────────

/**
 * Creates an augmented graph by adding virtual source/sink nodes
 * to the pre-built base adjacency. Only the virtual edges are
 * constructed per query — the base graph is read-only and shared.
 *
 * Cost: O(k) where k = number of nearest stations (~8).
 *
 * @param {{ lat: number, lng: number }} startCoord
 * @param {{ lat: number, lng: number }} endCoord
 * @returns {AugmentedGraph}
 */
function buildAugmentedGraph(startCoord, endCoord) {
    const srcIndex = N;
    const sinkIndex = N + 1;
    const totalNodes = N + 2;

    /** @type {EdgeView[]} */
    const srcFwdEdges = [];
    /** @type {EdgeView[]} */
    const sinkFwdEdges = [];
    /** @type {EdgeView[]} */
    const srcRevEdges = [];
    /** @type {EdgeView[]} */
    const sinkRevEdges = [];

    /** @type {Map<number, EdgeView[]>} */
    const extraFwd = new Map();
    /** @type {Map<number, EdgeView[]>} */
    const extraRev = new Map();

    // Connect source → nearest start stations (walk edges)
    const startStations = getNearestStations(startCoord.lat, startCoord.lng);
    // console.log(`[AugGraph] Start Stations: ${startStations.length}`);
    for (const s of startStations) {
        const idx = graphRepo.indexOfStation(s.id);
        if (idx === undefined) {
            // console.log(`  Start Station ${s.id} not in graph`);
            continue;
        }
        const walkTime = (s.distance / config.WALKING_SPEED) * 3600;

        srcFwdEdges.push({ target: idx, weight: walkTime, routeId: -1, edgeType: 5, edgeOffset: -1 });

        if (!extraRev.has(idx)) extraRev.set(idx, []);
        extraRev.get(idx).push({ target: srcIndex, weight: walkTime, routeId: -1, edgeType: 5, edgeOffset: -1 });
    }

    // Connect nearest end stations → sink (walk edges)
    const endStations = getNearestStations(endCoord.lat, endCoord.lng);
    for (const s of endStations) {
        const idx = graphRepo.indexOfStation(s.id);
        if (idx === undefined) {
            continue;
        }
        const walkTime = (s.distance / config.WALKING_SPEED) * 3600;

        if (!extraFwd.has(idx)) extraFwd.set(idx, []);
        extraFwd.get(idx).push({ target: sinkIndex, weight: walkTime, routeId: -1, edgeType: 5, edgeOffset: -1 });

        sinkRevEdges.push({ target: idx, weight: walkTime, routeId: -1, edgeType: 5, edgeOffset: -1 });
    }

    return {
        nodeCount: totalNodes,
        srcIndex,
        sinkIndex,
        startCoord: startCoord,
        endCoord: endCoord,

        /** @param {number} i */
        getEdges(i) {
            if (i === srcIndex) return srcFwdEdges;
            if (i === sinkIndex) return sinkFwdEdges;
            const extra = extraFwd.get(i);
            if (extra) return baseFwd[i].concat(extra);
            return baseFwd[i] || [];
        },

        /** @param {number} i */
        getRevEdges(i) {
            if (i === srcIndex) return srcRevEdges;
            if (i === sinkIndex) return sinkRevEdges;
            const extra = extraRev.get(i);
            if (extra) return baseRev[i].concat(extra);
            return baseRev[i] || [];
        },

        /** @param {number} i */
        getStationId(i) {
            if (i === srcIndex) return -1;
            if (i === sinkIndex) return -2;
            return graphRepo.getNode(i).stationId;
        },
    };
}

/**
 * Injects real-time TomTom traffic data into the routing graph.
 *
 * For each TomTom segment, the method:
 * 1. Builds a bounding box (±50 m padding) around the segment coords.
 * 2. Checks all cached bus-edge midpoints against the bounding box.
 * 3. For edges within 30 m of a segment coordinate, sets the edge
 *    velocity to the segment’s `currentSpeed`.
 * 4. For edges **not** matched by any segment, applies a regional
 *    congestion factor derived from the average `currentSpeed / freeFlowSpeed`
 *    ratio across all segments.
 * 5. Calls {@link rebuildWeights} to recalculate all edge travel times.
 *
 * @param {Array<{ currentSpeed: number, freeFlowSpeed: number,
 *   coordinates: Array<{ latitude: number, longitude: number }> }>} segmentResults
 *   Parsed TomTom flow-segment responses
 * @returns {void}
 */
function injectTrafficData(segmentResults) {
    if (!segmentResults || segmentResults.length === 0) return;

    console.time('graph.traverse: injectTrafficData');

    let matchedEdges = 0;
    let sumCurrent = 0;
    let sumFreeFlow = 0;
    const mappedEdges = new Set();

    for (const segment of segmentResults) {
        const speed = segment.currentSpeed;
        const freeFlow = segment.freeFlowSpeed;
        const coords = segment.coordinates;
        if (!coords || coords.length === 0) continue;

        if (speed && freeFlow) {
            sumCurrent += speed;
            sumFreeFlow += freeFlow;
        }

        // Build slightly expanded bounding box (~50m) for initial filtering
        let minLat = 90, maxLat = -90, minLng = 180, maxLng = -180;
        for (const pt of coords) {
            if (pt.latitude < minLat) minLat = pt.latitude;
            if (pt.latitude > maxLat) maxLat = pt.latitude;
            if (pt.longitude < minLng) minLng = pt.longitude;
            if (pt.longitude > maxLng) maxLng = pt.longitude;
        }

        const pad = 0.0005; // ~50m padding
        minLat -= pad; maxLat += pad;
        minLng -= pad; maxLng += pad;

        for (const mid of busEdgeMidpoints) {
            // Fast bounding box check
            if (mid.lat >= minLat && mid.lat <= maxLat && mid.lng >= minLng && mid.lng <= maxLng) {
                // Exact distance check
                let minDist = Infinity;
                for (const pt of coords) {
                    const d = haversine(mid.lat, mid.lng, pt.latitude, pt.longitude);
                    if (d < minDist) minDist = d;
                }

                // If edge midpoint is within 30 meters of TomTom segment coordinates
                if (minDist <= 0.03) {
                    velocityArray[mid.edgeOffset] = speed;
                    mappedEdges.add(mid.edgeOffset);
                    matchedEdges++;
                }
            }
        }
    }

    // Regional Interpolation
    let globalCongestionFactor = 1.0;
    if (sumFreeFlow > 0) {
        // e.g. 30km/h current / 40km/h freeflow = 0.75
        globalCongestionFactor = sumCurrent / sumFreeFlow;
        // Bound between 0.3 (heavy jam) and 1.0 (free flow)
        globalCongestionFactor = Math.max(0.3, Math.min(globalCongestionFactor, 1.0));
    }

    const baseMin = config.DEFAULT_VELOCITY_MIN;
    const baseMax = config.DEFAULT_VELOCITY_MAX;

    for (const mid of busEdgeMidpoints) {
        if (!mappedEdges.has(mid.edgeOffset)) {
            // Unmapped minor edge: generate a random baseline and scale it by the city's overall congestion level
            const rawSpeed = baseMin + Math.floor(Math.random() * (baseMax - baseMin + 1));
            const interpolatedSpeed = Math.max(5, Math.floor(rawSpeed * globalCongestionFactor)); // Ensure a minimum speed of 5 km/h
            velocityArray[mid.edgeOffset] = interpolatedSpeed;
        }
    }

    console.log(`[Traffic] Mapped TomTom data to ${matchedEdges} specific bus edges.`);
    console.log(`[Traffic] Applied Regional Congestion Factor of ${(globalCongestionFactor * 100).toFixed(1)}% to ${busEdgeMidpoints.length - mappedEdges.size} minor edges.`);
    console.timeEnd('graph.traverse: injectTrafficData');

    // Trigger weight rebuild immediately after injecting new speeds
    rebuildWeights();
}

module.exports = { buildAugmentedGraph, effectiveWeight, N, velocityArray, distanceArray, rebuildWeights, injectTrafficData };
