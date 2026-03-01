/**
 * @module services/traffic
 * @description TomTom Traffic Flow polling service.
 *
 * Periodically fetches real-time speed data from TomTom’s Traffic Flow
 * API for a pre-defined set of sensor coordinates, then injects the
 * speeds into the active routing graph via
 * {@link module:repositories/graph.traverse~injectTrafficData}.
 *
 * ## Adaptive Polling Schedule (Vietnam UTC+7)
 * | Time Window       | Interval | Rationale                    |
 * |-------------------|----------|------------------------------|
 * | 07:00 – 09:00     | 5 min    | Morning rush hour            |
 * | 16:30 – 19:00     | 5 min    | Evening rush hour            |
 * | 09:00 – 16:30     | 15 min   | Off-peak daytime             |
 * | 19:00 – 22:00     | 15 min   | Off-peak evening             |
 * | 22:00 – 07:00     | Paused   | Night — negligible traffic   |
 *
 * **Note:** Polling is currently disabled for local development.
 * The graph uses randomised static velocities (15–35 km/h) instead.
 *
 * @see module:repositories/graph.traverse~injectTrafficData
 * @see module:repositories/graph.traverse~velocityArray
 */
const fs = require('fs');
const path = require('path');
const { injectTrafficData, velocityArray, rebuildWeights } = require('../repositories/graph.traverse');
const config = require('../config');

const dataDir = path.join(__dirname, '..', '..', 'data');
const SENSORS_PATH = path.join(dataDir, 'tomtom_sensors.json');

/** @constant {string} TOMTOM_API_KEY — API key from environment (empty disables fetching) */
const TOMTOM_API_KEY = process.env.TOMTOM_API_KEY || '';

/** @constant {string} TOMTOM_BASE_URL — TomTom Flow Segment Data v4 endpoint */
const TOMTOM_BASE_URL = 'https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json';

/** @type {Array<{ lat: number, lng: number }>} Pre-defined sensor coordinates */
let sensors = [];
if (fs.existsSync(SENSORS_PATH)) {
    sensors = JSON.parse(fs.readFileSync(SENSORS_PATH, 'utf-8'));
}

/** @type {NodeJS.Timeout|null} Handle for the next scheduled poll timeout */
let pollingInterval = null;

/** @type {boolean} Guards against overlapping poll cycles */
let isPolling = false;

/** @type {number} Epoch ms timestamp of the last completed poll */
let lastPollTime = 0;

/**
 * Determines the polling interval based on the current hour in
 * Ho Chi Minh / Hanoi timezone (UTC+7).
 *
 * @returns {number} Interval in milliseconds, or `0` when polling
 *   should be paused (night time)
 */
function getAdaptiveIntervalMs() {
    // Get current time in Vietnam (UTC+7)
    const now = new Date();
    const vnTime = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Ho_Chi_Minh" }));
    const hour = vnTime.getHours();
    const minute = vnTime.getMinutes();
    const timeFloat = hour + minute / 60;

    // Night (22:00 - 07:00)
    if (timeFloat >= 22 || timeFloat < 7) {
        return 0; // Paused
    }

    // Morning Peak (07:00 - 09:00) or Evening Peak (16:30 - 19:00)
    if ((timeFloat >= 7 && timeFloat <= 9) || (timeFloat >= 16.5 && timeFloat <= 19)) {
        return 5 * 60 * 1000; // 5 minutes
    }

    // Off-Peak Daylight (09:00 - 16:30, 19:00 - 22:00)
    return 15 * 60 * 1000; // 15 minutes
}

/**
 * Fetches flow-segment data from TomTom for a single coordinate.
 *
 * Returns `null` silently when:
 * - `TOMTOM_API_KEY` is empty (local development)
 * - The API responds with HTTP 429 (rate limited)
 * - Any network or parsing error occurs
 *
 * @param {number} lat - Sensor latitude
 * @param {number} lng - Sensor longitude
 * @returns {Promise<{
 *   currentSpeed: number,
 *   freeFlowSpeed: number,
 *   currentTravelTime: number,
 *   freeFlowTravelTime: number,
 *   confidence: number,
 *   roadClosure: boolean,
 *   coordinates: Array<{ latitude: number, longitude: number }>
 * }|null>} Parsed TomTom flow data, or `null` on failure
 */
