const http = require('http');
const express = require('express');

const mockRedisStore = new Map();

jest.mock('../../src/services/auth.service', () => ({
    verifyIdToken: jest.fn(async (token) => ({
        uid: `uid-${token}`,
        email: 'e2e@test.dev'
    }))
}));

jest.mock('../../src/services/redis.service', () => ({
    get: jest.fn(async (key) => (mockRedisStore.has(key) ? mockRedisStore.get(key) : null)),
    set: jest.fn(async (key, value) => {
        mockRedisStore.set(key, value);
        return true;
    }),
    del: jest.fn(async (key) => {
        mockRedisStore.delete(key);
        return true;
    })
}));

jest.mock('../../src/services/pathFind.service', () => ({
    findKroute: jest.fn(() => ([
        {
            passedRoutePairs: [
                { passed: 1, routeId: 10 },
                { passed: 2, routeId: 10 },
                { passed: 3, routeId: 11 }
            ],
            pathSegments: [{ mode: 'bus', from: 1, to: 3 }],
            routes: [10, 11],
            routeChanges: 1,
            time: 900,
            distance: 4.2
        }
    ]))
}));

jest.mock('../../src/repositories/station.repository', () => ({
    getStationById: jest.fn((id) => ({ stationId: id, name: `Station ${id}` })),
    getRouteById: jest.fn((id) => ({ routeId: id, routeName: `Route ${id}` }))
}));

const authService = require('../../src/services/auth.service');
const redisService = require('../../src/services/redis.service');
const { findKroute } = require('../../src/services/pathFind.service');
const findRoutes = require('../../src/routes/find.routes');

function httpGet(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = http.get(url, { headers }, (res) => {
            let data = '';
            res.on('data', (chunk) => {
                data += chunk;
            });
            res.on('end', () => {
                try {
                    resolve({ status: res.statusCode, body: JSON.parse(data) });
                } catch {
                    resolve({ status: res.statusCode, body: data });
                }
            });
        });

        req.on('error', reject);
    });
}

describe('/Find/bus/route auth + redis cache (e2e)', () => {
    let server;
    let baseUrl;

    beforeAll((done) => {
        const app = express();
        app.use('/Find', findRoutes);

        server = app.listen(0, () => {
            const { port } = server.address();
            baseUrl = `http://127.0.0.1:${port}`;
            done();
        });
    });

    beforeEach(() => {
        mockRedisStore.clear();
        jest.clearAllMocks();
    });

    afterAll((done) => {
        server.close(done);
    });

    test('firebase login -> compute route -> cache in redis -> next request served from redis cache', async () => {
        const start = { lat: 21.0285, lng: 105.8542 };
        const end = { lat: 21.03, lng: 105.85 };

        const startQuery = encodeURIComponent(JSON.stringify(start));
        const endQuery = encodeURIComponent(JSON.stringify(end));

        const firstResponse = await httpGet(
            `${baseUrl}/Find/bus/route?start=${startQuery}&end=${endQuery}`,
            { Authorization: 'Bearer token-123' }
        );

        expect(firstResponse.status).toBe(200);
        expect(firstResponse.body.success).toBe(true);
        expect(firstResponse.body.message).toBe('Success');
        expect(Array.isArray(firstResponse.body.data)).toBe(true);
        expect(firstResponse.body.data.length).toBe(1);

        const globalCacheKey = `route:${start.lat.toFixed(4)},${start.lng.toFixed(4)}:${end.lat.toFixed(4)},${end.lng.toFixed(4)}`;
        expect(mockRedisStore.has(globalCacheKey)).toBe(true);

        expect(authService.verifyIdToken).toHaveBeenCalledTimes(1);
        expect(findKroute).toHaveBeenCalledTimes(1);
        expect(redisService.set).toHaveBeenCalled();

        const secondResponse = await httpGet(
            `${baseUrl}/Find/bus/route?start=${startQuery}&end=${endQuery}`
        );

        expect(secondResponse.status).toBe(200);
        expect(secondResponse.body.success).toBe(true);
        expect(secondResponse.body.message).toBe('Success (Served from Global Cache)');
        expect(secondResponse.body.data).toEqual(firstResponse.body.data);

        expect(findKroute).toHaveBeenCalledTimes(1);
    });
});
