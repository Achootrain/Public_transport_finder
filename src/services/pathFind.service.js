/**
 * @module services/pathFind
 * @description Eppstein's K-shortest s→t paths algorithm over binary
 * transit graph. Runs in O(m log m + k log k) time.
 *
 * ## Algorithm Overview
 * 1. **Reverse Dijkstra** from sink → shortest-path-tree distances `d[u]` + tree edges `nxt[u]`
 * 2. **Sidetrack edges** — every non-tree edge e=(u,v) gets cost δ(e) = w(e) + d[v] − d[u]
 * 3. **Persistent leftist heaps** — sidetrack edges per node, merged along tree path
 * 4. **Auxiliary graph G''** — each heap node has ≤3 outgoing edges (bounded degree)
 * 5. **K-pop** — priority-queue extraction on G'' yields K shortest paths in O(k log k)
 *
 */
const { buildAugmentedGraph } = require('../repositories/graph.traverse');
const graphRepo = require('../repositories/graph.repository');
const { getPolyline } = require('../repositories/polyline.repository');
const { stationsById } = require('../repositories/station.repository');

/**
 * Resolves [lng, lat] coordinates for a node index.
 * @param {number} nodeIndex - Node index in the augmented graph
 * @param {import('./graph.traverse').AugmentedGraph} G
 * @returns {number[]|null} [lng, lat] or null if unknown
 */
function getNodeCoord(nodeIndex, G) {
    if (nodeIndex === G.srcIndex) return G.startCoord ? [G.startCoord.lng, G.startCoord.lat] : null;
    if (nodeIndex === G.sinkIndex) return G.endCoord ? [G.endCoord.lng, G.endCoord.lat] : null;
    const stationId = graphRepo.getNode(nodeIndex).stationId;
    const station = stationsById.get(stationId);
    if (station) return [station.lng, station.lat];
    return null;
}

// ─── Binary Min-Heap (for Dijkstra) ───────────────────────

/**
 * Standard binary min-heap for Dijkstra's priority queue.
 * @template T
 */
class BinaryHeap {
    constructor() {
        /** @type {Array<{ key: number, value: T }>} */
        this.data = [];
    }

    /** @param {number} key @param {T} value */
    push(key, value) {
        this.data.push({ key, value });
        this._up(this.data.length - 1);
    }

    /** @returns {{ key: number, value: T }} */
    pop() {
        const top = this.data[0];
        const last = this.data.pop();
        if (this.data.length > 0) {
            this.data[0] = last;
            this._down(0);
        }
        return top;
    }

    /** @returns {boolean} */
    get empty() { return this.data.length === 0; }

    /** @param {number} i */
    _up(i) {
        const d = this.data;
        while (i > 0) {
            const p = (i - 1) >> 1;
            if (d[i].key >= d[p].key) break;
            [d[i], d[p]] = [d[p], d[i]];
            i = p;
        }
    }

    /** @param {number} i */
    _down(i) {
        const d = this.data;
        const n = d.length;
        while (true) {
            let m = i;
            const l = 2 * i + 1, r = 2 * i + 2;
            if (l < n && d[l].key < d[m].key) m = l;
            if (r < n && d[r].key < d[m].key) m = r;
            if (m === i) break;
            [d[i], d[m]] = [d[m], d[i]];
            i = m;
        }
    }
}

// ─── Persistent Leftist Heap ──────────────────────────────

/**
 * @typedef {Object} LNode
 * @property {number} key - Sidetrack cost δ(e)
 * @property {number} edgeFrom - Source node index of the sidetrack edge
 * @property {number} edgeTo - Target node index of the sidetrack edge
// ─── Leftist Heap (Flat Array Implementation) ──────────────

/**
 * A memory pool for leftist heap nodes using parallel typed arrays.
 * This avoids allocating thousands of small objects per query.
 */
class HeapPool {
    /**
     * @param {number} initialCapacity
     */
    constructor(initialCapacity = 100000) {
        this.capacity = initialCapacity;
        this.idx = 1; // 0 is reserved for NULL

        this.key = new Float64Array(this.capacity);        // Sidetrack cost
        this.dist = new Int32Array(this.capacity);         // Rank (null path length)
        this.left = new Int32Array(this.capacity);         // Left child index
        this.right = new Int32Array(this.capacity);        // Right child index

        // Edge Payload
        this.edgeFrom = new Int32Array(this.capacity);
        this.edgeTo = new Int32Array(this.capacity);
        this.edgeWeight = new Float64Array(this.capacity);
        this.edgeRouteId = new Int32Array(this.capacity);
        this.edgeType = new Int32Array(this.capacity);
        this.edgeOffset = new Int32Array(this.capacity);
    }

