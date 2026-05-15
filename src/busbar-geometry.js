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

function quadraticPoint(p0, p1, p2, t) {
    const omt = 1 - t;
    const x = omt * omt * p0[0] + 2 * omt * t * p1[0] + t * t * p2[0];
    const y = omt * omt * p0[1] + 2 * omt * t * p1[1] + t * t * p2[1];
    return [x, y];
}

function smoothPolylinePoints(points, padRadius) {
    if (!Array.isArray(points) || points.length < 3) return points;

    const out = [points[0]];
    const curveSamples = 5;
    const maxTrim = Math.max(0.5, padRadius * 0.65);

    for (let i = 1; i < points.length - 1; i++) {
        const A = points[i - 1];
        const P = points[i];
        const B = points[i + 1];

        const inDx = P[0] - A[0];
        const inDy = P[1] - A[1];
        const outDx = B[0] - P[0];
        const outDy = B[1] - P[1];
        const inLen = Math.hypot(inDx, inDy);
        const outLen = Math.hypot(outDx, outDy);

        if (inLen < 1e-6 || outLen < 1e-6) {
            out.push(P);
            continue;
        }

        const uxIn = inDx / inLen;
        const uyIn = inDy / inLen;
        const uxOut = outDx / outLen;
        const uyOut = outDy / outLen;

        // If the path is already almost straight, keep the original point.
        const dot = uxIn * uxOut + uyIn * uyOut;
        if (dot > 0.985) {
            out.push(P);
            continue;
        }

        const trim = Math.min(maxTrim, inLen * 0.35, outLen * 0.35);
        if (trim < 0.25) {
            out.push(P);
            continue;
        }

        const start = [P[0] - uxIn * trim, P[1] - uyIn * trim];
        const end = [P[0] + uxOut * trim, P[1] + uyOut * trim];

        out.push(start);
        for (let s = 1; s < curveSamples; s++) {
            const t = s / curveSamples;
            out.push(quadraticPoint(start, P, end, t));
        }
        out.push(end);
    }

    out.push(points[points.length - 1]);
    return out;
}

function inferHorizontalPitch(positions) {
    const epsilon = 1e-3;
    const rows = new Map();
    for (const pos of positions) {
        const key = pos[1].toFixed(4);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(pos[0]);
    }

    let pitch = Infinity;
    for (const rowXs of rows.values()) {
        rowXs.sort((a, b) => a - b);
        for (let index = 1; index < rowXs.length; index++) {
            const delta = rowXs[index] - rowXs[index - 1];
            if (delta > epsilon) pitch = Math.min(pitch, delta);
        }
    }

    return Number.isFinite(pitch) ? pitch : 0;
}

function inferVerticalPitch(positions) {
    const epsilon = 1e-3;
    const cols = new Map();
    for (const pos of positions) {
        const key = pos[0].toFixed(4);
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(pos[1]);
    }

    let pitch = Infinity;
    for (const colYs of cols.values()) {
        colYs.sort((a, b) => a - b);
        for (let index = 1; index < colYs.length; index++) {
            const delta = colYs[index] - colYs[index - 1];
            if (delta > epsilon) pitch = Math.min(pitch, delta);
        }
    }

    return Number.isFinite(pitch) ? pitch : 0;
}

