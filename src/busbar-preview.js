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
            ctx.arc(sx, sy, padRadiusScreen, 0, Math.PI * 2);
        }
        for (const edge of geom.edges) {
            const pts = [positions[edge.from], ...edge.waypoints, positions[edge.to]];
            for (let k = 1; k < pts.length - 1; k++) {
                const [wx, wy] = pts[k];
                const sx = toScreenX(wx), sy = toScreenY(wy);
                ctx.moveTo(sx + padRadiusScreen, sy);
                ctx.arc(sx, sy, padRadiusScreen, 0, Math.PI * 2);
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
        ctx.fill();

        ctx.strokeStyle = hexToRgba(busbar.color, isActive ? 1.0 : 0.85);
        ctx.lineWidth = (isActive ? 2.5 : 1.5) / zoom;
        for (const i of busbar.cellIndices) {
            if (!positions[i]) continue;
            const [x, y] = positions[i];
            const sx = toScreenX(x), sy = toScreenY(y);
            ctx.beginPath();
            ctx.arc(sx, sy, padRadiusScreen, 0, Math.PI * 2);
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
