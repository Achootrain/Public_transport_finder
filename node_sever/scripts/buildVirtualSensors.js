const fs = require('fs');
const path = require('path');

const dataDir = path.join(__dirname, '..', 'data');
const SENSOR_COUNT = 400;

// Helper to decode google polyline
function decodePolyline(encoded) {
    const points = [];
    let index = 0, lat = 0, lng = 0;
    while (index < encoded.length) {
        let shift = 0, result = 0, byte;
        do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lat += (result & 1) ? ~(result >> 1) : (result >> 1);
        shift = 0; result = 0;
        do { byte = encoded.charCodeAt(index++) - 63; result |= (byte & 0x1f) << shift; shift += 5; } while (byte >= 0x20);
        lng += (result & 1) ? ~(result >> 1) : (result >> 1);
        points.push([lat / 1e5, lng / 1e5]);
    }
    return points;
}

function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

function getGridKey(lat, lng, precision = 3) {
    // 3 decimal places ≈ 110 meters resolution
    // Helps group parallel lanes and nearby stops on the same road
    return `${lat.toFixed(precision)},${lng.toFixed(precision)}`;
}

async function main() {
    console.log('Loading graph data...');

    // We need the edges to filter for Type 1 (Bus), and polylines for the coordinates
    const metaStr = fs.readFileSync(path.join(dataDir, 'meta.json'), 'utf-8');
    const meta = JSON.parse(metaStr);

    const edgeBuffer = fs.readFileSync(path.join(dataDir, 'edges.bin'));
    const edgeData = new Float64Array(edgeBuffer.buffer);

    const polylinesStr = fs.readFileSync(path.join(dataDir, 'polylines.json'), 'utf-8');
    const polylines = JSON.parse(polylinesStr);

    console.log(`Loaded ${meta.edgeCount} total edges.`);

    // Dictionary to track how many bus routes pass through a physical coordinate
    const coordinateWeight = new Map();

    let busEdgesProcessed = 0;

    for (let i = 0; i < meta.edgeCount; i++) {
        const edgeType = edgeData[i * meta.EDGE_STRIDE + 3];
        const routeId = edgeData[i * meta.EDGE_STRIDE + 2];

        // **CRITICAL: Only process Bus Edges (Type 1)**
        if (edgeType !== 1) continue;

        busEdgesProcessed++;

        const encPoly = polylines[i];
        if (!encPoly) continue;

        const points = decodePolyline(encPoly);

        // Take a point from the middle of the bus segment to represent it
        // Avoid taking the very start/end as they are usually inside bus stations, not on the main road
        if (points.length < 2) continue;

        const midIndex = Math.floor(points.length / 2);
        const [lat, lng] = points[midIndex];

        const key = getGridKey(lat, lng);

        if (!coordinateWeight.has(key)) {
            coordinateWeight.set(key, { lat, lng, weight: 0, overlappingRoutes: new Set() });
        }

        const pt = coordinateWeight.get(key);
        pt.overlappingRoutes.add(routeId);
        pt.weight = pt.overlappingRoutes.size; // Score = number of unique bus routes crossing this point
    }

    console.log(`Processed ${busEdgesProcessed} Bus edges.`);
    console.log(`Found ${coordinateWeight.size} unique mid-segment coordinate candidates.`);

    // Sort descending by weight (most overlapping routes first)
    let candidates = Array.from(coordinateWeight.values())
        .sort((a, b) => b.weight - a.weight);

    // Provide spatial separation. We don't want all 400 sensors clumped together.
    // Ensure at least 500m between any two selected sensors.
    console.log('Applying spatial separation filtering (min 500m between sensors)...');

    const MIN_DISTANCE_KM = 0.5;
    const finalSensors = [];

    for (const cand of candidates) {
        if (finalSensors.length >= SENSOR_COUNT) break;

        // Check distance against already selected sensors
        let tooClose = false;
        for (const selected of finalSensors) {
            if (haversine(cand.lat, cand.lng, selected.lat, selected.lng) < MIN_DISTANCE_KM) {
                tooClose = true;
                break;
            }
        }

        if (!tooClose && cand.weight > 0) {
            finalSensors.push({
                idx: finalSensors.length + 1,
                lat: cand.lat,
                lng: cand.lng,
                weight: cand.weight,
                routesCount: cand.overlappingRoutes.size
            });
        }
    }

    console.log(`\nFiltered down to ${finalSensors.length} spatially distributed Virtual Sensors.`);
    console.log(`Highest weight sensor has ${finalSensors[0].weight} unique routes overlapping.`);

    const outPath = path.join(dataDir, 'tomtom_sensors.json');
    fs.writeFileSync(outPath, JSON.stringify(finalSensors, null, 2));
    console.log(`Saved coordinates to ${outPath}`);
}

main().catch(console.error);