function computeBoundaryRoundoverFeatures(cellIndices, positions, padRadius) {
    if (cellIndices.length < 2) {
        return { extraPads: [], extraSegments: [] };
    }

    const selected = cellIndices
        .map((index) => ({ index, pos: positions[index] }))
        .filter((entry) => Array.isArray(entry.pos) && entry.pos.length >= 2);
    if (selected.length !== cellIndices.length) {
        return { extraPads: [], extraSegments: [] };
    }

    const epsilon = 1e-3;
    const horizontalPitch = inferHorizontalPitch(positions);
    if (horizontalPitch <= epsilon) {
        return { extraPads: [], extraSegments: [] };
    }

    const xTolerance = Math.max(0.5, horizontalPitch * 0.25);
    const yTolerance = 1e-3;
    const hasHorizontalNeighbor = (entry, direction) => positions.some((pos) => {
        if (Math.abs(pos[1] - entry.pos[1]) > yTolerance) return false;
        const deltaX = pos[0] - entry.pos[0];
        if (direction === 'left' && deltaX >= -epsilon) return false;
        if (direction === 'right' && deltaX <= epsilon) return false;
        return Math.abs(Math.abs(deltaX) - horizontalPitch) <= xTolerance;
    });

    const rows = new Map();
    for (const entry of selected) {
        const key = entry.pos[1].toFixed(4);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(entry);
    }

    const leftBoundary = [];
    const rightBoundary = [];
    for (const rowEntries of rows.values()) {
        rowEntries.sort((a, b) => a.pos[0] - b.pos[0]);
        leftBoundary.push(rowEntries[0]);
        rightBoundary.push(rowEntries[rowEntries.length - 1]);
    }

    const leftExposed = leftBoundary.filter((entry) => !hasHorizontalNeighbor(entry, 'left'));
    const rightExposed = rightBoundary.filter((entry) => !hasHorizontalNeighbor(entry, 'right'));
    const extraPads = [];
    const extraSegments = [];
    const fillRadius = Math.max(0.2, padRadius * 0.55);
    const outwardShift = Math.max(0.2, padRadius * 0.22);

    const addSideRoundovers = (entries, side) => {
        const direction = side === 'left' ? -1 : 1;
        const ordered = entries.slice().sort((a, b) => a.pos[1] - b.pos[1]);
        for (let index = 0; index < ordered.length - 1; index++) {
            const top = ordered[index];
            const bottom = ordered[index + 1];
            const fillKey = `boundary_round_${side}_${index}`;
            const fillPos = [
                (top.pos[0] + bottom.pos[0]) / 2 + direction * outwardShift,
                (top.pos[1] + bottom.pos[1]) / 2,
            ];
            extraPads.push({ key: fillKey, pos: fillPos, radius: fillRadius });
            extraSegments.push({ from: fillPos, to: top.pos, fromKey: fillKey, toKey: `c${top.index}`, radius: fillRadius });
            extraSegments.push({ from: fillPos, to: bottom.pos, fromKey: fillKey, toKey: `c${bottom.index}`, radius: fillRadius });
        }
    };

    addSideRoundovers(leftExposed, 'left');
    addSideRoundovers(rightExposed, 'right');

    return { extraPads, extraSegments };
}

