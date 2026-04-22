import { canvasState } from './state.js';

function hexToRgba(hex, a) {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `rgba(${r},${g},${b},${a})`;
}

function addCapsuleSubpath(ctx, x1, y1, x2, y2, r) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return;
    const angle = Math.atan2(dy, dx);
    ctx.save();
    ctx.translate(x1, y1);
    ctx.rotate(angle);
    ctx.rect(0, -r, len, 2 * r);
    ctx.restore();
}

// Tangent-arc fillet on the concave side of the CCW sector between u1 and u2.
function addConcaveFillet(ctx, vx, vy, u1, u2, padR) {
    const p1x = -u1[1], p1y = u1[0];
    const p2x =  u2[1], p2y = -u2[0];

    const A1x = vx + padR * p1x, A1y = vy + padR * p1y;
    const A2x = vx + padR * p2x, A2y = vy + padR * p2y;
    const det = u1[0] * (-u2[1]) - (-u2[0]) * u1[1];
    if (Math.abs(det) < 1e-9) return;
    const dx = A2x - A1x, dy = A2y - A1y;
    const t = ((-u2[1]) * dx - (-u2[0]) * dy) / det;
    const Vnx = A1x + t * u1[0];
    const Vny = A1y + t * u1[1];

    const bsx = p1x + p2x, bsy = p1y + p2y;
    const blen = Math.hypot(bsx, bsy);
    if (blen < 1e-6) return;
    const bx = bsx / blen, by = bsy / blen;
    const sinHalf = blen / 2;

    const r = padR;
    const dist = r / sinHalf;
    const cx = Vnx + dist * bx;
    const cy = Vny + dist * by;

    const T1x = cx - r * p1x, T1y = cy - r * p1y;
    const T2x = cx - r * p2x, T2y = cy - r * p2y;

    const angleT1 = Math.atan2(T1y - cy, T1x - cx);
    const angleT2 = Math.atan2(T2y - cy, T2x - cx);
    ctx.moveTo(Vnx, Vny);
    ctx.lineTo(T1x, T1y);
    ctx.arc(cx, cy, r, angleT1, angleT2, true);
    ctx.lineTo(Vnx, Vny);
}

export function drawBusbarsOverlay(busbars, geometries, positions, cellSize, padRadius, spacing, activeId) {
    const canvas = document.getElementById('preview');
    if (!canvas) return;
    const t = canvasState.viewTransform;
    if (!t || busbars.length === 0) return;

    const ctx = canvas.getContext('2d');
    const cellR = cellSize / 2;
    const toScreenX = (wx) => (wx - t.minX + cellR + spacing) * t.scale + t.offsetX;
    const toScreenY = (wy) => (wy - t.minY + cellR + spacing) * t.scale + t.offsetY;
    const padRadiusScreen = padRadius * t.scale;

    ctx.save();
    ctx.translate(canvasState.panX, canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);

    const zoom = canvasState.zoom;
    const TWO_PI = 2 * Math.PI;

    busbars.forEach((busbar, idx) => {
        const geom = geometries[idx];
        if (!geom || busbar.cellIndices.length === 0) return;
        const isActive = busbar.id === activeId;
        const fillAlpha = isActive ? 0.45 : 0.3;

        ctx.fillStyle = hexToRgba(busbar.color, fillAlpha);
        ctx.beginPath();

        for (const i of busbar.cellIndices) {
            if (!positions[i]) continue;
            const [x, y] = positions[i];
            const sx = toScreenX(x), sy = toScreenY(y);
            ctx.moveTo(sx + padRadiusScreen, sy);
            ctx.arc(sx, sy, padRadiusScreen, 0, TWO_PI);
        }

        for (const edge of geom.edges) {
            const pts = [positions[edge.from], ...edge.waypoints, positions[edge.to]];
            for (let k = 1; k < pts.length - 1; k++) {
                const [wx, wy] = pts[k];
                const sx = toScreenX(wx), sy = toScreenY(wy);
                ctx.moveTo(sx + padRadiusScreen, sy);
                ctx.arc(sx, sy, padRadiusScreen, 0, TWO_PI);
            }
            for (let k = 0; k < pts.length - 1; k++) {
                addCapsuleSubpath(
                    ctx,
                    toScreenX(pts[k][0]), toScreenY(pts[k][1]),
                    toScreenX(pts[k + 1][0]), toScreenY(pts[k + 1][1]),
                    padRadiusScreen
                );
            }
        }

        const vertMap = new Map();
        const vkey = (sx, sy) => `${Math.round(sx * 100)},${Math.round(sy * 100)}`;
        const addDir = (sx, sy, dx, dy) => {
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) return;
            const k = vkey(sx, sy);
            if (!vertMap.has(k)) vertMap.set(k, { x: sx, y: sy, dirs: [] });
            vertMap.get(k).dirs.push([dx / len, dy / len]);
        };

        for (const edge of geom.edges) {
            const pts = [positions[edge.from], ...edge.waypoints, positions[edge.to]];
            for (let k = 0; k < pts.length - 1; k++) {
                const ax = toScreenX(pts[k][0]), ay = toScreenY(pts[k][1]);
                const bx = toScreenX(pts[k + 1][0]), by = toScreenY(pts[k + 1][1]);
                addDir(ax, ay, bx - ax, by - ay);
                addDir(bx, by, ax - bx, ay - by);
            }
        }

        for (const v of vertMap.values()) {
            if (v.dirs.length < 2) continue;
            const sorted = v.dirs.slice().sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]));
            for (let i = 0; i < sorted.length; i++) {
                const u1 = sorted[i];
                const u2 = sorted[(i + 1) % sorted.length];
                const a1 = Math.atan2(u1[1], u1[0]);
                const a2 = Math.atan2(u2[1], u2[0]);
                let gap = a2 - a1;
                if (gap <= 0) gap += TWO_PI;
                if (gap > 0 && gap < Math.PI - 1e-3) {
                    addConcaveFillet(ctx, v.x, v.y, u1, u2, padRadiusScreen);
                }
            }
        }

        ctx.fill();

        ctx.strokeStyle = hexToRgba(busbar.color, isActive ? 1.0 : 0.85);
        ctx.lineWidth = (isActive ? 2.5 : 1.5) / zoom;
        for (const i of busbar.cellIndices) {
            if (!positions[i]) continue;
            const [x, y] = positions[i];
            const sx = toScreenX(x), sy = toScreenY(y);
            ctx.beginPath();
            ctx.arc(sx, sy, padRadiusScreen, 0, TWO_PI);
            ctx.stroke();
        }

        if (geom.blocked) {
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
