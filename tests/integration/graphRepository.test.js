/**
 * Integration tests for graph.repository.js.
 * These load the REAL binary data files (nodes.bin, edges.bin, meta.json)
 * and verify the repository API works correctly.
 *
 * Requires: npm run build:data to have been run first.
 */
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');

// Skip if binary data doesn't exist
const dataExists =
    fs.existsSync(path.join(dataDir, 'nodes.bin')) &&
    fs.existsSync(path.join(dataDir, 'edges.bin')) &&
    fs.existsSync(path.join(dataDir, 'meta.json'));

const describeIfData = dataExists ? describe : describe.skip;

describeIfData('graph.repository (integration)', () => {
    let graphRepo;

    beforeAll(() => {
        graphRepo = require('../../src/repositories/graph.repository');
    });

    test('getNodeCount returns positive number', () => {
        expect(graphRepo.getNodeCount()).toBeGreaterThan(0);
    });

    test('getNode returns valid station data', () => {
        const node = graphRepo.getNode(0);
        expect(node).toHaveProperty('stationId');
        expect(node.stationId).toBeGreaterThan(0);
    });

    test('getEdges returns non-empty array for connected node', () => {
        const edges = graphRepo.getEdges(0);
        expect(Array.isArray(edges)).toBe(true);
        expect(edges.length).toBeGreaterThan(0);
    });

    test('edge has correct structure', () => {
        const edges = graphRepo.getEdges(0);
        const edge = edges[0];
        expect(edge).toHaveProperty('targetIndex');
        expect(edge).toHaveProperty('weight');
        expect(edge).toHaveProperty('routeId');
        expect(edge).toHaveProperty('edgeType');
        expect(edge.weight).toBeGreaterThan(0);
        expect([1, 2, 3, 4]).toContain(edge.edgeType);
    });

    test('getEdgeStart returns increasing offsets', () => {
        const start0 = graphRepo.getEdgeStart(0);
        const start1 = graphRepo.getEdgeStart(1);
        expect(start0).toBe(0);
        expect(start1).toBeGreaterThanOrEqual(start0);
    });

    test('indexOfStation round-trips', () => {
        const node = graphRepo.getNode(0);
        const idx = graphRepo.indexOfStation(node.stationId);
        expect(idx).toBe(0);
    });

    test('meta has expected fields', () => {
        expect(graphRepo.meta).toHaveProperty('nodeCount');
        expect(graphRepo.meta).toHaveProperty('edgeCount');
        expect(graphRepo.meta).toHaveProperty('stationIdToIndex');
        expect(graphRepo.meta.nodeCount).toBeGreaterThan(0);
        expect(graphRepo.meta.edgeCount).toBeGreaterThan(0);
    });
});