function computeEdgeOverlapFeatures(cellIndices, positions, layoutType, overlapLength, cellRadius, spacing) {
    if (layoutType === 'vertical') {
        return computeEdgeOverlapFeaturesVertical(cellIndices, positions, overlapLength, cellRadius, spacing);
    }

    if (cellIndices.length < 2) {
        return { extraPads: [], extraSegments: [] };
    }

    const selected = cellIndices
        .map((index) => ({ index, pos: positions[index] }))
        .filter((entry) => Array.isArray(entry.pos) && entry.pos.length >= 2);
    if (selected.length !== cellIndices.length) {
        return { extraPads: [], extraSegments: [] };
    }

    const epsilon = 1e-3;
    const horizontalPitch = inferHorizontalPitch(positions);
    if (horizontalPitch <= epsilon) {
        return { extraPads: [], extraSegments: [] };
    }

    const xTolerance = Math.max(0.5, horizontalPitch * 0.25);
    const yTolerance = 1e-3;
    const hasHorizontalNeighbor = (entry, direction) => positions.some((pos) => {
        if (Math.abs(pos[1] - entry.pos[1]) > yTolerance) return false;
        const deltaX = pos[0] - entry.pos[0];
        if (direction === 'left' && deltaX >= -epsilon) return false;
        if (direction === 'right' && deltaX <= epsilon) return false;
        return Math.abs(Math.abs(deltaX) - horizontalPitch) <= xTolerance;
    });

    const rows = new Map();
    for (const entry of selected) {
        const key = entry.pos[1].toFixed(4);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push(entry);
    }

    const leftBoundary = [];
    const rightBoundary = [];
    for (const rowEntries of rows.values()) {
        rowEntries.sort((a, b) => a.pos[0] - b.pos[0]);
        leftBoundary.push(rowEntries[0]);
        rightBoundary.push(rowEntries[rowEntries.length - 1]);
    }

    const leftExposed = leftBoundary.filter((entry) => !hasHorizontalNeighbor(entry, 'left'));
    const rightExposed = rightBoundary.filter((entry) => !hasHorizontalNeighbor(entry, 'right'));

    let chosenSide = null;
    let boundaryEntries = [];
    if (leftExposed.length > rightExposed.length && leftExposed.length > 0) {
        chosenSide = 'left';
        boundaryEntries = leftExposed;
    } else if (rightExposed.length > leftExposed.length && rightExposed.length > 0) {
        chosenSide = 'right';
        boundaryEntries = rightExposed;
    }

    if (!chosenSide || boundaryEntries.length === 0) {
        return { extraPads: [], extraSegments: [] };
    }

    // Skip overlap if the busbar spans only one column (all cells share the same
    // X-coordinate, rounded to 0.1 mm).  A single-column busbar's internal edges
    // are all vertical, so a horizontal arm would be at 90° to every connection
    // and would visually overlap adjacent busbars.
    const uniqueXCount = new Set(selected.map(e => Math.round(e.pos[0] * 10))).size;
    if (uniqueXCount < 2) {
        return { extraPads: [], extraSegments: [] };
    }

    const extension = Number.isFinite(Number(overlapLength)) && Number(overlapLength) > 0
        ? Number(overlapLength)
        : 10;
    const direction = chosenSide === 'left' ? -1 : 1;
    const straightHoneycombX = layoutType === 'honeycomb'
        ? (direction < 0
            ? Math.min(...boundaryEntries.map((entry) => entry.pos[0])) - extension
            : Math.max(...boundaryEntries.map((entry) => entry.pos[0])) + extension)
        : null;
    const extraPads = [];
    const extraSegments = [];
    const overlapPads = boundaryEntries
        .slice()
        .sort((a, b) => a.pos[1] - b.pos[1])
        .map((entry, index) => {
        const key = `edge_overlap_${index}`;
        const overlapPos = [
            straightHoneycombX ?? (entry.pos[0] + direction * extension),
            entry.pos[1],
        ];
        extraPads.push({ key, pos: overlapPos });
        extraSegments.push({ from: overlapPos, to: entry.pos, fromKey: key, toKey: `c${entry.index}` });
        return { key, pos: overlapPos };
        });

    for (let index = 0; index < overlapPads.length - 1; index++) {
        const topOverlapPad = overlapPads[index];
        const bottomOverlapPad = overlapPads[index + 1];
        const topCell = boundaryEntries[index];
        const bottomCell = boundaryEntries[index + 1];

        extraSegments.push({
            from: topOverlapPad.pos,
            to: bottomOverlapPad.pos,
            fromKey: topOverlapPad.key,
            toKey: bottomOverlapPad.key,
        });

        // Large overlap offsets open a trapezoid between two neighboring connector
        // legs and the outer spine. Add one interior hub and connect it to the
        // bay corners so the shared pad/capsule geometry stays fully filled.
        const fillKey = `edge_overlap_fill_${index}`;
        const fillPos = [
            (topOverlapPad.pos[0] + bottomOverlapPad.pos[0] + topCell.pos[0] + bottomCell.pos[0]) / 4,
            (topOverlapPad.pos[1] + bottomOverlapPad.pos[1] + topCell.pos[1] + bottomCell.pos[1]) / 4,
        ];
        extraPads.push({ key: fillKey, pos: fillPos });
        extraSegments.push({ from: fillPos, to: topOverlapPad.pos, fromKey: fillKey, toKey: topOverlapPad.key });
        extraSegments.push({ from: fillPos, to: bottomOverlapPad.pos, fromKey: fillKey, toKey: bottomOverlapPad.key });
        extraSegments.push({ from: fillPos, to: topCell.pos, fromKey: fillKey, toKey: `c${topCell.index}` });
        extraSegments.push({ from: fillPos, to: bottomCell.pos, fromKey: fillKey, toKey: `c${bottomCell.index}` });
    }

    return { extraPads, extraSegments };
}

