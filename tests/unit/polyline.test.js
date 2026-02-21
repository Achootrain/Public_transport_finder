/**
 * Unit tests for Google Encoded Polyline encode/decode.
 */
const { decodePolyline } = require('../mocks/polylineRepository.mock');

// Re-implement encodePolyline here for round-trip testing
function encodePolyline(points) {
    if (!points || points.length < 2) return '';

    let prevLat = 0, prevLng = 0;
    let encoded = '';

    for (const [lat, lng] of points) {
        const dLat = Math.round((lat - prevLat) * 1e5);
        const dLng = Math.round((lng - prevLng) * 1e5);
        prevLat = lat;
        prevLng = lng;

        for (const delta of [dLat, dLng]) {
            let val = delta < 0 ? ~(delta << 1) : (delta << 1);
            while (val >= 0x20) {
                encoded += String.fromCharCode((0x20 | (val & 0x1f)) + 63);
                val >>= 5;
            }
            encoded += String.fromCharCode(val + 63);
        }
    }
    return encoded;
}

describe('Polyline Encode/Decode', () => {
    test('empty string returns empty array', () => {
        expect(decodePolyline('')).toEqual([]);
    });

    test('null returns empty array', () => {
        expect(decodePolyline(null)).toEqual([]);
    });

    test('round-trip: encode then decode preserves coordinates', () => {
        // [lat, lng] order for encoding
        const original = [
            [21.0, 105.8],
            [21.01, 105.81],
            [21.02, 105.82],
        ];

        const encoded = encodePolyline(original);
        expect(encoded.length).toBeGreaterThan(0);

        // decodePolyline returns [lng, lat] order
        const decoded = decodePolyline(encoded);
        expect(decoded.length).toBe(3);

        for (let i = 0; i < original.length; i++) {
            expect(decoded[i][1]).toBeCloseTo(original[i][0], 4); // lat
            expect(decoded[i][0]).toBeCloseTo(original[i][1], 4); // lng
        }
    });

    test('encoding is compact', () => {
        const points = [];
        for (let i = 0; i < 100; i++) {
            points.push([21.0 + i * 0.001, 105.8 + i * 0.001]);
        }
        const encoded = encodePolyline(points);
        // 100 points × 2 coords × 8 bytes (Float64) = 1600 bytes raw
        // Encoded should be much smaller
        expect(encoded.length).toBeLessThan(800);
    });

    test('handles negative coordinates', () => {
        const original = [
            [-33.8688, 151.2093],  // Sydney
            [-33.8704, 151.2089],
        ];
        const encoded = encodePolyline(original);
        const decoded = decodePolyline(encoded);

        expect(decoded[0][1]).toBeCloseTo(-33.8688, 4);
        expect(decoded[0][0]).toBeCloseTo(151.2093, 4);
    });
});
