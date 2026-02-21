/**
 * Integration tests for polyline.repository.js.
 */
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, '..', '..', 'data');
const dataExists = fs.existsSync(path.join(dataDir, 'polylines.json'));
const describeIfData = dataExists ? describe : describe.skip;

describeIfData('polyline.repository (integration)', () => {
    let polyRepo;

    beforeAll(() => {
        polyRepo = require('../../src/repositories/polyline.repository');
    });

    test('getPolyline returns array', () => {
        const pts = polyRepo.getPolyline(0);
        expect(Array.isArray(pts)).toBe(true);
    });

    test('getEncodedPolyline returns string', () => {
        const str = polyRepo.getEncodedPolyline(0);
        expect(typeof str).toBe('string');
    });

    test('negative offset returns empty', () => {
        expect(polyRepo.getPolyline(-1)).toEqual([]);
        expect(polyRepo.getEncodedPolyline(-1)).toBe('');
    });

    test('out-of-bounds offset returns empty', () => {
        expect(polyRepo.getPolyline(999999)).toEqual([]);
        expect(polyRepo.getEncodedPolyline(999999)).toBe('');
    });

    test('decoded polyline has [lng, lat] pairs with valid ranges', () => {
        // Find a non-empty polyline
        let pts = [];
        for (let i = 0; i < 100; i++) {
            pts = polyRepo.getPolyline(i);
            if (pts.length > 0) break;
        }
        if (pts.length === 0) return; // skip if all empty in first 100

        for (const [lng, lat] of pts) {
            expect(lat).toBeGreaterThan(-90);
            expect(lat).toBeLessThan(90);
            expect(lng).toBeGreaterThan(-180);
            expect(lng).toBeLessThan(180);
        }
    });
});
