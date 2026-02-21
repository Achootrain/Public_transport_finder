/**
 * Mock for repositories/graph.repository.js
 * Uses sampleGraph fixture data.
 */
const { nodes, edges, stationIdToIndex } = require('../fixtures/sampleGraph');

const nodeCount = nodes.length;

const adjacency = new Map();
for (let i = 0; i < nodeCount; i++) adjacency.set(i, []);
let edgeOffset = 0;
for (const e of edges) {
    adjacency.get(e.from).push({
        targetIndex: e.to,
        weight: e.weight,
        routeId: e.routeId,
        edgeType: e.edgeType,
        _offset: edgeOffset++,
    });
}

const edgeStarts = new Map();
let offset = 0;
for (let i = 0; i < nodeCount; i++) {
    edgeStarts.set(i, offset);
    offset += adjacency.get(i).length;
}

module.exports = {
    getNodeCount: () => nodeCount,
    getNode: (index) => ({ stationId: nodes[index].stationId }),
    getEdges: (index) => adjacency.get(index) || [],
    getEdgeStart: (index) => edgeStarts.get(index) || 0,
    indexOfStation: (stationId) => stationIdToIndex[stationId],
    getStationName: (index) => `Station ${nodes[index]?.stationId || index}`,
    getStationAddress: (index) => `Address ${index}`,
    stationIdToIndex,
    meta: {
        nodeCount,
        edgeCount: edges.length,
        NODE_STRIDE: 2,
        EDGE_STRIDE: 4,
        stationIdToIndex,
    },
};
