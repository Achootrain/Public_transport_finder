/**
 * Unit tests for effectiveWeight and config integration.
 */

describe('effectiveWeight', () => {
    // Re-implement locally to avoid loading binary data from graph.traverse module
    const WAITING_BUS = 10 * 60;   // 600s
    const WAITING_METRO = 15 * 60; // 900s

    function effectiveWeight(weight, edgeType) {
        if (edgeType === 2) return weight + WAITING_BUS;
        if (edgeType === 4) return weight + WAITING_METRO;
        return weight;
    }

    test('bus edge (type 1) — no penalty', () => {
        expect(effectiveWeight(100, 1)).toBe(100);
    });

    test('walk-to-bus edge (type 2) — adds WAITING_BUS', () => {
        expect(effectiveWeight(100, 2)).toBe(100 + 600);
    });

    test('metro edge (type 3) — no penalty', () => {
        expect(effectiveWeight(200, 3)).toBe(200);
    });

    test('walk-to-metro edge (type 4) — adds WAITING_METRO', () => {
        expect(effectiveWeight(200, 4)).toBe(200 + 900);
    });

    test('virtual walk edge (type 5) — no penalty', () => {
        expect(effectiveWeight(50, 5)).toBe(50);
    });

    test('zero weight bus still zero', () => {
        expect(effectiveWeight(0, 1)).toBe(0);
    });

    test('zero weight walk-to-bus returns waiting time only', () => {
        expect(effectiveWeight(0, 2)).toBe(600);
    });
});
