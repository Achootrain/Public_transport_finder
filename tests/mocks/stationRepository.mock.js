/**
 * Mock for repositories/station.repository.js
 */
const { stations, routes } = require('../fixtures/sampleStations');

module.exports = {
    getStationById: (id) => stations[id] || null,
    getRouteById: (id) => routes[id] || null,
};
