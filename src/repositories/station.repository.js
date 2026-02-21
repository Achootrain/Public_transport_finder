/**
 * @module repositories/station
 * @description Provides lookups for station metadata (names, addresses)
 * and route information from the source JSON files.
 */
const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', '..', 'data');

/**
 * @typedef {Object} Station
 * @property {number} stationId
 * @property {number} lat
 * @property {number} lng
 * @property {string} stationName
 * @property {string} stationAddress
 * @property {number} stationType - 1 = bus, 3 = metro
 */

/**
 * @typedef {Object} RouteInfo
 * @property {number} id - Internal route identifier
 * @property {string} name - Human-readable route name
 * @property {number} routeId - Route ID used in edge data
 */

/** @type {Station[]} */
const stationsData = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'Stations.json'), 'utf-8')
);

/** @type {Map<number, Station>} Maps stationId → Station object */
const stationsById = new Map(stationsData.map((st) => [st.stationId, st]));

/** @type {Map<number, RouteInfo>} Maps routeId → RouteInfo object */
const routesByRouteId = new Map();
const routesData = JSON.parse(
    fs.readFileSync(path.join(dataDir, 'Routes.json'), 'utf-8')
);
for (const route of routesData) {
    const routeId = route?.stations?.[0]?.routeId;
    if (typeof routeId === 'number' && !routesByRouteId.has(routeId)) {
        routesByRouteId.set(routeId, { id: route.id, name: route.name, routeId });
    }
}

/**
 * Retrieves a station by its original stationId.
 * @param {number} stationId
 * @returns {Station|null}
 */
function getStationById(stationId) {
    return stationsById.get(stationId) || null;
}

/**
 * Retrieves route metadata by routeId.
 * @param {number} routeId
 * @returns {RouteInfo|null}
 */
function getRouteById(routeId) {
    return routesByRouteId.get(routeId) || null;
}

module.exports = { getStationById, getRouteById, stationsById, routesByRouteId };