    /**
     * Resizes the internal arrays when capacity is exceeded.
     */
    resize() {
        const newCap = this.capacity * 2;

        const copy = (arr, Type) => {
            const newArr = new Type(newCap);
            newArr.set(arr);
            return newArr;
        };

        this.key = copy(this.key, Float64Array);
        this.dist = copy(this.dist, Int32Array);
        this.left = copy(this.left, Int32Array);
        this.right = copy(this.right, Int32Array);

        this.edgeFrom = copy(this.edgeFrom, Int32Array);
        this.edgeTo = copy(this.edgeTo, Int32Array);
        this.edgeWeight = copy(this.edgeWeight, Float64Array);
        this.edgeRouteId = copy(this.edgeRouteId, Int32Array);
        this.edgeType = copy(this.edgeType, Int32Array);
        this.edgeOffset = copy(this.edgeOffset, Int32Array);

        this.capacity = newCap;
    }

    /**
     * Allocates a new node in the pool.
     */
    alloc(key, from, to, weight, routeId, type, offset) {
        if (this.idx >= this.capacity) this.resize();

        const i = this.idx++;
        this.key[i] = key;
        this.dist[i] = 1;
        this.left[i] = 0; // null
        this.right[i] = 0; // null

        this.edgeFrom[i] = from;
        this.edgeTo[i] = to;
        this.edgeWeight[i] = weight;
        this.edgeRouteId[i] = routeId;
        this.edgeType[i] = type;
        this.edgeOffset[i] = offset;

        return i;
    }

    /**
     * Creates a copy of an existing node index `i` but with a new `right` child.
     * Used for persistent merging.
     */
    copyNodeWithNewRight(i, newRight) {
        if (this.idx >= this.capacity) this.resize();

        const newNode = this.idx++;

        // Copy properties from `i`
        this.key[newNode] = this.key[i];
        this.edgeFrom[newNode] = this.edgeFrom[i];
        this.edgeTo[newNode] = this.edgeTo[i];
        this.edgeWeight[newNode] = this.edgeWeight[i];
        this.edgeRouteId[newNode] = this.edgeRouteId[i];
        this.edgeType[newNode] = this.edgeType[i];
        this.edgeOffset[newNode] = this.edgeOffset[i];

        // Update children and rank
        const left = this.left[i];
        const rankL = left ? this.dist[left] : 0;
        const rankR = newRight ? this.dist[newRight] : 0;

        // Maintain leftist property: rank(left) >= rank(right)
        if (rankL >= rankR) {
            this.left[newNode] = left;
            this.right[newNode] = newRight;
            this.dist[newNode] = rankR + 1;
        } else {
            this.left[newNode] = newRight;
            this.right[newNode] = left;
            this.dist[newNode] = rankL + 1;
        }

        return newNode;
    }
}

/**
 * Persistently merges two leftist heaps using the pool.
 * Returns the index of the new merged root.
 * @param {HeapPool} pool
 * @param {number} a - index of heap root A
 * @param {number} b - index of heap root B
 * @returns {number} index of new merged root (0 if empty)
 */
function lmerge(pool, a, b) {
    if (a === 0) return b;
    if (b === 0) return a;

    // Use pool keys
    if (pool.key[a] > pool.key[b]) {
        let temp = a; a = b; b = temp;
    }

    // Persistent: merge right child of `a` with `b`
    const newRight = lmerge(pool, pool.right[a], b);

    // Create new node copying `a` structure with updated children
    return pool.copyNodeWithNewRight(a, newRight);
}

/**
 * Inserts a single element into a leftist heap (persistent).
 * @param {HeapPool} pool
 * @param {number} root - current heap root index
 * @param {number} key
 * @param {number} from
 * @param {number} to
 * @param {number} weight
 * @param {number} routeId
 * @param {number} edgeType
 * @param {number} offset
 * @returns {number} new heap root index
 */
function linsert(pool, root, key, from, to, weight, routeId, edgeType, offset) {
    const newNode = pool.alloc(key, from, to, weight, routeId, edgeType, offset);
    return lmerge(pool, root, newNode);
}

// ─── Step 1: Reverse Dijkstra ─────────────────────────────

