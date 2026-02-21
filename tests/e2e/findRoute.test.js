/**
 * End-to-End test for the /Find/bus/route API endpoint.
 *
 * Starts the real Express server and makes HTTP requests.
 * Requires: binary data files to exist (npm run build:data).
 */
const path = require('path');
const fs = require('fs');
const http = require('http');

const dataDir = path.join(__dirname, '..', '..', 'data');
const dataExists =
    fs.existsSync(path.join(dataDir, 'nodes.bin')) &&
    fs.existsSync(path.join(dataDir, 'edges.bin')) &&
    fs.existsSync(path.join(dataDir, 'meta.json'));

const describeIfData = dataExists ? describe : describe.skip;

/**
 * Simple HTTP GET helper (no external dependencies).
 * @param {string} url
 * @returns {Promise<{ status: number, body: any }>}
 */
function httpGet(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        }).on('error', reject);
    });
}

describeIfData('/Find/bus/route (e2e)', () => {
    let app, server;
    const PORT = 3099; // Use a different port to avoid conflicts

    beforeAll((done) => {
        // Override port before requiring app
        process.env.PORT = PORT;
        app = require('../../src/app');

        // If app is already listening, use it; otherwise start
        if (app && app.listen) {
            server = app.listen(PORT, done);
        } else {
            // app.js calls listen internally, give it time
            setTimeout(done, 2000);
        }
    });

    afterAll((done) => {
        if (server && server.close) {
            server.close(done);
        } else {
            done();
        }
    });

    test('valid query returns routes array', async () => {
        const start = encodeURIComponent(JSON.stringify({ lat: 21.0285, lng: 105.8542 }));
        const end = encodeURIComponent(JSON.stringify({ lat: 21.0, lng: 105.78 }));
        const res = await httpGet(`http://localhost:${PORT}/Find/bus/route?start=${start}&end=${end}`);

        // Should be 200 with routes or 404 if no route (both valid)
        expect([200, 404]).toContain(res.status);

        if (res.status === 200) {
            expect(Array.isArray(res.body)).toBe(true);
            expect(res.body.length).toBeGreaterThan(0);

            const route = res.body[0];
            expect(route).toHaveProperty('passed');
            expect(route).toHaveProperty('routes');
            expect(route).toHaveProperty('time');
            expect(route).toHaveProperty('distance');
            expect(route).toHaveProperty('pathPoints');
        }
    });

    test('missing start returns 400', async () => {
        const end = encodeURIComponent(JSON.stringify({ lat: 21.0, lng: 105.78 }));
        const res = await httpGet(`http://localhost:${PORT}/Find/bus/route?end=${end}`);

        expect(res.status).toBe(400);
    });

    test('invalid coords returns 400', async () => {
        const start = encodeURIComponent(JSON.stringify({ lat: 'abc', lng: 105.8 }));
        const end = encodeURIComponent(JSON.stringify({ lat: 21.0, lng: 105.78 }));
        const res = await httpGet(`http://localhost:${PORT}/Find/bus/route?start=${start}&end=${end}`);

        expect(res.status).toBe(400);
    });
}, 30000);
