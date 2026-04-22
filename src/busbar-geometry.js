function buildEdgePairs(indices, positions, cellRadius, spacing) {
    const edges = [];
    const threshold = (2 * cellRadius + spacing) * 1.3;
    for (let i = 0; i < indices.length; i++) {
        for (let j = i + 1; j < indices.length; j++) {
            const a = positions[indices[i]], b = positions[indices[j]];
            if (Math.hypot(a[0] - b[0], a[1] - b[1]) <= threshold) {
                edges.push([indices[i], indices[j]]);
            }
        }
    }

    const adj = new Map();
    indices.forEach(i => adj.set(i, []));
    for (const [a, b] of edges) {
        adj.get(a).push(b);
        adj.get(b).push(a);
    }

    const visited = new Set();
    const components = [];
    for (const start of indices) {
        if (visited.has(start)) continue;
        const comp = [];
        const stack = [start];
        while (stack.length) {
            const n = stack.pop();
            if (visited.has(n)) continue;
            visited.add(n);
            comp.push(n);
            for (const m of adj.get(n)) stack.push(m);
        }
        components.push(comp);
    }

    while (components.length > 1) {
        let best = null, bestD = Infinity, bestI = -1, bestJ = -1;
        for (let i = 0; i < components.length; i++) {
            for (let j = i + 1; j < components.length; j++) {
                for (const a of components[i]) {
                    for (const b of components[j]) {
                        const d = Math.hypot(positions[a][0] - positions[b][0], positions[a][1] - positions[b][1]);
                        if (d < bestD) { bestD = d; best = [a, b]; bestI = i; bestJ = j; }
                    }
                }
            }
        }
        edges.push(best);
        components[bestI] = components[bestI].concat(components[bestJ]);
        components.splice(bestJ, 1);
    }

    return edges;
}

function distPointToSegment(P, A, B) {
    const abx = B[0] - A[0], aby = B[1] - A[1];
    const ab2 = abx * abx + aby * aby;
    if (ab2 === 0) return Math.hypot(P[0] - A[0], P[1] - A[1]);
    const t = Math.max(0, Math.min(1, ((P[0] - A[0]) * abx + (P[1] - A[1]) * aby) / ab2));
    const cx = A[0] + t * abx, cy = A[1] + t * aby;
    return Math.hypot(P[0] - cx, P[1] - cy);
}

function capsuleClear(A, B, capsuleRadius, obstacles, obstacleRadius, margin) {
    const minDist = capsuleRadius + obstacleRadius + margin;
    for (const C of obstacles) {
        if (distPointToSegment(C, A, B) < minDist) return false;
    }
    return true;
}

function findBendWaypoint(A, B, R, obstacles, obstacleRadius, margin) {
    const midX = (A[0] + B[0]) / 2, midY = (A[1] + B[1]) / 2;
    const dx = B[0] - A[0], dy = B[1] - A[1];
    const len = Math.hypot(dx, dy);
    if (len === 0) return null;
    const perpX = -dy / len, perpY = dx / len;

    const step = R + obstacleRadius + margin + 1;
    for (let k = 1; k <= 10; k++) {
        for (const sign of [1, -1]) {
            const offset = k * step;
            const P = [midX + sign * offset * perpX, midY + sign * offset * perpY];
            if (capsuleClear(A, P, R, obstacles, obstacleRadius, margin) &&
                capsuleClear(P, B, R, obstacles, obstacleRadius, margin)) {
                return P;
            }
        }
    }
    return null;
}

export function computeBusbarGeometry(cellIndices, positions, cellRadius, padRadius, spacing, keepoutRadius) {
    if (cellIndices.length === 0) {
        return { padIndices: [], edges: [], blocked: null };
    }
    if (cellIndices.length === 1) {
        return { padIndices: cellIndices.slice(), edges: [], blocked: null };
    }

    const edgePairs = buildEdgePairs(cellIndices, positions, cellRadius, spacing);
    const selectedSet = new Set(cellIndices);
    const obstacles = positions.filter((_, i) => !selectedSet.has(i));

    const margin = Math.max(spacing, 0.3);
    const R = padRadius;
    const edges = [];

    for (const [i, j] of edgePairs) {
        const A = positions[i], B = positions[j];

        if (capsuleClear(A, B, R, obstacles, keepoutRadius, margin)) {
            edges.push({ from: i, to: j, waypoints: [] });
        } else {
            const P = findBendWaypoint(A, B, R, obstacles, keepoutRadius, margin);
            if (P) {
                edges.push({ from: i, to: j, waypoints: [P] });
            } else {
                return {
                    padIndices: cellIndices.slice(),
                    edges,
                    blocked: { from: i, to: j, reason: 'no clear route between these cells' },
                };
            }
        }
    }

    return { padIndices: cellIndices.slice(), edges, blocked: null };
}