async function fetchTrafficFlow(lat, lng) {
    if (!TOMTOM_API_KEY) {
        console.warn('TomTom API Key is missing. Skipping traffic fetch.');
        return null;
    }

    const url = `${TOMTOM_BASE_URL}?key=${TOMTOM_API_KEY}&point=${lat},${lng}`;

    try {
        const response = await fetch(url);
        if (response.status === 429) {
            console.error('TomTom API rate limited (429)!');
            return null;
        }
        if (!response.ok) {
            throw new Error(`HTTP Error: ${response.status}`);
        }

        const data = await response.json();

        if (data && data.flowSegmentData) {
            return {
                currentSpeed: data.flowSegmentData.currentSpeed,
                freeFlowSpeed: data.flowSegmentData.freeFlowSpeed,
                currentTravelTime: data.flowSegmentData.currentTravelTime,
                freeFlowTravelTime: data.flowSegmentData.freeFlowTravelTime,
                confidence: data.flowSegmentData.confidence,
                roadClosure: data.flowSegmentData.roadClosure,
                coordinates: data.flowSegmentData.coordinates?.coordinate || []
            };
        }
        return null;
    } catch (err) {
        console.error(`Error fetching TomTom data for ${lat},${lng}:`, err.message);
        return null;
    }
}

/**
 * Executes one full polling cycle over all registered sensors.
 *
 * Sensors are processed in batches of {@link BATCH_SIZE} with a
 * 500 ms delay between batches to avoid TomTom rate limits.
 * After all results are collected, they are injected into the
 * graph via {@link module:repositories/graph.traverse~injectTrafficData}.
 *
 * @returns {Promise<void>}
 */
