const { getNearestStations, haversine } = require('../src/repositories/kdtree.repository');
const { getStationById } = require('../src/repositories/station.repository');
const fs = require('fs');
const path = require('path');

// Load all stations directly from raw JSON if needed, or via repository
const dataDir = path.join(__dirname, '..', 'data');
const stationsData = JSON.parse(fs.readFileSync(path.join(dataDir, 'Stations.json'), 'utf-8'));

console.log(`Loaded ${stationsData.length} stations from Stations.json`);

const pairs = [];
const seen = new Set();

for (const s1 of stationsData) {
    // Find stations within 500m (0.5km)
    // getNearestStations uses default params but we can override:
    // getNearestStations(lat, lng, k=100, maxDistKm=0.5)

    // We can also just iterate all since 5000 x 5000 is small enough for a quick Node script
    for (const s2 of stationsData) {
        if (s1.stationId >= s2.stationId) continue; // Undirected pairs, ignore self

        const dist = haversine(s1.lat, s1.lng, s2.lat, s2.lng);
        if (dist <= 0.5) {
            pairs.push({
                s1: s1.stationId,
                s2: s2.stationId,
                haversineDist: dist
            });
        }
    }
}

console.log(`Found ${pairs.length} unique station pairs within 500 meters.`);
