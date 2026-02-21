/**
 * Fixture: sample graph data for unit testing.
 *
 * Graph topology (4 nodes, 5 edges):
 *   0 --[bus,route1]--> 1  (weight 100)
 *   1 --[bus,route1]--> 2  (weight 200)
 *   0 --[walk-to-bus]--> 3 (weight 50)
 *   3 --[bus,route2]--> 2  (weight 150)
 *   2 --[metro,route3]--> 3 (weight 80)
 */
const nodes = [
    { stationId: 1001, lat: 21.0, lng: 105.8 },
    { stationId: 1002, lat: 21.01, lng: 105.81 },
    { stationId: 1003, lat: 21.02, lng: 105.82 },
    { stationId: 1004, lat: 21.005, lng: 105.805 },
];

const edges = [
    { from: 0, to: 1, weight: 100, routeId: 1, edgeType: 1 },
    { from: 1, to: 2, weight: 200, routeId: 1, edgeType: 1 },
    { from: 0, to: 3, weight: 50, routeId: -1, edgeType: 2 },
    { from: 3, to: 2, weight: 150, routeId: 2, edgeType: 1 },
    { from: 2, to: 3, weight: 80, routeId: 3, edgeType: 3 },
];

const stationIdToIndex = {
    1001: 0,
    1002: 1,
    1003: 2,
    1004: 3,
};

module.exports = { nodes, edges, stationIdToIndex };