async function executePollCycle() {
    if (isPolling) return; // Prevent overlapping cycles
    if (sensors.length === 0) return;

    isPolling = true;
    console.log(`[TomTom] Starting traffic poll cycle for ${sensors.length} sensors...`);

    const startTime = Date.now();
    let successCount = 0;

    const segmentResults = [];

    // Process in small batches to avoid hitting API rate limits
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES_MS = 500;

    for (let i = 0; i < sensors.length; i += BATCH_SIZE) {
        const batch = sensors.slice(i, i + BATCH_SIZE);

        const promises = batch.map(async (sensor) => {
            const data = await fetchTrafficFlow(sensor.lat, sensor.lng);
            if (data) {
                segmentResults.push(data);
                successCount++;
            }
        });

        await Promise.all(promises);

        // Wait before next batch
        if (i + BATCH_SIZE < sensors.length) {
            await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`[TomTom] Poll cycle completed in ${duration}s. Success: ${successCount}/${sensors.length}`);

    // Inject the fetched speeds into the active routing graph
    injectTrafficData(segmentResults);

    lastPollTime = Date.now();
    isPolling = false;

    scheduleNextPoll();
}

/**
 * Schedules the next poll cycle using {@link getAdaptiveIntervalMs}.
 * During night hours, re-checks every 30 minutes until daytime resumes.
 *
 * @returns {void}
 */
function scheduleNextPoll() {
    if (pollingInterval) {
        clearTimeout(pollingInterval);
    }

    const intervalMs = getAdaptiveIntervalMs();

    if (intervalMs === 0) {
        console.log('[TomTom] Traffic polling Paused (Night Time). Will check again in 30 minutes.');
        pollingInterval = setTimeout(scheduleNextPoll, 30 * 60 * 1000);
    } else {
        const nextTime = new Date(Date.now() + intervalMs).toLocaleTimeString("en-US", { timeZone: "Asia/Ho_Chi_Minh" });
        console.log(`[TomTom] Next traffic poll scheduled for ${nextTime} (Interval: ${intervalMs / 1000 / 60}m)`);
        pollingInterval = setTimeout(executePollCycle, intervalMs);
    }
}

/**
 * Simulates a real-time traffic update by re-randomising the velocity
 * of every bus edge and recalculating all edge weights.
 *
 * Uses a time-of-day congestion model:
 * - **Peak hours** (07–09, 17–19 HCM time): velocities biased lower
 *   (range scaled down by 0.5–0.75×)
 * - **Off-peak daytime** (09–17, 19–22): normal range
 * - **Night** (22–07): velocities biased higher (range scaled up by 1.0–1.2×)
 *
 * Called automatically every {@link SIMULATION_INTERVAL_MS} (1 hour).
 *
 * @returns {void}
 */
function simulateTrafficUpdate() {
    const now = new Date();
    const hcmHour = Number(
        now.toLocaleString('en-US', { timeZone: 'Asia/Ho_Chi_Minh', hour: 'numeric', hour12: false })
    );

    // Determine congestion factor based on time of day
    let congestionLo, congestionHi;
    if ((hcmHour >= 7 && hcmHour < 9) || (hcmHour >= 17 && hcmHour < 19)) {
        // Peak hours — slower traffic
        congestionLo = 0.50;
        congestionHi = 0.75;
    } else if (hcmHour >= 22 || hcmHour < 7) {
        // Night — faster traffic
        congestionLo = 1.00;
        congestionHi = 1.20;
    } else {
        // Normal daytime
        congestionLo = 0.70;
        congestionHi = 1.00;
    }

    const baseMin = config.DEFAULT_VELOCITY_MIN;
    const baseMax = config.DEFAULT_VELOCITY_MAX;
    let updated = 0;

    for (let i = 0; i < velocityArray.length; i++) {
        // Only re-randomise bus edges (skip metro/walking — they have fixed speeds)
        if (velocityArray[i] === config.METRO_SPEED || velocityArray[i] === config.WALKING_SPEED) continue;
        if (velocityArray[i] === 0) continue;

        const rawSpeed = baseMin + Math.random() * (baseMax - baseMin);
        const factor = congestionLo + Math.random() * (congestionHi - congestionLo);
        velocityArray[i] = Math.max(5, Math.floor(rawSpeed * factor));
        updated++;
    }

    rebuildWeights();

    const period = hcmHour >= 7 && hcmHour < 9 || hcmHour >= 17 && hcmHour < 19
        ? 'PEAK' : hcmHour >= 22 || hcmHour < 7 ? 'NIGHT' : 'NORMAL';
    console.log(
        `[Traffic-Sim] Velocity update @ ${now.toLocaleTimeString('en-US', { timeZone: 'Asia/Ho_Chi_Minh' })} ` +
        `| Period: ${period} | Factor: ${congestionLo.toFixed(2)}–${congestionHi.toFixed(2)} | Edges updated: ${updated}`
    );
}

/** Simulation interval: 1 hour in milliseconds */
const SIMULATION_INTERVAL_MS = 60 * 60 * 1000;

/** @type {NodeJS.Timeout|null} */
let simulationTimer = null;

/**
 * Entry point for the traffic simulation service.
 *
 * Starts an hourly timer that re-randomises bus edge velocities with
 * a time-of-day congestion model, simulating real-time traffic flow
 * without requiring TomTom API calls.
 *
 * @returns {void}
 */
function startTrafficService() {
    // Run an initial update immediately
    simulateTrafficUpdate();

    // Schedule hourly updates
    simulationTimer = setInterval(simulateTrafficUpdate, SIMULATION_INTERVAL_MS);
    console.log(`[Traffic-Sim] Hourly velocity simulation started (interval: ${SIMULATION_INTERVAL_MS / 1000 / 60} min).`);
}

/**
 * Stops the simulation timer (useful for tests / graceful shutdown).
 * @returns {void}
 */
function stopTrafficService() {
    if (simulationTimer) {
        clearInterval(simulationTimer);
        simulationTimer = null;
        console.log('[Traffic-Sim] Simulation stopped.');
    }
}

module.exports = {
    startTrafficService,
    stopTrafficService,
    simulateTrafficUpdate,
    getAdaptiveIntervalMs
};