function computeBoundaryRoundoverFeaturesVertical(cellIndices, positions, padRadius) {
    if (cellIndices.length < 2) {
        return { extraPads: [], extraSegments: [] };
    }

    const selected = cellIndices
        .map((index) => ({ index, pos: positions[index] }))
        .filter((entry) => Array.isArray(entry.pos) && entry.pos.length >= 2);
    if (selected.length !== cellIndices.length) {
        return { extraPads: [], extraSegments: [] };
    }

    const epsilon = 1e-3;
    const verticalPitch = inferVerticalPitch(positions);
    if (verticalPitch <= epsilon) {
        return { extraPads: [], extraSegments: [] };
    }

    const yTolerance = Math.max(0.5, verticalPitch * 0.25);
    const xTolerance = 1e-3;
    const hasVerticalNeighbor = (entry, direction) => positions.some((pos) => {
        if (Math.abs(pos[0] - entry.pos[0]) > xTolerance) return false;
        const deltaY = pos[1] - entry.pos[1];
        if (direction === 'top' && deltaY >= -epsilon) return false;
        if (direction === 'bottom' && deltaY <= epsilon) return false;
        return Math.abs(Math.abs(deltaY) - verticalPitch) <= yTolerance;
    });

    const cols = new Map();
    for (const entry of selected) {
        const key = entry.pos[0].toFixed(4);
        if (!cols.has(key)) cols.set(key, []);
        cols.get(key).push(entry);
    }

    const topBoundary = [];
    const bottomBoundary = [];
    for (const colEntries of cols.values()) {
        colEntries.sort((a, b) => a.pos[1] - b.pos[1]);
        topBoundary.push(colEntries[0]);
        bottomBoundary.push(colEntries[colEntries.length - 1]);
    }

    const topExposed = topBoundary.filter((entry) => !hasVerticalNeighbor(entry, 'top'));
    const bottomExposed = bottomBoundary.filter((entry) => !hasVerticalNeighbor(entry, 'bottom'));

    const extraPads = [];
    const extraSegments = [];
    const fillRadius = Math.max(0.2, padRadius * 0.55);
    const outwardShift = Math.max(0.2, padRadius * 0.22);

    const addSideRoundovers = (entries, side) => {
        const direction = side === 'top' ? -1 : 1;
        const ordered = entries.slice().sort((a, b) => a.pos[0] - b.pos[0]);
        for (let index = 0; index < ordered.length - 1; index++) {
            const left = ordered[index];
            const right = ordered[index + 1];
            const fillKey = `boundary_round_${side}_${index}`;
            const fillPos = [
                (left.pos[0] + right.pos[0]) / 2,
                (left.pos[1] + right.pos[1]) / 2 + direction * outwardShift,
            ];
            extraPads.push({ key: fillKey, pos: fillPos, radius: fillRadius });
            extraSegments.push({ from: fillPos, to: left.pos, fromKey: fillKey, toKey: `c${left.index}`, radius: fillRadius });
            extraSegments.push({ from: fillPos, to: right.pos, fromKey: fillKey, toKey: `c${right.index}`, radius: fillRadius });
        }
    };

    addSideRoundovers(topExposed, 'top');
    addSideRoundovers(bottomExposed, 'bottom');

    return { extraPads, extraSegments };
}

