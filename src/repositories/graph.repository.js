/**
 * @module repositories/graph
 * @description Binary graph loader and O(1) accessor for the transit
 * network stored in `nodes.bin` + `edges.bin`.
 *
 * ## Binary Layout
 * - **nodes.bin** — `Float64Array`, stride {@link NODE_STRIDE}:
 *   `[stationId, edgeOffset]` per node
 * - **edges.bin** — `Float64Array`, stride {@link EDGE_STRIDE}:
 *   `[targetIndex, weight, routeId, edgeType]` per edge
 * - **meta.json** — counts, strides, string mappings
 *
 * All data is loaded into memory at module initialisation and
 * remains immutable for the lifetime of the process.
 *
 * @see module:repositories/graph.traverse — builds adjacency lists on top of this data
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');

/** @type {Float64Array} Flat node array: [stationId, edgeOffset] per node */
const nodeData = new Float64Array(
    fs.readFileSync(path.join(dataDir, 'nodes.bin')).buffer.slice(0)
);

/** @type {Float64Array} Flat edge array: [targetIndex, weight, routeId, edgeType] per edge */
const edgeData = new Float64Array(
    fs.readFileSync(path.join(dataDir, 'edges.bin')).buffer.slice(0)
);

/** @type {Object} Metadata including strides, counts, and string mappings */
const meta = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf-8')
);

const NODE_STRIDE = meta.NODE_STRIDE;
const EDGE_STRIDE = meta.EDGE_STRIDE;
const nodeCount = meta.nodeCount;
const edgeCount = meta.edgeCount;

/** @type {Map<number, number>} Maps original stationId → sequential index */
const stationIdToIndex = new Map();
for (const [sid, idx] of Object.entries(meta.stationIdToIndex)) {
    stationIdToIndex.set(Number(sid), idx);
}

/**
 * Returns the total number of nodes in the graph.
 * @returns {number}
 */
function getNodeCount() {
    return nodeCount;
}

/**
 * Returns a node by its sequential index.
 * @param {number} index - Sequential node index (0-based)
 * @returns {{ stationId: number }} 
 */
function getNode(index) {
    const base = index * NODE_STRIDE;
    return { stationId: nodeData[base] };
}

/**
 * Returns all outgoing edges for a given node.
 * @param {number} index - Sequential node index (0-based)
 * @param {number} edgesStart - Starting realtive index of edges for the given node
 * @param {number} edgesEnd - Ending realtive index of edges for the given node
 * @param {number} base -  Exact index of the edge in the edge array
 * @returns {Array<{ targetIndex: number, weight: number, routeId: number, edgeType: number }>}
 * @example
 * 
 */
function getEdges(index) {
    const edgeStart = nodeData[index * NODE_STRIDE + 1];
    const edgeEnd =
        index + 1 < nodeCount
            ? nodeData[(index + 1) * NODE_STRIDE + 1]
            : edgeCount;

    const edges = [];
    for (let e = edgeStart; e < edgeEnd; e++) {
        const base = e * EDGE_STRIDE;
        edges.push({
            targetIndex: edgeData[base],
            weight: edgeData[base + 1],
            routeId: edgeData[base + 2],
            edgeType: edgeData[base + 3],
        });
    }
    return edges;
}

/**
 * Looks up the sequential index for a given stationId.
 * @param {number} stationId - Original station ID
 * @returns {number|undefined} Sequential index, or undefined if not found
 */
function indexOfStation(stationId) {
    return stationIdToIndex.get(stationId);
}

/**
 * Returns the display name for a station by index.
 * @param {number} index - Sequential node index
 * @returns {string}
 */
function getStationName(index) {
    return meta.stationNames[index] || '';
}

/**
 * Returns the address for a station by index.
 * @param {number} index - Sequential node index
 * @returns {string}
 */
function getStationAddress(index) {
    return meta.stationAddresses[index] || '';
}

/**
 * Returns the starting edge offset for a node in edges.bin.
 * @param {number} index - Sequential node index (0-based)
 * @returns {number} Edge offset (position in the flat edge array)
 */
function getEdgeStart(index) {
    return nodeData[index * NODE_STRIDE + 1];
}

module.exports = {
    getNodeCount,
    getNode,
    getEdges,
    getEdgeStart,
    indexOfStation,
    getStationName,
    getStationAddress,
    stationIdToIndex,
    meta,
};