/**
 * Runs Dijkstra backwards from the sink node to compute shortest
 * distances and tree edges for all reachable nodes.
 *
 * @param {import('./graph.traverse').AugmentedGraph} G
 * @returns {{ dist: Float64Array, treeEdgeTo: Int32Array }}
 *   - `dist[u]` = shortest distance from u to sink
 *   - `treeEdgeTo[u]` = next node on shortest path from u to sink (-1 if none)
 */
function reverseDijkstra(G) {
    const n = G.nodeCount;
    const dist = new Float64Array(n).fill(Infinity);
    const treeEdgeTo = new Int32Array(n).fill(-1);
    const visited = new Uint8Array(n);

    const pq = new BinaryHeap();
    dist[G.sinkIndex] = 0;
    pq.push(0, G.sinkIndex);

    while (!pq.empty) {
        const { key: d, value: u } = pq.pop();
        if (visited[u]) continue;
        visited[u] = 1;

        // Traverse reverse edges: for each v→u in forward graph, process u→v in reverse
        const revEdges = G.getRevEdges(u);
        for (const e of revEdges) {
            const v = e.target;
            const alt = d + e.weight;
            if (alt < dist[v]) {
                dist[v] = alt;
                treeEdgeTo[v] = u;
                pq.push(alt, v);
            }
        }
    }

    return { dist, treeEdgeTo };
}

// ─── Step 2+3: Sidetrack Edges + Leftist Heaps ───────────

/**
 * For each node, builds a persistent leftist heap of its sidetrack edges.
 * Then merges each node's heap with its tree-parent's heap.
 *
 * @param {import('./graph.traverse').AugmentedGraph} G
 * @param {Float64Array} dist - Shortest distances from reverseDijkstra
 * @param {Int32Array} treeEdgeTo - Tree edges from reverseDijkstra
 * @returns {{ heaps: Int32Array, pool: HeapPool }} Array of heap roots (indices) and the memory pool
 */
function buildSidetrackHeaps(G, dist, treeEdgeTo) {
    const n = G.nodeCount;
    // Estimate pool size: usually proportional to (Edges - Nodes) + O(N log M) merges
    // 200,000 is a safe start for ~50k edges; resize will handle overflow
    const pool = new HeapPool(200000);

    // Step 2: Collect sidetrack edges per node
    /** @type {Int32Array} Heap root indices per node */
    const localHeap = new Int32Array(n).fill(0); // 0 = null

    for (let u = 0; u < n; u++) {
        if (dist[u] === Infinity) continue;

        const edges = G.getEdges(u);
        for (const e of edges) {
            const v = e.target;
            if (dist[v] === Infinity) continue;

            // Skip tree edges
            if (v === treeEdgeTo[u]) continue;

            // Sidetrack cost: δ(e) = w(e) + d[v] - d[u]
            const delta = e.weight + dist[v] - dist[u];
            if (delta < 0) continue;

            localHeap[u] = linsert(pool, localHeap[u], delta, u, v, e.weight, e.routeId, e.edgeType, e.edgeOffset);
        }
    }

    // Step 3: Merge heaps along tree path (persistent merge)
    /** @type {Int32Array} Persistent heap root indices */
    const heap = new Int32Array(n).fill(0);

    // Sort nodes by distance
    const order = [];
    for (let i = 0; i < n; i++) {
        if (dist[i] < Infinity) order.push(i);
    }
    order.sort((a, b) => dist[a] - dist[b]);

    // Process in reverse order (farthest first)
    for (let idx = order.length - 1; idx >= 0; idx--) {
        const u = order[idx];
        const next = treeEdgeTo[u];

        if (next !== -1 && heap[next] !== 0) {
            heap[u] = lmerge(pool, localHeap[u], heap[next]);
        } else {
            heap[u] = localHeap[u];
        }
    }

    return { heaps: heap, pool };
}

// ─── Step 5: K-Pop ────────────────────────────────────────

/**
 * @typedef {Object} KPopEntry
 * @property {number} totalCost
 * @property {number[]} sidetracks - Sequence of sidetrack edge indices in the pool
 */

/**
 * Extracts up to K shortest s→t paths from the auxiliary graph.
 *
 * @param {Int32Array} heaps - Heap root indices per node
 * @param {HeapPool} pool - Memory pool containing the heap nodes
 * @param {Float64Array} dist - Shortest distances
 * @param {Int32Array} treeEdgeTo - Tree edges
 * @param {number} srcIndex - Source node index
 * @param {number} K - Number of paths to extract
 * @returns {KPopEntry[]} Up to K path entries sorted by total cost
 */
