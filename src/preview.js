import { canvasState } from './state.js';
import { showStatus } from './ui.js';

export function clearCanvas(canvasId = 'preview') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

// Copy the rendered top canvas to another canvas (for the bottom face view).
// Both canvases must have been DPI-scaled to the same pixel dimensions.
export function drawPreviewCopy(dstCanvasId) {
    const src = document.getElementById('preview');
    const dst = document.getElementById(dstCanvasId);
    if (!src || !dst) return;
    const ctx = dst.getContext('2d');
    // Use identity transform so we copy physical pixels 1:1, bypassing any
    // DPR base scale that is baked into the context.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
    ctx.restore();
}

// Copy the rendered top canvas to another canvas (for the bottom face view).
export function drawPreviewMirroredCopy(dstCanvasId) {
    const src = document.getElementById('preview');
    const dst = document.getElementById(dstCanvasId);
    if (!src || !dst) return;
    const ctx = dst.getContext('2d');
    // Use identity transform so we copy physical pixels 1:1, bypassing any
    // DPR base scale that is baked into the context.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, dst.width, dst.height);
    ctx.drawImage(src, 0, 0, dst.width, dst.height);
    ctx.restore();
}

export function drawPreview(positions, cellSize) {
    canvasState.currentPositions = positions;
    canvasState.currentCellSize = cellSize;

    const canvas = document.getElementById('preview');
    if (!canvas) {
        console.error('Canvas element not found!');
        return;
    }
    const ctx = canvas.getContext('2d');

    // Clear at identity so physical pixel dimensions are used directly.
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (positions.length === 0) return;

    ctx.save();
    ctx.translate(canvasState.panX, canvasState.panY);
    ctx.scale(canvasState.zoom, canvasState.zoom);

    const spacing = parseFloat(document.getElementById('spacing').value);
    const bmsHolesType = document.getElementById('bmsHolesType').value;
    const bmsHoles = bmsHolesType !== 'off';
    const useTabs = bmsHolesType === 'tabs';
    const useFullCircles = bmsHolesType === 'fullcircles';
    const circleHoleOffset = false;
    const layoutType = document.getElementById('layoutType').value;
    const roundedCorners = document.getElementById('roundedCorners').checked;
    const bmsHoleDiameter = parseFloat(document.getElementById('bmsHoleDiameter').value) || 4.0;
    const ledgeWidth = parseFloat(document.getElementById('ledgeWidth').value) || 0;

    const r = cellSize / 2;
    const minX = Math.min(...positions.map(p => p[0]));
    const minY = Math.min(...positions.map(p => p[1]));
    const maxX = Math.max(...positions.map(p => p[0]));
    const maxY = Math.max(...positions.map(p => p[1]));

    const packWidth = maxX - minX + cellSize + spacing * 2;
    const packHeight = maxY - minY + cellSize + spacing * 2;

    const rect = canvas.getBoundingClientRect();
    const canvasDisplayWidth = rect.width;
    const canvasDisplayHeight = rect.height;

    const padding = 80;
    const scaleX = (canvasDisplayWidth - padding * 2) / packWidth;
    const scaleY = (canvasDisplayHeight - padding * 2) / packHeight;
    const scale = Math.min(scaleX, scaleY);

    const offsetX = (canvasDisplayWidth - packWidth * scale) / 2;
    const offsetY = (canvasDisplayHeight - packHeight * scale) / 2;

    canvasState.viewTransform = { offsetX, offsetY, scale, minX, minY, spacing, r };

    const zoom = canvasState.zoom;

    if (roundedCorners) {
        const cornerRadius = 5.0 * scale;
        const x = offsetX;
        const y = offsetY;
        const width = packWidth * scale;
        const height = packHeight * scale;

        ctx.fillStyle = 'rgba(100, 149, 237, 0.15)';
        ctx.beginPath();
        ctx.moveTo(x + cornerRadius, y);
        ctx.lineTo(x + width - cornerRadius, y);
        ctx.arcTo(x + width, y, x + width, y + cornerRadius, cornerRadius);
        ctx.lineTo(x + width, y + height - cornerRadius);
        ctx.arcTo(x + width, y + height, x + width - cornerRadius, y + height, cornerRadius);
        ctx.lineTo(x + cornerRadius, y + height);
        ctx.arcTo(x, y + height, x, y + height - cornerRadius, cornerRadius);
        ctx.lineTo(x, y + cornerRadius);
        ctx.arcTo(x, y, x + cornerRadius, y, cornerRadius);
        ctx.closePath();
        ctx.fill();
    } else {
        ctx.fillStyle = 'rgba(100, 149, 237, 0.15)';
        ctx.fillRect(offsetX, offsetY, packWidth * scale, packHeight * scale);
    }

    ctx.strokeStyle = '#667eea';
    ctx.lineWidth = 2 / zoom;

    if (roundedCorners) {
        const cornerRadius = 5.0 * scale;
        const x = offsetX;
        const y = offsetY;
        const width = packWidth * scale;
        const height = packHeight * scale;

        ctx.beginPath();
        ctx.moveTo(x + cornerRadius, y);
        ctx.lineTo(x + width - cornerRadius, y);
        ctx.arcTo(x + width, y, x + width, y + cornerRadius, cornerRadius);
        ctx.lineTo(x + width, y + height - cornerRadius);
        ctx.arcTo(x + width, y + height, x + width - cornerRadius, y + height, cornerRadius);
        ctx.lineTo(x + cornerRadius, y + height);
        ctx.arcTo(x, y + height, x, y + height - cornerRadius, cornerRadius);
        ctx.lineTo(x, y + cornerRadius);
        ctx.arcTo(x, y, x + cornerRadius, y, cornerRadius);
        ctx.closePath();
        ctx.stroke();
    } else {
        ctx.strokeRect(offsetX, offsetY, packWidth * scale, packHeight * scale);
    }

    const bmsHolePositions = [];
    if (bmsHoles) {
        const packMinY = minY - r - spacing;
        const packMaxY = maxY + r + spacing;

        const rows = {};
        for (const [x, y] of positions) {
            const key = Math.round(y * 1000);
            if (!rows[key]) rows[key] = [];
            rows[key].push([x, y]);
        }

        const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
        const topYKey = rowKeys[rowKeys.length - 1];
        const bottomYKey = rowKeys[0];
        const visualTopRowKey = rowKeys[0];
        const visualBottomRowKey = rowKeys[rowKeys.length - 1];

        rows[topYKey].sort((a, b) => a[0] - b[0]);
        rows[bottomYKey].sort((a, b) => a[0] - b[0]);

        const topY = rows[topYKey][0][1];
        const bottomY = rows[bottomYKey][0][1];

        let topEdge, bottomEdge;

        if (useFullCircles) {
            const visualTopCellY = rows[visualTopRowKey][0][1];
            const visualBottomCellY = rows[visualBottomRowKey][0][1];
            const topRow = rows[visualTopRowKey];
            const botRow = rows[visualBottomRowKey];

            const solveEquilateral = (wallY, cellY, x1, x2) => {
                const xMid = (x1 + x2) / 2;
                const flip = cellY < wallY ? -1 : 1;
                let lo = -Math.PI / 2 * flip, hi = 0;
                if (flip < 0) { lo = 0; hi = Math.PI / 2; }
                for (let i = 0; i < 80; i++) {
                    const alpha = (lo + hi) / 2;
                    const Bx = x1 + r * Math.cos(alpha);
                    const By = cellY + r * Math.sin(alpha);
                    const d = xMid - Bx;
                    const h = (By - wallY) * flip;
                    const diff = h - d * Math.sqrt(3);
                    if (Math.abs(diff) < 1e-8) break;
                    if (diff < 0) { flip > 0 ? (lo = alpha) : (hi = alpha); }
                    else          { flip > 0 ? (hi = alpha) : (lo = alpha); }
                }
                const alpha = (lo + hi) / 2;
                const By = cellY + r * Math.sin(alpha);
                return (wallY + 2 * By) / 3;
            };

            if (topRow.length >= 2)
                topEdge = solveEquilateral(packMinY, visualTopCellY, topRow[0][0], topRow[1][0]);
            if (botRow.length >= 2)
                bottomEdge = solveEquilateral(packMaxY, visualBottomCellY, botRow[0][0], botRow[1][0]);
        } else if (circleHoleOffset) {
            const bmsHoleRadius = bmsHoleDiameter / 2;
            const cellRadius = cellSize / 2;
            const topRowCells = rows[topYKey];
            const bottomRowCells = rows[bottomYKey];
            const offsetDistance = bmsHoleRadius + 1.0;

            if (topRowCells.length >= 2) {
                topEdge = topY + cellRadius + offsetDistance;
            } else {
                topEdge = packMaxY;
            }

            if (bottomRowCells.length >= 2) {
                bottomEdge = bottomY - cellRadius - offsetDistance;
            } else {
                bottomEdge = packMinY;
            }
        } else {
            topEdge = packMaxY;
            bottomEdge = packMinY;
        }

        const holeTopRowKey = useFullCircles ? visualTopRowKey : topYKey;
        const holeBottomRowKey = useFullCircles ? visualBottomRowKey : bottomYKey;

        // Vertical column pitch: minimum X delta between any two cells
        const _allXSorted = [...new Set(positions.map(([x]) => Math.round(x * 1000)))]
            .sort((a, b) => a - b).map(v => v / 1000);
        const vertColPitch = _allXSorted.length >= 2 ? _allXSorted[1] - _allXSorted[0] : 0;

        const topTabRow = rows[holeTopRowKey];
        const topTabPitch = topTabRow.length >= 2 ? topTabRow[topTabRow.length - 1][0] - topTabRow[topTabRow.length - 2][0] : 0;
        for (let i = 0; i < topTabRow.length - 1; i++) {
            const x = (topTabRow[i][0] + topTabRow[i + 1][0]) / 2;
            const cellY = topTabRow[i][1];
            const x1 = topTabRow[i][0];
            const x2 = topTabRow[i + 1][0];
            const wallY = packMinY;
            const y = topEdge;
            const flip = cellY < wallY ? -1 : 1;
            let lo = flip > 0 ? -Math.PI / 2 : 0, hi = flip > 0 ? 0 : Math.PI / 2;
            for (let it = 0; it < 80; it++) {
                const alpha = (lo + hi) / 2;
                const d = x - (x1 + r * Math.cos(alpha));
                const h = (cellY + r * Math.sin(alpha) - wallY) * flip;
                const diff = h - d * Math.sqrt(3);
                if (Math.abs(diff) < 1e-8) break;
                if (diff < 0) { flip > 0 ? (lo = alpha) : (hi = alpha); } else { flip > 0 ? (hi = alpha) : (lo = alpha); }
            }
            const alphaTop = (lo + hi) / 2;
            const left  = { x: x1 + r * Math.cos(alphaTop), y: cellY + r * Math.sin(alphaTop) };
            const right = { x: x2 - r * Math.cos(alphaTop), y: cellY + r * Math.sin(alphaTop) };
            const debugTri = useFullCircles ? { apex: { x, y: wallY }, left, right } : null;
            bmsHolePositions.push({ x, y, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri });
        }
        if (layoutType === 'vertical') {
            if (!useFullCircles) {
                const topIsEven = vertColPitch === 0 || (topTabRow[0][0] - minX) < vertColPitch / 2;
                if (!topIsEven) {
                    const topExtY = topEdge;
                    // Left corner: continue interior hole pattern (tabPitch/2 = one colPitch to the left)
                    bmsHolePositions.push({ x: topTabRow[0][0] - topTabPitch / 2, y: topExtY, diameter: bmsHoleDiameter, isTab: false, isFull: false, debugTri: null });
                    // Right corner only if an even-col neighbor exists to the right
                    const topRightNeighX = topTabRow[topTabRow.length - 1][0] + vertColPitch;
                    if (_allXSorted.some(x => Math.abs(x - topRightNeighX) < 0.5)) {
                        bmsHolePositions.push({ x: topTabRow[topTabRow.length - 1][0] + topTabPitch / 2, y: topExtY, diameter: bmsHoleDiameter, isTab: false, isFull: false, debugTri: null });
                    }
                }
            } else {
                // Full circles: top-right corner when an odd col exists beyond the last even col (even S)
                const topRightNeighX = topTabRow[topTabRow.length - 1][0] + vertColPitch;
                if (_allXSorted.some(x => Math.abs(x - topRightNeighX) < 0.5)) {
                    // Continue the interior hole pattern: offset by topTabPitch/2 (= one colPitch)
                    bmsHolePositions.push({ x: topTabRow[topTabRow.length - 1][0] + topTabPitch / 2, y: topEdge, diameter: bmsHoleDiameter, isTab: false, isFull: true, debugTri: null });
                }
            }
        } else if (layoutType !== 'grid') {
            const topTabExtraRight = topTabRow.length < 2 || (topTabRow[0][0] - minX) < topTabPitch / 4;
            bmsHolePositions.push(topTabExtraRight
                ? { x: topTabRow[topTabRow.length - 1][0] + topTabPitch / 2, y: topEdge, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null }
                : { x: topTabRow[0][0] - topTabPitch / 2, y: topEdge, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null });
        }

        const botTabRow = rows[holeBottomRowKey];
        const botTabPitch = botTabRow.length >= 2 ? botTabRow[botTabRow.length - 1][0] - botTabRow[botTabRow.length - 2][0] : 0;
        for (let i = 0; i < botTabRow.length - 1; i++) {
            const x = (botTabRow[i][0] + botTabRow[i + 1][0]) / 2;
            const cellY = botTabRow[i][1];
            const x1 = botTabRow[i][0];
            const x2 = botTabRow[i + 1][0];

            const wallY = packMaxY;
            const y = bottomEdge;
            const flip = cellY < wallY ? -1 : 1;
            let lo = flip > 0 ? -Math.PI / 2 : 0, hi = flip > 0 ? 0 : Math.PI / 2;
            for (let it = 0; it < 80; it++) {
                const alpha = (lo + hi) / 2;
                const d = x - (x1 + r * Math.cos(alpha));
                const h = (cellY + r * Math.sin(alpha) - wallY) * flip;
                const diff = h - d * Math.sqrt(3);
                if (Math.abs(diff) < 1e-8) break;
                if (diff < 0) { flip > 0 ? (lo = alpha) : (hi = alpha); } else { flip > 0 ? (hi = alpha) : (lo = alpha); }
            }
            const alphaBot = (lo + hi) / 2;
            const left  = { x: x1 + r * Math.cos(alphaBot), y: cellY + r * Math.sin(alphaBot) };
            const right = { x: x2 - r * Math.cos(alphaBot), y: cellY + r * Math.sin(alphaBot) };
            const debugTri = useFullCircles ? { apex: { x, y: wallY }, left, right } : null;
            bmsHolePositions.push({ x, y, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri });
        }
        if (layoutType === 'vertical') {
            const botIsEven = vertColPitch === 0 || (botTabRow[0][0] - minX) < vertColPitch / 2;
            if (!botIsEven) {
                // Use bottomEdge for all types so corner aligns with interior bottom holes
                const botExtY = bottomEdge;
                // Left corner: continue interior hole pattern (botTabPitch/2 = one colPitch to the left)
                bmsHolePositions.push({ x: botTabRow[0][0] - botTabPitch / 2, y: botExtY, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null });
                // Right corner only if an even-col neighbor exists to the right (odd S = yes, even S = no)
                const botRightNeighX = botTabRow[botTabRow.length - 1][0] + vertColPitch;
                if (_allXSorted.some(x => Math.abs(x - botRightNeighX) < 0.5)) {
                    bmsHolePositions.push({ x: botTabRow[botTabRow.length - 1][0] + botTabPitch / 2, y: botExtY, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null });
                }
            } else if (vertColPitch > 0 && botTabRow.length >= 2) {
                // Even-col row (visual top for non-FC): add right corner when an odd col extends beyond the last even col
                const botRightNeighX = botTabRow[botTabRow.length - 1][0] + vertColPitch;
                if (_allXSorted.some(x => Math.abs(x - botRightNeighX) < 0.5)) {
                    bmsHolePositions.push({ x: botTabRow[botTabRow.length - 1][0] + botTabPitch / 2, y: bottomEdge, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null });
                }
            }
        } else if (layoutType !== 'grid') {
            const botTabExtraRight = botTabRow.length < 2 || (botTabRow[0][0] - minX) < botTabPitch / 4;
            bmsHolePositions.push(botTabExtraRight
                ? { x: botTabRow[botTabRow.length - 1][0] + botTabPitch / 2, y: bottomEdge, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null }
                : { x: botTabRow[0][0] - botTabPitch / 2, y: bottomEdge, diameter: bmsHoleDiameter, isTab: false, isFull: useFullCircles, debugTri: null });
        }
    }

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = 'rgba(102, 126, 234, 0.8)';
    ctx.lineWidth = 1.5 / zoom;

    for (const [x, y] of positions) {
        const cx = (x - minX + r + spacing) * scale + offsetX;
        const cy = (y - minY + r + spacing) * scale + offsetY;
        const radius = r * scale;

        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();

        if (ledgeWidth > 0) {
            const ledgeInnerRadius = (r - ledgeWidth) * scale;
            ctx.strokeStyle = 'rgba(255, 193, 7, 0.8)';
            ctx.setLineDash([3 / zoom, 3 / zoom]);
            ctx.lineWidth = 1 / zoom;
            ctx.beginPath();
            ctx.arc(cx, cy, ledgeInnerRadius, 0, Math.PI * 2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.strokeStyle = 'rgba(102, 126, 234, 0.8)';
            ctx.lineWidth = 1.5 / zoom;
        }
    }

    if (bmsHoles && bmsHolePositions.length > 0) {
        if (useTabs) {
            ctx.fillStyle = 'rgba(255, 193, 7, 0.5)';
            ctx.strokeStyle = 'rgba(255, 193, 7, 0.9)';
            ctx.lineWidth = 1.5 / zoom;

            const tabWidthMm = parseFloat(document.getElementById('tabWidth')?.value) || 4.0;
            const tabWidth = tabWidthMm * scale;
            const tabHeight = 1.0 * scale;

            for (const hole of bmsHolePositions) {
                const cx = (hole.x - minX + r + spacing) * scale + offsetX;

                if (hole.y < minY) {
                    ctx.fillRect(cx - tabWidth / 2, offsetY, tabWidth, tabHeight);
                    ctx.strokeRect(cx - tabWidth / 2, offsetY, tabWidth, tabHeight);
                } else {
                    ctx.fillRect(cx - tabWidth / 2, offsetY + packHeight * scale - tabHeight, tabWidth, tabHeight);
                    ctx.strokeRect(cx - tabWidth / 2, offsetY + packHeight * scale - tabHeight, tabWidth, tabHeight);
                }
            }
        } else if (useFullCircles) {
            let collisionError = null;
            for (const hole of bmsHolePositions) {
                const holeRadius = (hole.diameter / 2) * scale;
                const cx = (hole.x - minX + r + spacing) * scale + offsetX;
                const cy = (hole.y - minY + r + spacing) * scale + offsetY;
                for (const [cellX, cellY] of positions) {
                    const ccx = (cellX - minX + r + spacing) * scale + offsetX;
                    const ccy = (cellY - minY + r + spacing) * scale + offsetY;
                    const dist = Math.sqrt((cx - ccx) ** 2 + (cy - ccy) ** 2);
                    if (dist < holeRadius + r * scale) {
                        const maxDiam = ((dist / scale) - r) * 2;
                        collisionError = `BMS hole too large, overlaps cell! Max diameter: ${maxDiam.toFixed(1)}mm`;
                        break;
                    }
                }
                if (collisionError) break;
            }

            if (collisionError) {
                ctx.restore();
                canvasState.currentPositions = [];
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.fillStyle = '#1e293b';
                ctx.fillRect(0, 0, canvas.width, canvas.height);
                showStatus(collisionError, 'error');
                return;
            }

            for (const hole of bmsHolePositions) {
                const cx = (hole.x - minX + r + spacing) * scale + offsetX;
                const cy = (hole.y - minY + r + spacing) * scale + offsetY;
                const holeRadius = (hole.diameter / 2) * scale;

                ctx.save();
                ctx.globalCompositeOperation = 'destination-out';
                ctx.fillStyle = 'black';
                ctx.beginPath();
                ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2);
                ctx.fill();
                ctx.globalCompositeOperation = 'source-over';
                ctx.restore();

                ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
                ctx.lineWidth = 1.5 / zoom;
                ctx.beginPath();
                ctx.arc(cx, cy, holeRadius, 0, Math.PI * 2);
                ctx.stroke();
            }
        } else {
            ctx.save();
            ctx.globalCompositeOperation = 'destination-out';

            for (const hole of bmsHolePositions) {
                const cx = (hole.x - minX + r + spacing) * scale + offsetX;
                const holeRadius = (hole.diameter / 2) * scale;

                ctx.fillStyle = 'black';
                ctx.beginPath();
                if (hole.y > maxY) {
                    const extension = 3 / zoom;
                    ctx.arc(cx, offsetY + packHeight * scale, holeRadius, Math.PI, 0, false);
                    ctx.lineTo(cx + holeRadius, offsetY + packHeight * scale + extension);
                    ctx.lineTo(cx - holeRadius, offsetY + packHeight * scale + extension);
                } else {
                    const extension = 3 / zoom;
                    ctx.arc(cx, offsetY, holeRadius, 0, Math.PI, false);
                    ctx.lineTo(cx - holeRadius, offsetY - extension);
                    ctx.lineTo(cx + holeRadius, offsetY - extension);
                }
                ctx.closePath();
                ctx.fill();
            }

            ctx.globalCompositeOperation = 'source-over';

            for (const hole of bmsHolePositions) {
                const cx = (hole.x - minX + r + spacing) * scale + offsetX;
                const holeRadius = (hole.diameter / 2) * scale;

                ctx.strokeStyle = 'rgba(16, 185, 129, 0.9)';
                ctx.lineWidth = 1.5 / zoom;

                ctx.beginPath();
                if (hole.y > maxY) {
                    ctx.arc(cx, offsetY + packHeight * scale, holeRadius, Math.PI, 0, false);
                } else {
                    ctx.arc(cx, offsetY, holeRadius, 0, Math.PI, false);
                }
                ctx.stroke();
            }

            ctx.restore();
        }
    }

    ctx.strokeStyle = '#94a3b8';
    ctx.fillStyle = '#94a3b8';
    ctx.lineWidth = 1 / zoom;
    ctx.font = `${12 / zoom}px Arial`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    const dimOffset = 15 / zoom;
    const arrowSize = 5 / zoom;

    const widthY = offsetY + packHeight * scale + dimOffset;

    ctx.setLineDash([2 / zoom, 2 / zoom]);
    ctx.beginPath();
    ctx.moveTo(offsetX, offsetY + packHeight * scale);
    ctx.lineTo(offsetX, widthY + dimOffset / 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offsetX + packWidth * scale, offsetY + packHeight * scale);
    ctx.lineTo(offsetX + packWidth * scale, widthY + dimOffset / 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(offsetX, widthY);
    ctx.lineTo(offsetX + packWidth * scale, widthY);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(offsetX, widthY);
    ctx.lineTo(offsetX + arrowSize, widthY - arrowSize / 2);
    ctx.lineTo(offsetX + arrowSize, widthY + arrowSize / 2);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(offsetX + packWidth * scale, widthY);
    ctx.lineTo(offsetX + packWidth * scale - arrowSize, widthY - arrowSize / 2);
    ctx.lineTo(offsetX + packWidth * scale - arrowSize, widthY + arrowSize / 2);
    ctx.closePath();
    ctx.fill();

    ctx.fillText(`${packWidth.toFixed(1)}mm`, offsetX + packWidth * scale / 2, widthY + dimOffset);

    const heightX = offsetX + packWidth * scale + dimOffset;

    ctx.setLineDash([2 / zoom, 2 / zoom]);
    ctx.beginPath();
    ctx.moveTo(offsetX + packWidth * scale, offsetY);
    ctx.lineTo(heightX + dimOffset / 2, offsetY);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(offsetX + packWidth * scale, offsetY + packHeight * scale);
    ctx.lineTo(heightX + dimOffset / 2, offsetY + packHeight * scale);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.moveTo(heightX, offsetY);
    ctx.lineTo(heightX, offsetY + packHeight * scale);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(heightX, offsetY);
    ctx.lineTo(heightX - arrowSize / 2, offsetY + arrowSize);
    ctx.lineTo(heightX + arrowSize / 2, offsetY + arrowSize);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(heightX, offsetY + packHeight * scale);
    ctx.lineTo(heightX - arrowSize / 2, offsetY + packHeight * scale - arrowSize);
    ctx.lineTo(heightX + arrowSize / 2, offsetY + packHeight * scale - arrowSize);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.translate(heightX + dimOffset, offsetY + packHeight * scale / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(`${packHeight.toFixed(1)}mm`, 0, 0);
    ctx.restore();

    ctx.restore();
}
