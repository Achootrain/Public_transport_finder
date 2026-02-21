/**
 * Unit tests for BinaryHeap and Leftist Heap from pathFind.service.
 *
 * These are internal data structures, so we test them by extracting
 * the logic into a small test harness that mirrors the implementations.
 */

// ─── BinaryHeap (copied from pathFind.service) ─────────────
class BinaryHeap {
    constructor() { this.data = []; }

    push(key, value) {
        this.data.push({ key, value });
        this._up(this.data.length - 1);
    }

    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._down(0);
        }
        return top;
    }

    get empty() { return this.data.length === 0; }

    _up(i) {
        while (i > 0) {
            const parent = (i - 1) >> 1;
            if (this.data[i].key >= this.data[parent].key) break;
            [this.data[i], this.data[parent]] = [this.data[parent], this.data[i]];
            i = parent;
        }
    }

    _down(i) {
        const n = this.data.length;
        while (true) {
            let smallest = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && this.data[l].key < this.data[smallest].key) smallest = l;
            if (r < n && this.data[r].key < this.data[smallest].key) smallest = r;
            if (smallest === i) break;
            [this.data[i], this.data[smallest]] = [this.data[smallest], this.data[i]];
            i = smallest;
        }
    }
}

describe('BinaryHeap', () => {
    test('empty on init', () => {
        const h = new BinaryHeap();
        expect(h.empty).toBe(true);
    });

    test('push and pop in order', () => {
        const h = new BinaryHeap();
        h.push(5, 'e');
        h.push(1, 'a');
        h.push(3, 'c');
        h.push(2, 'b');
        h.push(4, 'd');

        expect(h.pop().value).toBe('a');
        expect(h.pop().value).toBe('b');
        expect(h.pop().value).toBe('c');
        expect(h.pop().value).toBe('d');
        expect(h.pop().value).toBe('e');
        expect(h.empty).toBe(true);
    });

    test('handles duplicates', () => {
        const h = new BinaryHeap();
        h.push(1, 'first');
        h.push(1, 'second');

        const a = h.pop();
        const b = h.pop();
        expect(a.key).toBe(1);
        expect(b.key).toBe(1);
        expect(h.empty).toBe(true);
    });

    test('single element', () => {
        const h = new BinaryHeap();
        h.push(42, 'only');
        expect(h.pop()).toEqual({ key: 42, value: 'only' });
        expect(h.empty).toBe(true);
    });
});

// ─── Leftist Heap (copied from pathFind.service) ────────────
function lnode(key) {
    return { key, rank: 1, left: null, right: null };
}

function lmerge(a, b) {
    if (!a) return b;
    if (!b) return a;
    if (a.key > b.key) [a, b] = [b, a];

    const newRight = lmerge(a.right, b);
    const newLeft = a.left;
    const rankL = newLeft ? newLeft.rank : 0;
    const rankR = newRight ? newRight.rank : 0;

    const node = { key: a.key, rank: 0, left: null, right: null };
    if (rankL >= rankR) {
        node.left = newLeft;
        node.right = newRight;
        node.rank = rankR + 1;
    } else {
        node.left = newRight;
        node.right = newLeft;
        node.rank = rankL + 1;
    }
    return node;
}

function linsert(heap, key) {
    return lmerge(heap, lnode(key));
}

describe('Leftist Heap', () => {
    test('single insert returns node with rank 1', () => {
        const h = linsert(null, 10);
        expect(h.key).toBe(10);
        expect(h.rank).toBe(1);
    });

    test('min is always at root', () => {
        let h = null;
        h = linsert(h, 5);
        h = linsert(h, 1);
        h = linsert(h, 3);
        expect(h.key).toBe(1);
    });

    test('persistent: original heap unchanged after merge', () => {
        let h1 = linsert(null, 10);
        let h2 = linsert(null, 5);
        const h3 = lmerge(h1, h2);

        // h1 and h2 should still have their original keys
        expect(h1.key).toBe(10);
        expect(h2.key).toBe(5);
        expect(h3.key).toBe(5);
    });

    test('extract min by removing root', () => {
        let h = null;
        h = linsert(h, 5);
        h = linsert(h, 1);
        h = linsert(h, 3);
        h = linsert(h, 2);
        h = linsert(h, 4);

        // Extract min by merging left and right
        const sorted = [];
        while (h) {
            sorted.push(h.key);
            h = lmerge(h.left, h.right);
        }
        expect(sorted).toEqual([1, 2, 3, 4, 5]);
    });

    test('leftist property: rank(left) >= rank(right)', () => {
        let h = null;
        for (let i = 0; i < 20; i++) {
            h = linsert(h, Math.floor(Math.random() * 100));
        }

        function checkLeftist(node) {
            if (!node) return;
            const rankL = node.left ? node.left.rank : 0;
            const rankR = node.right ? node.right.rank : 0;
            expect(rankL).toBeGreaterThanOrEqual(rankR);
            checkLeftist(node.left);
            checkLeftist(node.right);
        }

        checkLeftist(h);
    });
});
