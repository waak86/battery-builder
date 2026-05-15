import { canvasState } from './state.js';

function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}




export function drawBusbarsOverlay(busbars, geometries, positions, cellSize, padRadius, spacing, activeId, canvasId = 'preview', ghostMode = false, mirrorH = false) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const t = canvasState.viewTransform;
    if (!t || busbars.length === 0) return;

    const ctx = canvas.getContext('2d');
    const cellR = cellSize / 2;
    const toScreenX = (wx) => (wx - t.minX + cellR + spacing) * t.scale + t.offsetX;
    const toScreenY = (wy) => (wy - t.minY + cellR + spacing) * t.scale + t.offsetY;
    const padRadiusScreen = (radius) => (radius ?? padRadius) * t.scale;
    const extraSegments = (geom) => Array.isArray(geom?.extraSegments) ? geom.extraSegments : [];
    const extraPads = (geom) => Array.isArray(geom?.extraPads) ? geom.extraPads : [];
    const cutouts = (geom) => Array.isArray(geom?.cutouts) ? geom.cutouts : [];

    ctx.save();
    ctx.translate(canvasState.panX, canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);

    const zoom = canvasState.zoom;

    busbars.forEach((busbar, idx) => {
        const geom = geometries[idx];
        if (!geom || busbar.cellIndices.length === 0) return;
        const isActive = !ghostMode && busbar.id === activeId;
        const fillAlpha = ghostMode ? 0.12 : (isActive ? 0.45 : 0.3);

        // Render all fill strokes onto an offscreen canvas at full opacity, then
        // composite once at fillAlpha. This prevents overlapping edge strokes from
        // double-compositing each other and creating visible seams at junctions.
        const dpr = window.devicePixelRatio || 1;
        const offscreen = document.createElement('canvas');
        offscreen.width = canvas.width;
        offscreen.height = canvas.height;
        const off = offscreen.getContext('2d');
        // Apply DPR scale first so physical pixels match the main canvas when
        // composited at identity transform via drawImage.
        off.scale(dpr, dpr);
        off.translate(canvasState.panX, canvasState.panY);
        off.scale(canvasState.zoom, canvasState.zoom);

        const hex = busbar.color;
        const opaqueColor = `rgb(${parseInt(hex.slice(1,3),16)},${parseInt(hex.slice(3,5),16)},${parseInt(hex.slice(5,7),16)})`;

        const cellIndices = busbar.cellIndices;
        const nCells = cellIndices.length;

        // Build adjacency.
        // capsThresh: direct neighbours — used for capsule strokes.
        // triThresh: slightly larger — includes rect-grid diagonals so the square
        //   interstice between 4 cells is also covered by a triangle fill.
        const capsThresh = (cellSize + spacing) * 1.3;
        const triThresh  = (cellSize + spacing) * 1.5;

        const adjCaps = [];                // pairs [a,b] to stroke as capsules
        const triAdj  = Array.from({length: nCells}, () => new Set());

        for (let a = 0; a < nCells; a++) {
            for (let b = a + 1; b < nCells; b++) {
                const pa = positions[cellIndices[a]], pb = positions[cellIndices[b]];
                if (!pa || !pb) continue;
                const d = Math.hypot(pa[0] - pb[0], pa[1] - pb[1]);
                if (d <= capsThresh) {
                    adjCaps.push([a, b]);
                    triAdj[a].add(b); triAdj[b].add(a);
                } else if (d <= triThresh) {
                    triAdj[a].add(b); triAdj[b].add(a);
                }
            }
        }

        // 1. Capsule strokes between direct neighbours (lineCap:round = semicircle
        //    at each end, so two meeting capsules form a full circle at every junction).
        off.strokeStyle = opaqueColor;
        off.lineWidth = 2 * padRadiusScreen();
        off.lineCap = 'round';
        off.lineJoin = 'round';
        for (const [a, b] of adjCaps) {
            const pa = positions[cellIndices[a]], pb = positions[cellIndices[b]];
            off.beginPath();
            off.moveTo(toScreenX(pa[0]), toScreenY(pa[1]));
            off.lineTo(toScreenX(pb[0]), toScreenY(pb[1]));
            off.stroke();
        }
        for (const segment of extraSegments(geom)) {
            off.lineWidth = 2 * padRadiusScreen(segment.radius);
            off.beginPath();
            off.moveTo(toScreenX(segment.from[0]), toScreenY(segment.from[1]));
            off.lineTo(toScreenX(segment.to[0]), toScreenY(segment.to[1]));
            off.stroke();
        }

        // 2. Circle fills at every cell pad.
        off.fillStyle = opaqueColor;
        off.beginPath();
        for (const ci of cellIndices) {
            const p = positions[ci]; if (!p) continue;
            const radius = padRadiusScreen();
            const sx = toScreenX(p[0]), sy = toScreenY(p[1]);
            off.moveTo(sx + radius, sy);
            off.arc(sx, sy, radius, 0, Math.PI * 2);
        }
        for (const pad of extraPads(geom)) {
            const radius = padRadiusScreen(pad.radius);
            const sx = toScreenX(pad.pos[0]);
            const sy = toScreenY(pad.pos[1]);
            off.moveTo(sx + radius, sy);
            off.arc(sx, sy, radius, 0, Math.PI * 2);
        }
        off.fill();

        // 3. Fill the three-circle interstice without extending to the cell centers.
        //    Use curved joins through the centroid so boundary bays stay rounded
        //    instead of forming straight-sided inward peaks.
        off.fillStyle = opaqueColor;
        for (let a = 0; a < nCells; a++) {
            for (const b of triAdj[a]) {
                if (b <= a) continue;
                for (const c of triAdj[a]) {
                    if (c <= b) continue;
                    if (!triAdj[b].has(c)) continue;
                    const pa = positions[cellIndices[a]];
                    const pb = positions[cellIndices[b]];
                    const pc = positions[cellIndices[c]];
                    if (!pa || !pb || !pc) continue;

                    const centroid = [
                        (pa[0] + pb[0] + pc[0]) / 3,
                        (pa[1] + pb[1] + pc[1]) / 3,
                    ];
                    const tangentPoints = [pa, pb, pc].map((point) => {
                        const dx = point[0] - centroid[0];
                        const dy = point[1] - centroid[1];
                        const len = Math.hypot(dx, dy);
                        if (len < 1e-6 || len <= padRadius) return point;
                        const inset = padRadius / len;
                        return [
                            point[0] - dx * inset,
                            point[1] - dy * inset,
                        ];
                    });

                    off.beginPath();
                    off.moveTo(toScreenX(tangentPoints[0][0]), toScreenY(tangentPoints[0][1]));
                    off.quadraticCurveTo(
                        toScreenX(centroid[0]),
                        toScreenY(centroid[1]),
                        toScreenX(tangentPoints[1][0]),
                        toScreenY(tangentPoints[1][1]),
                    );
                    off.quadraticCurveTo(
                        toScreenX(centroid[0]),
                        toScreenY(centroid[1]),
                        toScreenX(tangentPoints[2][0]),
                        toScreenY(tangentPoints[2][1]),
                    );
                    off.quadraticCurveTo(
                        toScreenX(centroid[0]),
                        toScreenY(centroid[1]),
                        toScreenX(tangentPoints[0][0]),
                        toScreenY(tangentPoints[0][1]),
                    );
                    off.closePath();
                    off.fill();
                }
            }
        }

        // 3b. Fill four-cell square interstice (grid layout).
        // For every diagonal pair (in triAdj but not adjCaps) that has exactly
        // 2 common direct (capsule) neighbours, those 4 cells form a 2×2 square.
        // Fill a circle at the centroid whose radius spans the gap.
        {
            const directSet = new Set(adjCaps.map(([a, b]) => `${Math.min(a,b)}_${Math.max(a,b)}`));
            const visited4 = new Set();
            off.fillStyle = opaqueColor;

            for (let a = 0; a < nCells; a++) {
                for (const b of triAdj[a]) {
                    if (b <= a) continue;
                    if (directSet.has(`${Math.min(a,b)}_${Math.max(a,b)}`)) continue; // skip direct neighbours

                    // a–b is diagonal; find their common direct neighbours
                    const common = [];
                    for (const c of triAdj[a]) {
                        if (c === b) continue;
                        if (!directSet.has(`${Math.min(a,c)}_${Math.max(a,c)}`)) continue;
                        if (!triAdj[b].has(c)) continue;
                        if (!directSet.has(`${Math.min(b,c)}_${Math.max(b,c)}`)) continue;
                        common.push(c);
                    }
                    if (common.length < 2) continue;

                    const [c, d] = common.sort((x, y) => x - y);
                    const quadKey = [a, b, c, d].sort((x, y) => x - y).join('_');
                    if (visited4.has(quadKey)) continue;
                    visited4.add(quadKey);

                    const pa = positions[cellIndices[a]];
                    const pb = positions[cellIndices[b]];
                    const pc = positions[cellIndices[c]];
                    const pd = positions[cellIndices[d]];
                    if (!pa || !pb || !pc || !pd) continue;

                    const qcx = (pa[0] + pb[0] + pc[0] + pd[0]) / 4;
                    const qcy = (pa[1] + pb[1] + pc[1] + pd[1]) / 4;
                    const distToCell = Math.hypot(pa[0] - qcx, pa[1] - qcy);
                    const fillR = Math.max(0.5, distToCell - padRadius);

                    off.beginPath();
                    off.arc(toScreenX(qcx), toScreenY(qcy), fillR * t.scale, 0, Math.PI * 2);
                    off.fill();
                }
            }
        }

        // 4. Obstacle-avoidance detour waypoints (spanning-tree edges with bends).
        off.strokeStyle = opaqueColor;
        off.lineWidth = 2 * padRadiusScreen();
        off.lineCap = 'round';
        for (const edge of geom.edges) {
            if (edge.waypoints.length === 0) continue;
            const pts = [positions[edge.from], ...edge.waypoints, positions[edge.to]];
            if (pts.some(p => !p)) continue;
            off.beginPath();
            off.moveTo(toScreenX(pts[0][0]), toScreenY(pts[0][1]));
            for (let k = 1; k < pts.length; k++) off.lineTo(toScreenX(pts[k][0]), toScreenY(pts[k][1]));
            off.stroke();
        }

        off.save();
        off.globalCompositeOperation = 'destination-out';
        for (const cutout of cutouts(geom)) {
            const width = cutout.width * t.scale;
            const height = cutout.height * t.scale;
            const cx = toScreenX(cutout.center[0]);
            const cy = toScreenY(cutout.center[1]);
            off.fillRect(cx - width / 2, cy - height / 2, width, height);
        }
        off.restore();

        // Composite offscreen onto main canvas at fillAlpha (reset transform for pixel-exact drawImage)
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = fillAlpha;
        ctx.drawImage(offscreen, 0, 0);
        ctx.restore();

        // Skip outlines in ghost mode — ghost is fill-only.
        if (!ghostMode) {
            ctx.strokeStyle = hexToRgba(busbar.color, isActive ? 1.0 : 0.85);
            ctx.lineWidth = (isActive ? 2.5 : 1.5) / zoom;
            for (const i of busbar.cellIndices) {
                if (!positions[i]) continue;
                const [x, y] = positions[i];
                const sx = toScreenX(x), sy = toScreenY(y);
                ctx.beginPath();
                ctx.arc(sx, sy, padRadiusScreen(), 0, Math.PI * 2);
                ctx.stroke();
            }
        }

        if (!ghostMode && geom.blocked) {
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 3 / zoom;
            ctx.setLineDash([8 / zoom, 5 / zoom]);
            const A = positions[geom.blocked.from];
            const B = positions[geom.blocked.to];
            if (A && B) {
                ctx.beginPath();
                ctx.moveTo(toScreenX(A[0]), toScreenY(A[1]));
                ctx.lineTo(toScreenX(B[0]), toScreenY(B[1]));
                ctx.stroke();
            }
            ctx.setLineDash([]);
        }
    });

    ctx.restore();
}