function kPop(heaps, pool, dist, treeEdgeTo, srcIndex, K) {
    /** @type {KPopEntry[]} */
    const results = [];

    // First path: the shortest path tree path
    if (dist[srcIndex] === Infinity) return results;
    results.push({ totalCost: dist[srcIndex], sidetracks: [] });
    if (K <= 1) return results;

    // Priority queue for exploring auxiliary graph
    const pq = new BinaryHeap();

    // Seed: root of source's sidetrack heap
    const srcHeapIdx = heaps[srcIndex];
    if (srcHeapIdx !== 0) {
        pq.push(dist[srcIndex] + pool.key[srcHeapIdx], {
            nodeIdx: srcHeapIdx,
            sidetracks: [srcHeapIdx],
        });
    }

    while (!pq.empty && results.length < K) {
        const { key: cost, value: { nodeIdx, sidetracks } } = pq.pop();
        results.push({ totalCost: cost, sidetracks: [...sidetracks] });

        // Explore 3 children in G'':

        // 1. Left child in the leftist heap
        const leftIdx = pool.left[nodeIdx];
        if (leftIdx !== 0) {
            const newCost = cost - pool.key[nodeIdx] + pool.key[leftIdx];
            pq.push(newCost, {
                nodeIdx: leftIdx,
                sidetracks: [...sidetracks.slice(0, -1), leftIdx],
            });
        }

        // 2. Right child in the leftist heap
        const rightIdx = pool.right[nodeIdx];
        if (rightIdx !== 0) {
            const newCost = cost - pool.key[nodeIdx] + pool.key[rightIdx];
            pq.push(newCost, {
                nodeIdx: rightIdx,
                sidetracks: [...sidetracks.slice(0, -1), rightIdx],
            });
        }

        // 3. Cross-edge: heap root of the sidetrack target's subtree
        // The sidetrack edge connects (u, v). We need heap[v].
        // v is stored in pool.edgeTo[nodeIdx]
        const v = pool.edgeTo[nodeIdx];
        const targetHeapIdx = heaps[v];
        if (targetHeapIdx !== 0) {
            pq.push(cost + pool.key[targetHeapIdx], {
                nodeIdx: targetHeapIdx,
                sidetracks: [...sidetracks, targetHeapIdx],
            });
        }
    }

    return results;
}

// ─── Step 6: Path Reconstruction ──────────────────────────

/**
 * Reconstructs the actual s→t node sequence from a KPopEntry.
 *
 * @param {KPopEntry} entry
 * @param {import('./graph.traverse').AugmentedGraph} G
 * @param {HeapPool} pool
 * @param {Float64Array} dist
 * @param {Int32Array} treeEdgeTo
 */
