const fs = require('fs');
const path = require('path');

// Haversine formula
function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
}

const dataDir = path.join(__dirname, '..', 'data');
const stationsData = JSON.parse(fs.readFileSync(path.join(dataDir, 'Stations.json'), 'utf-8'));

const OSRM_URL = process.env.OSRM_URL || 'http://router.project-osrm.org';
const MAX_RADIUS_KM = 0.5;
const DELAY_MS = parseInt(process.env.DELAY_MS || '100'); // Delay between requests

const outPath = path.join(dataDir, 'walking_edges.json');

function toPairKey(fromStation, toStation) {
    const from = Math.min(fromStation, toStation);
    const to = Math.max(fromStation, toStation);
    return `${from}-${to}`;
}

async function main() {
    console.log(`Loaded ${stationsData.length} stations from Stations.json`);

    // Find candidate pairs
    const pairs = [];
    for (const s1 of stationsData) {
        for (const s2 of stationsData) {
            if (s1.stationId >= s2.stationId) continue;
            const dist = haversine(s1.lat, s1.lng, s2.lat, s2.lng);
            if (dist <= MAX_RADIUS_KM) {
                pairs.push({ s1, s2, dist });
            }
        }
    }

    console.log(`Found ${pairs.length} candidate station pairs within ${MAX_RADIUS_KM * 1000}m.`);

    let walkingEdges = [];
    let startIndex = 0;

    // Resume logic
    if (fs.existsSync(outPath)) {
        try {
            const existing = JSON.parse(fs.readFileSync(outPath, 'utf-8'));
            if (Array.isArray(existing)) {
                walkingEdges = existing;
                startIndex = 0;
                console.log(`Loaded ${walkingEdges.length} existing edges from array format.`);
            } else if (existing && Array.isArray(existing.edges) && Number.isInteger(existing.lastIndex) && existing.lastIndex >= 0) {
                walkingEdges = existing.edges;
                startIndex = existing.lastIndex;
                console.log(`Resuming from index ${startIndex} with ${walkingEdges.length} saved edges.`);
            }
        } catch (e) {
            console.log("Could not parse existing walking_edges.json, starting fresh.");
        }
    }

    const existingEdgeKeys = new Set(
        walkingEdges.map((edge) => toPairKey(edge.fromStation, edge.toStation))
    );

    let processed = startIndex;
    let errors = 0;

    for (let i = startIndex; i < pairs.length; i++) {
        const { s1, s2 } = pairs[i];

        if (existingEdgeKeys.has(toPairKey(s1.stationId, s2.stationId))) {
            processed++;
            if (processed % 10 === 0 || processed === pairs.length) {
                process.stdout.write(`\rProcessed ${processed}/${pairs.length} pairs (Found ${walkingEdges.length} valid paths). Errors: ${errors}`);
                fs.writeFileSync(outPath, JSON.stringify({ lastIndex: processed, edges: walkingEdges }, null, 2));
            }
            continue;
        }

        // OSRM expects: longitude,latitude
        const url = `${OSRM_URL}/route/v1/foot/${s1.lng},${s1.lat};${s2.lng},${s2.lat}?overview=full&geometries=polyline`;

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);

            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(timeoutId);

            if (res.status === 429) {
                console.log(`\nRate limited! Waiting 5 seconds...`);
                await new Promise(resolve => setTimeout(resolve, 5000));
                i--; // Retry this pair
                continue;
            }
            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }
            const data = await res.json();

            if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
                const route = data.routes[0];
                const walkDistKm = route.distance / 1000;

                // Double check OSRM walk distance is strictly <= 0.5km
                if (walkDistKm <= MAX_RADIUS_KM) {
                    existingEdgeKeys.add(toPairKey(s1.stationId, s2.stationId));
                    walkingEdges.push({
                        fromStation: s1.stationId,
                        toStation: s2.stationId,
                        distanceKm: walkDistKm,
                        durationSec: route.duration,
                        polyline: route.geometry,
                        type: 5 // Walking type
                    });
                }
            }
        } catch (err) {
            errors++;
            console.error(`\nError fetching OSRM for pair ${s1.stationId}-${s2.stationId}:`, err.message);
        }

        processed++;
        if (processed % 10 === 0 || processed === pairs.length) {
            process.stdout.write(`\rProcessed ${processed}/${pairs.length} pairs (Found ${walkingEdges.length} valid paths). Errors: ${errors}`);
            // Save incremental progress
            fs.writeFileSync(outPath, JSON.stringify({ lastIndex: processed, edges: walkingEdges }, null, 2));
        }

        // Wait to respect rate limits
        if (DELAY_MS > 0) {
            await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
    }

    console.log(`\nFinished processing. Found ${walkingEdges.length} valid walking edges.`);
    // Final save without the wrapper so it's a pure array, for the final consumer
    fs.writeFileSync(outPath, JSON.stringify(walkingEdges, null, 2));
    console.log(`Saved pure edge array to ${outPath}`);
}

main().catch(console.error);