function computeEdgeOverlapFeaturesVertical(cellIndices, positions, overlapLength, cellRadius, spacing) {
    if (cellIndices.length < 2) {
        return { extraPads: [], extraSegments: [] };
    }

    const selected = cellIndices
        .map((index) => ({ index, pos: positions[index] }))
        .filter((entry) => Array.isArray(entry.pos) && entry.pos.length >= 2);
    if (selected.length !== cellIndices.length) {
        return { extraPads: [], extraSegments: [] };
    }

    // Measure the X pitch between adjacent columns in the full layout.
    const uniqueColXs = [...new Set(positions.map(p => Math.round(p[0] * 10)))]
        .sort((a, b) => a - b);
    let colPitch = Infinity;
    for (let i = 1; i < uniqueColXs.length; i++) {
        const d = (uniqueColXs[i] - uniqueColXs[i - 1]) / 10;
        if (d > 1e-3) colPitch = Math.min(colPitch, d);
    }
    if (!Number.isFinite(colPitch) || colPitch <= 1e-3) {
        return { extraPads: [], extraSegments: [] };
    }
    const colTolerance = colPitch * 0.3;

    // Group selected cells by column (keyed by rounded X*10).
    const colMap = new Map();
    for (const entry of selected) {
        const key = Math.round(entry.pos[0] * 10);
        if (!colMap.has(key)) colMap.set(key, []);
        colMap.get(key).push(entry);
    }

    const sortedColKeys = [...colMap.keys()].sort((a, b) => a - b);
    const leftColX = sortedColKeys[0] / 10;
    const rightColX = sortedColKeys[sortedColKeys.length - 1] / 10;

    // Count how many boundary-column cells have no full-layout column neighbor.
    const leftColCells = colMap.get(sortedColKeys[0]);
    const rightColCells = colMap.get(sortedColKeys[sortedColKeys.length - 1]);

    const countExposed = (colCells, side) => colCells.filter((entry) => {
        const neighborX = side === 'left' ? leftColX - colPitch : rightColX + colPitch;
        return !positions.some((p) => Math.abs(p[0] - neighborX) < colTolerance);
    }).length;

    const leftExposedCount = countExposed(leftColCells, 'left');
    const rightExposedCount = countExposed(rightColCells, 'right');

    // Skip if the busbar is only a single column — a single-column spine that
    // runs straight through all pads adds no useful material above what the
    // pad-and-edge geometry already provides.
    // (We still proceed when there are multiple columns.)
    let chosenSide, boundaryCells, boundaryColX;
    if (leftExposedCount > rightExposedCount) {
        chosenSide = 'left';
        boundaryCells = leftColCells;
        boundaryColX = leftColX;
    } else if (rightExposedCount > leftExposedCount) {
        chosenSide = 'right';
        boundaryCells = rightColCells;
        boundaryColX = rightColX;
    } else if (leftExposedCount > 0) {
        // Tie: prefer left.
        chosenSide = 'left';
        boundaryCells = leftColCells;
        boundaryColX = leftColX;
    } else {
        return { extraPads: [], extraSegments: [] };
    }

    const extension = Number.isFinite(Number(overlapLength)) && Number(overlapLength) > 0
        ? Number(overlapLength)
        : 10;

    // Place the spine relative to the pack boundary (not the cell centre) so the
    // overlap tab is clearly visible outside the pack rectangle.
    const packLeft = Math.min(...positions.map(p => p[0])) - cellRadius - spacing;
    const packRight = Math.max(...positions.map(p => p[0])) + cellRadius + spacing;
    const spineX = chosenSide === 'left'
        ? packLeft - extension
        : packRight + extension;

    const extraPads = [];
    const extraSegments = [];
    const sortedBoundaryCells = boundaryCells.slice().sort((a, b) => a.pos[1] - b.pos[1]);

    const overlapPads = sortedBoundaryCells.map((entry, index) => {
        const key = `edge_overlap_${index}`;
        const overlapPos = [spineX, entry.pos[1]];
        extraPads.push({ key, pos: overlapPos });
        extraSegments.push({ from: overlapPos, to: entry.pos, fromKey: key, toKey: `c${entry.index}` });
        return { key, pos: overlapPos };
    });

    // Connect adjacent spine pads with a vertical segment and add fill pads.
    for (let index = 0; index < overlapPads.length - 1; index++) {
        const topPad = overlapPads[index];
        const bottomPad = overlapPads[index + 1];
        const topCell = sortedBoundaryCells[index];
        const bottomCell = sortedBoundaryCells[index + 1];

        extraSegments.push({
            from: topPad.pos,
            to: bottomPad.pos,
            fromKey: topPad.key,
            toKey: bottomPad.key,
        });

        const fillKey = `edge_overlap_fill_${index}`;
        const fillPos = [
            (topPad.pos[0] + bottomPad.pos[0] + topCell.pos[0] + bottomCell.pos[0]) / 4,
            (topPad.pos[1] + bottomPad.pos[1] + topCell.pos[1] + bottomCell.pos[1]) / 4,
        ];
        extraPads.push({ key: fillKey, pos: fillPos });
        extraSegments.push({ from: fillPos, to: topPad.pos, fromKey: fillKey, toKey: topPad.key });
        extraSegments.push({ from: fillPos, to: bottomPad.pos, fromKey: fillKey, toKey: bottomPad.key });
        extraSegments.push({ from: fillPos, to: topCell.pos, fromKey: fillKey, toKey: `c${topCell.index}` });
        extraSegments.push({ from: fillPos, to: bottomCell.pos, fromKey: fillKey, toKey: `c${bottomCell.index}` });
    }

    return { extraPads, extraSegments };
}