function reconstructPath(entry, G, pool, dist, treeEdgeTo) {
    const sidetracks = entry.sidetracks; // Indices into pool
    const pathNodes = [];
    const edgeInfos = [];

    let curr = G.srcIndex;

    // We follow tree path until we hit the start of a sidetrack edge
    // But sidetrack edges are (u, v).
    // The sequence is: tree path from curr -> u1, take sidetrack (u1, v1),
    // tree path from v1 -> u2, take sidetrack (u2, v2), ...
    // tree path from vk -> sink.

    let sidetrackIdx = 0;

    // Helper to walk tree from `u` until `target` (exclusive) or sink
    // But Dijkstra tree points TO sink: treeEdgeTo[u] = next node towards sink.

    while (curr !== G.sinkIndex && curr !== -1) {
        pathNodes.push(curr);

        // Check if next sidetrack starts here
        if (sidetrackIdx < sidetracks.length) {
            const stNodeIdx = sidetracks[sidetrackIdx];
            const u = pool.edgeFrom[stNodeIdx];

            if (curr === u) {
                // Taking sidetrack edge
                const v = pool.edgeTo[stNodeIdx];

                // Record edge info
                edgeInfos.push({
                    edgeType: pool.edgeType[stNodeIdx],
                    routeId: pool.edgeRouteId[stNodeIdx],
                    weight: pool.edgeWeight[stNodeIdx],
                    edgeOffset: pool.edgeOffset[stNodeIdx],
                });

                curr = v;
                sidetrackIdx++;
                continue;
            }
        }

        // Follow tree edge
        const next = treeEdgeTo[curr];
        if (next === -1) break;

        // Find edge info for tree edge curr -> next
        // Since it's a tree edge, it's one of the outgoing edges from curr
        // We need to find which one points to `next` and has smallest weight
        // (technically Dijkstra picks specific one, but looking it up is fine)
        const forwarded = G.getEdges(curr);
        let bestEdge = null;
        // Optimization: could store edge index in Dijkstra tree to avoid lookup
        // For now, linear scan of outgoing edges (degree is small)
        for (const e of forwarded) {
            if (e.target === next) {
                // To be precise, we should match the weight: dist[curr] = weight + dist[next]
                // Floating point tolerances apply
                if (Math.abs(dist[curr] - (e.weight + dist[next])) < 1e-5) {
                    bestEdge = e;
                    break;
                }
            }
        }

        if (bestEdge) {
            edgeInfos.push({
                edgeType: bestEdge.edgeType,
                routeId: bestEdge.routeId,
                weight: bestEdge.weight,
                edgeOffset: bestEdge.edgeOffset,
            });
        }

        curr = next;
    }
    pathNodes.push(G.sinkIndex);

    // ... (rest of reconstruction logic: stats, pathSegments) ...
    // Calculate stats
    let routeChanges = 0;
    let lastRouteId = -2;
    const routeSet = new Set();
    const passedRoutePairs = [];
    let totalDist = 0;

    for (let i = 0; i < edgeInfos.length; i++) {
        const info = edgeInfos[i];

        // Add distance (approx from weight? No, we don't track distance in Dijkstra anymore)
        // We can get it from distanceArray if we exported it, or just use weight as time
        // Actually weight IS time now. The service returns time.
        // If we want distance, we need to look it up or approximate.
        // For now, let's just assume consumer cares about time.

        if (info.routeId !== lastRouteId) {
            if (lastRouteId !== -2) routeChanges++;
            lastRouteId = info.routeId;
        }
        if (info.routeId > 0) {
            routeSet.add(info.routeId);
            passedRoutePairs.push({ passed: G.getStationId(pathNodes[i]), routeId: info.routeId });
        }
        passedRoutePairs.push({ passed: G.getStationId(pathNodes[i + 1]), routeId: info.routeId });
    }

    // Build pathSegments for visualization
    const pathSegments = [];
    for (let i = 0; i < edgeInfos.length; i++) {
        const info = edgeInfos[i];
        const fromNode = pathNodes[i];
        const toNode = pathNodes[i + 1];

        // Determine segment type
        let segType = 'bus';
        if (info.edgeType === 3) segType = 'metro';
        if (info.edgeType === 2 || info.edgeType === 4 || info.edgeType === 5) segType = 'walk';

        // Try to get polyline
        let pts = [];
        if (info.edgeOffset >= 0) {
            pts = getPolyline(info.edgeOffset);
        }

        // If no polyline, straight line
        if (pts.length === 0) {
            const fromCoord = getNodeCoord(fromNode, G);
            const toCoord = getNodeCoord(toNode, G);
            if (fromCoord && toCoord) {
                pts = [fromCoord, toCoord];
            }
        }

        if (pts.length > 0) {
            pathSegments.push({
                type: segType,
                points: pts,
                routeId: info.routeId,
            });
        }
    }

    return {
        time: entry.totalCost,
        distance: 0, // distance tracking removed for simplicity/speed
        routeChanges: Math.max(routeChanges, 0),
        routes: Array.from(routeSet),
        passedRoutePairs,
        pathSegments,
    };
}

// ─── Public API ───────────────────────────────────────────

/**
 * Finds up to K shortest s→t paths from start to end coordinates.
 * @param {number} startLat
 * @param {number} startLng
 * @param {number} endLat
 * @param {number} endLng
 * @param {number} K - Number of paths
 * @returns {Array<PathResult>}
 */
function findKroute(startLat, startLng, endLat, endLng, K = 1) {
    // 1. Build augmented graph
    const startObj = { lat: startLat, lng: startLng };
    const endObj = { lat: endLat, lng: endLng };
    const G = buildAugmentedGraph(startObj, endObj);

    // 2. Reverse Dijkstra
    const { dist, treeEdgeTo } = reverseDijkstra(G);

    if (dist[G.srcIndex] === Infinity) {
        return []; // No path
    }

    // 3. Build Sidetrack Heaps
    const { heaps, pool } = buildSidetrackHeaps(G, dist, treeEdgeTo);

    // 4. K-Pop
    const kEntries = kPop(heaps, pool, dist, treeEdgeTo, G.srcIndex, K);

    // 5. Reconstruct paths
    return kEntries.map(entry => reconstructPath(entry, G, pool, dist, treeEdgeTo));
}

module.exports = { findKroute };
