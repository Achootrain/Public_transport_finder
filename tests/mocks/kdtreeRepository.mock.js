/**
 * Mock for repositories/kdtree.repository.js
 * Returns predetermined nearest stations.
 */
const { nodes } = require('../fixtures/sampleGraph');

function getNearestStations(lat, lng) {
    // Return first 2 stations as "nearest" with small distances
    return nodes.slice(0, 2).map((n, i) => ({
        id: n.stationId,
        lat: n.lat,
        lng: n.lng,
        distance: 0.5 + i * 0.3, // 0.5 km, 0.8 km
        type: 1,
    }));
}

function haversine(lat1, lng1, lat2, lng2) {
    const R = 6371;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lng2 - lng1);
    const a =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

module.exports = { getNearestStations, haversine };