function computeCellCutouts(cellIndices, positions, cellCutoutEnabled) {
    if (cellCutoutEnabled !== true) return [];

    return cellIndices
        .map((index) => positions[index])
        .filter((pos) => Array.isArray(pos) && pos.length >= 2)
        .map((pos) => ({ center: pos.slice(), width: 5, height: 2 }));
}

export function computeBusbarGeometry(cellIndices, positions, cellRadius, padRadius, spacing, keepoutRadius, packBounds = null, overlapEnabled = true, layoutType = 'grid', overlapSize = 10, cellCutoutEnabled = false) {
    if (cellIndices.length === 0) {
        return { padIndices: [], edges: [], blocked: null, extraPads: [], extraSegments: [], cutouts: [] };
    }
    if (cellIndices.length === 1) {
        return {
            padIndices: cellIndices.slice(),
            edges: [],
            blocked: null,
            extraPads: [],
            extraSegments: [],
            cutouts: computeCellCutouts(cellIndices, positions, cellCutoutEnabled),
        };
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
                    extraPads: [],
                    extraSegments: [],
                    cutouts: [],
                };
            }
        }
    }

    const roundedEdges = edges.map((edge) => {
        const basePts = [positions[edge.from], ...edge.waypoints, positions[edge.to]];
        const smoothPts = smoothPolylinePoints(basePts, padRadius);
        return {
            from: edge.from,
            to: edge.to,
            waypoints: smoothPts.slice(1, -1),
        };
    });

    const overlapFeatures = overlapEnabled
        ? computeEdgeOverlapFeatures(cellIndices, positions, layoutType, overlapSize, cellRadius, spacing)
        : { extraPads: [], extraSegments: [] };
    const roundoverFeatures = layoutType === 'vertical'
        ? computeBoundaryRoundoverFeaturesVertical(cellIndices, positions, padRadius)
        : computeBoundaryRoundoverFeatures(cellIndices, positions, padRadius);
    const cutouts = computeCellCutouts(cellIndices, positions, cellCutoutEnabled);

    return {
        padIndices: cellIndices.slice(),
        edges: roundedEdges,
        blocked: null,
        extraPads: [...overlapFeatures.extraPads, ...roundoverFeatures.extraPads],
        extraSegments: [...overlapFeatures.extraSegments, ...roundoverFeatures.extraSegments],
        cutouts,
    };
}
