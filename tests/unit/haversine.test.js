const { haversine } = require('../../src/utils/haversine');

describe('haversine', () => {
    test('same point returns 0', () => {
        expect(haversine(21.0, 105.8, 21.0, 105.8)).toBe(0);
    });

    test('Hanoi to HCM ≈ 1,280 km', () => {
        // Hanoi (21.0285, 105.8542) → HCM (10.8231, 106.6297)
        const dist = haversine(21.0285, 105.8542, 10.8231, 106.6297);
        expect(dist).toBeGreaterThan(1100);
        expect(dist).toBeLessThan(1300);
    });

    test('short distance (~1.5 km between two Hanoi stations)', () => {
        const dist = haversine(21.0, 105.8, 21.01, 105.81);
        expect(dist).toBeGreaterThan(1.0);
        expect(dist).toBeLessThan(2.0);
    });

    test('symmetric', () => {
        const d1 = haversine(21.0, 105.8, 21.01, 105.81);
        const d2 = haversine(21.01, 105.81, 21.0, 105.8);
        expect(d1).toBeCloseTo(d2, 10);
    });

    test('returns positive number', () => {
        const dist = haversine(0, 0, 1, 1);
        expect(dist).toBeGreaterThan(0);
    });
});
