import { canvasState } from './state.js';
import { showStatus, showLoading } from './ui.js';
import { ocRef, initOC } from './oc.js';
import {
    generateGridLayout,
    generateHoneycombLayout,
    generateVerticalHoneycombLayout,
    getCachedPositions,
} from './layouts.js';
import { drawPreview, clearCanvas } from './preview.js';
import { create3DModel } from './model.js';
import { downloadSTEP } from './step-export.js';
import { busbarStore } from './busbars.js';
import { computeBusbarGeometry } from './busbar-geometry.js';
import { drawBusbarsOverlay } from './busbar-preview.js';
import { build3DBusbar } from './busbar-model.js';
import { renderBusbarList } from './busbar-ui.js';

let lastComputedGeometries = [];
let lastBusbarDrawArgs = null;
export function getLastBusbarGeometries() {
    return lastComputedGeometries;
}

export function redrawBusbarOverlay() {
    if (!lastBusbarDrawArgs) return;
    const { positions, cellSize, padRadius, spacing } = lastBusbarDrawArgs;
    drawBusbarsOverlay(busbarStore.list, lastComputedGeometries, positions, cellSize, padRadius, spacing, busbarStore.activeId);
}

export function updatePreview(resetView = false) {
    if (resetView) {
        canvasState.zoom = 1.0;
        canvasState.panX = 0;
        canvasState.panY = 0;
    }

    const stats = document.getElementById('previewStats');
    const setStats = (text, color) => {
        stats.textContent = text;
        stats.style.color = color;
    };

    try {
        const xDim = parseFloat(document.getElementById('xDim').value);
        const yDim = parseFloat(document.getElementById('yDim').value);
        const spacing = parseFloat(document.getElementById('spacing').value);
        const cellSize = parseFloat(document.getElementById('cellSize').value);
        const layoutType = document.getElementById('layoutType').value;

        const ledgeWidth = parseFloat(document.getElementById('ledgeWidth').value) || 0;
        const bmsHoleDiameter = parseFloat(document.getElementById('bmsHoleDiameter').value) || 4.0;
        const coverThickness = parseFloat(document.getElementById('coverThickness').value);

        if (!xDim || !yDim || !spacing || !cellSize) {
            setStats('Configure settings to see preview', '#94a3b8');
            return;
        }

        if (ledgeWidth > 0 && ledgeWidth >= cellSize) {
            setStats(`Ledge width (${ledgeWidth}mm) must be less than cell diameter (${cellSize}mm)!`, '#ef4444');
            clearCanvas();
            return;
        }

        const minPackSize = cellSize + spacing * 2;
        if (xDim < minPackSize || yDim < minPackSize) {
            setStats(`Pack too small! Minimum: ${minPackSize.toFixed(1)}×${minPackSize.toFixed(1)} mm`, '#ef4444');
            clearCanvas();
            return;
        }

        if (cellSize > xDim || cellSize > yDim) {
            setStats(`Cell diameter (${cellSize}mm) larger than pack dimensions!`, '#ef4444');
            clearCanvas();
            return;
        }

        if (spacing < 0) {
            setStats(`Cell spacing cannot be negative!`, '#ef4444');
            clearCanvas();
            return;
        }

        const positions = getCachedPositions(xDim, yDim, spacing, cellSize, layoutType);

        if (!positions || positions.length === 0) {
            setStats(`No cells fit! Increase pack size or decrease cell size/spacing`, '#ef4444');
            clearCanvas();
            return;
        }

        const bmsHolesType = document.getElementById('bmsHolesType').value;
        const bmsHoles = bmsHolesType !== 'off';
        if (bmsHoles) {
            if (bmsHoleDiameter > cellSize) {
                setStats(`BMS hole (${bmsHoleDiameter}mm) larger than cell (${cellSize}mm)! Reduce hole size.`, '#ef4444');
                clearCanvas();
                return;
            }

            const cellRadius = cellSize / 2;
            const bmsHoleRadius = bmsHoleDiameter / 2;
            const r = cellRadius;

            const minY = Math.min(...positions.map(p => p[1]));
            const maxY = Math.max(...positions.map(p => p[1]));
            const packMaxY = maxY + r + spacing;
            const packMinY = minY - r - spacing;

            const rows = {};
            for (const [x, y] of positions) {
                const key = Math.round(y * 1000);
                if (!rows[key]) rows[key] = [];
                rows[key].push([x, y]);
            }

            const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
            const topYKey = rowKeys[rowKeys.length - 1];
            const bottomYKey = rowKeys[0];

            rows[topYKey].sort((a, b) => a[0] - b[0]);
            rows[bottomYKey].sort((a, b) => a[0] - b[0]);

            const topEdge = packMaxY;
            const bottomEdge = packMinY;

            for (let i = 0; i < rows[topYKey].length - 1; i++) {
                const bmsX = (rows[topYKey][i][0] + rows[topYKey][i + 1][0]) / 2;
                const bmsY = topEdge;

                for (const [cellX, cellY] of positions) {
                    const distance = Math.hypot(bmsX - cellX, bmsY - cellY);
                    const minDistance = bmsHoleRadius + cellRadius;

                    if (distance < minDistance) {
                        const maxDiameter = (distance - cellRadius) * 2;
                        setStats(`BMS hole overlaps cells! Max diameter: ${maxDiameter.toFixed(1)}mm`, '#ef4444');
                        canvasState.currentPositions = [];
                        clearCanvas();
                        return;
                    }
                }
            }

            for (let i = 0; i < rows[bottomYKey].length - 1; i++) {
                const bmsX = (rows[bottomYKey][i][0] + rows[bottomYKey][i + 1][0]) / 2;
                const bmsY = bottomEdge;

                for (const [cellX, cellY] of positions) {
                    const distance = Math.hypot(bmsX - cellX, bmsY - cellY);
                    const minDistance = bmsHoleRadius + cellRadius;

                    if (distance < minDistance) {
                        setStats(`BMS hole overlaps cells! Reduce hole diameter.`, '#ef4444');
                        canvasState.currentPositions = [];
                        clearCanvas();
                        return;
                    }
                }
            }
        }

        if (coverThickness > cellSize / 2) {
            setStats(`Cover thickness (${coverThickness}mm) very large for cell size (${cellSize}mm)`, '#f59e0b');
        }

        if (spacing < 0.5 && spacing > 0) {
            setStats(`Spacing < 0.5mm may be difficult to 3D print`, '#f59e0b');
        }

        if (positions.length < 2) {
            setStats(`Only ${positions.length} cell fits. Increase pack size for practical holder.`, '#f59e0b');
        } else {
            stats.style.color = '#10b981';
        }

        drawPreview(positions, cellSize);

        const cellRadius = cellSize / 2;
        const busbarPadRadius = Math.max(cellRadius - ledgeWidth, 1.0);
        const busbarKeepoutRadius = 4.0;
        lastComputedGeometries = busbarStore.list.map(bb =>
            computeBusbarGeometry(bb.cellIndices, positions, cellRadius, busbarPadRadius, spacing, busbarKeepoutRadius)
        );
        lastBusbarDrawArgs = { positions, cellSize, padRadius: busbarPadRadius, spacing };
        drawBusbarsOverlay(busbarStore.list, lastComputedGeometries, positions, cellSize, busbarPadRadius, spacing, busbarStore.activeId);

        const blockedByBusbarId = {};
        busbarStore.list.forEach((bb, i) => {
            const g = lastComputedGeometries[i];
            if (g && g.blocked) blockedByBusbarId[bb.id] = g.blocked.reason;
        });
        renderBusbarList(blockedByBusbarId);

        const minX = Math.min(...positions.map(p => p[0]));
        const minY = Math.min(...positions.map(p => p[1]));
        const maxX = Math.max(...positions.map(p => p[0]));
        const maxY = Math.max(...positions.map(p => p[1]));

        const actualWidth = maxX - minX + cellSize + spacing * 2;
        const actualHeight = maxY - minY + cellSize + spacing * 2;

        if (positions.length >= 2) {
            stats.textContent = `${positions.length} cells • ${actualWidth.toFixed(0)}×${actualHeight.toFixed(0)} mm`;
        }
    } catch (error) {
        console.error('Preview error:', error);
        setStats('Error: ' + error.message, '#ef4444');
    }
}

export async function generateLayout() {
    const layoutType = document.getElementById('layoutType').value;

    if (!ocRef.initialized) {
        showStatus('3D engine not ready. Please wait...', 'error');
        await initOC();
        if (!ocRef.initialized) return;
    }

    showLoading(true, 'Generating 3D Model', 'Please be patient...');
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        const xDim = parseFloat(document.getElementById('xDim').value);
        const yDim = parseFloat(document.getElementById('yDim').value);
        const spacing = parseFloat(document.getElementById('spacing').value);
        const cellSize = parseFloat(document.getElementById('cellSize').value);
        const ledgeWidth = parseFloat(document.getElementById('ledgeWidth').value) || 0;
        const bmsHoleDiameter = parseFloat(document.getElementById('bmsHoleDiameter').value) || 4.0;
        const coverThickness = parseFloat(document.getElementById('coverThickness').value);
        const cellRadius = cellSize / 2;
        const bmsHoleRadius = bmsHoleDiameter / 2;

        if (ledgeWidth > 0 && ledgeWidth >= cellSize) {
            showStatus(`Ledge width (${ledgeWidth}mm) must be less than cell diameter (${cellSize}mm)!`, 'error');
            showLoading(false);
            return;
        }

        const minPackSize = cellSize + spacing * 2;
        if (xDim < minPackSize || yDim < minPackSize) {
            showStatus(`Pack too small! Minimum size: ${minPackSize.toFixed(1)}×${minPackSize.toFixed(1)} mm`, 'error');
            showLoading(false);
            return;
        }

        if (cellSize > xDim || cellSize > yDim) {
            showStatus('Cell diameter is larger than pack dimensions!', 'error');
            showLoading(false);
            return;
        }

        if (spacing < 0) {
            showStatus('Cell spacing cannot be negative!', 'error');
            showLoading(false);
            return;
        }

        const height = parseFloat(document.getElementById('height').value);

        const terminalDiameter = 8.0;
        const terminalDepth = 1.0;

        const roundedCorners = document.getElementById('roundedCorners').checked;
        const bmsHolesType = document.getElementById('bmsHolesType').value;
        const bmsHoles = bmsHolesType !== 'off';
        const useTabs = bmsHolesType === 'tabs';
        const useFullCircles = bmsHolesType === 'fullcircles';
        const filletBms = false;
        const circleHoleOffset = false;

        let positions;
        let layoutName;

        switch (layoutType) {
            case 'grid':
                positions = generateGridLayout(xDim, yDim, spacing, cellSize);
                layoutName = 'Grid Layout';
                break;
            case 'honeycomb':
                positions = generateHoneycombLayout(xDim, yDim, spacing, cellSize);
                layoutName = 'Honeycomb Layout';
                break;
            case 'vertical':
                positions = generateVerticalHoneycombLayout(xDim, yDim, spacing, cellSize);
                layoutName = 'Vertical Honeycomb';
                break;
            default:
                showStatus('Invalid layout type', 'error');
                return;
        }

        if (bmsHoles && useFullCircles) {
            const solveEquilateralY = (wallY, cellY, x1, x2) => {
                const xMid = (x1 + x2) / 2;
                const flip = cellY < wallY ? -1 : 1;
                let lo = flip > 0 ? -Math.PI / 2 : 0, hi = flip > 0 ? 0 : Math.PI / 2;
                for (let i = 0; i < 80; i++) {
                    const alpha = (lo + hi) / 2;
                    const d = xMid - (x1 + cellRadius * Math.cos(alpha));
                    const h = (cellY + cellRadius * Math.sin(alpha) - wallY) * flip;
                    const diff = h - d * Math.sqrt(3);
                    if (Math.abs(diff) < 1e-8) break;
                    if (diff < 0) { flip > 0 ? (lo = alpha) : (hi = alpha); } else { flip > 0 ? (hi = alpha) : (lo = alpha); }
                }
                const alpha = (lo + hi) / 2;
                const By = cellY + cellRadius * Math.sin(alpha);
                return (wallY + 2 * By) / 3;
            };

            const minY = Math.min(...positions.map(p => p[1]));
            const maxY = Math.max(...positions.map(p => p[1]));
            const packMinY = minY - cellRadius - spacing;
            const packMaxY = maxY + cellRadius + spacing;

            const rows = {};
            for (const [x, y] of positions) {
                const key = Math.round(y * 1000);
                if (!rows[key]) rows[key] = [];
                rows[key].push([x, y]);
            }
            const rowKeys = Object.keys(rows).map(Number).sort((a, b) => a - b);
            const visualTopKey = rowKeys[0];
            const visualBotKey = rowKeys[rowKeys.length - 1];
            rows[visualTopKey].sort((a, b) => a[0] - b[0]);
            rows[visualBotKey].sort((a, b) => a[0] - b[0]);

            const holePositions = [];
            for (let i = 0; i < rows[visualTopKey].length - 1; i++) {
                const x1 = rows[visualTopKey][i][0], x2 = rows[visualTopKey][i + 1][0];
                const adjY = rows[visualTopKey][i][1];
                holePositions.push({ hx: (x1 + x2) / 2, hy: solveEquilateralY(packMinY, adjY, x1, x2) });
            }
            for (let i = 0; i < rows[visualBotKey].length - 1; i++) {
                const x1 = rows[visualBotKey][i][0], x2 = rows[visualBotKey][i + 1][0];
                const adjY = rows[visualBotKey][i][1];
                holePositions.push({ hx: (x1 + x2) / 2, hy: solveEquilateralY(packMaxY, adjY, x1, x2) });
            }

            for (const { hx, hy } of holePositions) {
                let minDist = Infinity;
                for (const [cx, cy] of positions) {
                    const dist = Math.hypot(hx - cx, hy - cy);
                    if (dist < minDist) minDist = dist;
                }
                if (minDist < bmsHoleRadius + cellRadius) {
                    const maxAllowed = (minDist - cellRadius) * 2;
                    showStatus(`BMS hole too large, overlaps cell! Max diameter: ${maxAllowed.toFixed(2)}mm`, 'error');
                    showLoading(false);
                    return;
                }
            }
        } else if (bmsHoles) {
            const minY = Math.min(...positions.map(p => p[1]));
            const maxY = Math.max(...positions.map(p => p[1]));
            const r = cellSize / 2;

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

            rows[topYKey].sort((a, b) => a[0] - b[0]);
            rows[bottomYKey].sort((a, b) => a[0] - b[0]);

            const topY = rows[topYKey][0][1];
            const bottomY = rows[bottomYKey][0][1];

            let topEdge, bottomEdge;
            if (circleHoleOffset) {
                const offsetDistance = bmsHoleRadius + 1.0;
                topEdge = topY + cellRadius + offsetDistance;
                bottomEdge = bottomY - cellRadius - offsetDistance;
            } else {
                topEdge = packMaxY;
                bottomEdge = packMinY;
            }

            for (let i = 0; i < rows[topYKey].length - 1; i++) {
                const bmsX = (rows[topYKey][i][0] + rows[topYKey][i + 1][0]) / 2;
                const bmsY = topEdge;
                const adjacentCell1 = [rows[topYKey][i][0], rows[topYKey][i][1]];
                const adjacentCell2 = [rows[topYKey][i + 1][0], rows[topYKey][i + 1][1]];

                for (const [cellX, cellY] of positions) {
                    if ((cellX === adjacentCell1[0] && cellY === adjacentCell1[1]) ||
                        (cellX === adjacentCell2[0] && cellY === adjacentCell2[1])) continue;

                    const distance = Math.hypot(bmsX - cellX, bmsY - cellY);
                    if (distance < bmsHoleRadius + cellRadius + ledgeWidth) {
                        showStatus(`BMS hole (${bmsHoleDiameter}mm) collides with cell ledges! Reduce BMS hole size or increase spacing.`, 'error');
                        showLoading(false);
                        return;
                    }
                }
            }

            for (let i = 0; i < rows[bottomYKey].length - 1; i++) {
                const bmsX = (rows[bottomYKey][i][0] + rows[bottomYKey][i + 1][0]) / 2;
                const bmsY = bottomEdge;
                const adjacentCell1 = [rows[bottomYKey][i][0], rows[bottomYKey][i][1]];
                const adjacentCell2 = [rows[bottomYKey][i + 1][0], rows[bottomYKey][i + 1][1]];

                for (const [cellX, cellY] of positions) {
                    if ((cellX === adjacentCell1[0] && cellY === adjacentCell1[1]) ||
                        (cellX === adjacentCell2[0] && cellY === adjacentCell2[1])) continue;

                    const distance = Math.hypot(bmsX - cellX, bmsY - cellY);
                    if (distance < bmsHoleRadius + cellRadius + ledgeWidth) {
                        showStatus(`BMS hole (${bmsHoleDiameter}mm) collides with cell ledges! Reduce BMS hole size or increase spacing.`, 'error');
                        showLoading(false);
                        return;
                    }
                }
            }
        }

        const tabWidth = parseFloat(document.getElementById('tabWidth').value) || 4.0;
        const tabDepth = parseFloat(document.getElementById('tabDepth').value) || 1.0;

        const config = {
            cellSize, spacing, height, terminalDiameter, terminalDepth,
            coverThickness, roundedCorners, bmsHoles, ledgeWidth,
            filletBms, circleHoleOffset, useTabs, useFullCircles, bmsHoleDiameter,
            tabWidth, tabDepth,
        };

        const holderShape = create3DModel(positions, config);

        if (!holderShape) {
            showStatus('Failed to create 3D model', 'error');
            return;
        }

        const busbarPadRadius = Math.max(cellRadius - ledgeWidth, 1.0);
        const busbarKeepoutRadius = terminalDiameter / 2;
        const busbarGeometries = busbarStore.list.map(bb =>
            computeBusbarGeometry(bb.cellIndices, positions, cellRadius, busbarPadRadius, spacing, busbarKeepoutRadius)
        );

        for (let i = 0; i < busbarStore.list.length; i++) {
            const bb = busbarStore.list[i];
            const geom = busbarGeometries[i];
            if (geom.blocked) {
                showStatus(`${bb.name}: ${geom.blocked.reason} — cannot export`, 'error');
                showLoading(false);
                return;
            }
        }

        const holderCenterX = (Math.min(...positions.map(p => p[0])) + Math.max(...positions.map(p => p[0]))) / 2;
        const holderCenterY = (Math.min(...positions.map(p => p[1])) + Math.max(...positions.map(p => p[1]))) / 2;
        const centeredPositions = positions.map(([x, y]) => [x - holderCenterX, y - holderCenterY]);

        const busbarShapes = [];
        for (let i = 0; i < busbarStore.list.length; i++) {
            const bb = busbarStore.list[i];
            if (bb.cellIndices.length === 0) continue;
            const shape = build3DBusbar(busbarGeometries[i], centeredPositions, busbarPadRadius, height, bb.thickness);
            if (shape) busbarShapes.push(shape);
        }

        const oc = ocRef.instance;
        let exportShape = holderShape;
        if (busbarShapes.length > 0) {
            const compound = new oc.TopoDS_Compound();
            const builder = new oc.BRep_Builder();
            builder.MakeCompound(compound);
            builder.Add(compound, holderShape);
            for (const s of busbarShapes) builder.Add(compound, s);
            exportShape = compound;
        }

        const filename = `${layoutType}_layout.step`;
        downloadSTEP(exportShape, filename);

        const holeType = useTabs ? 'edge tabs' :
            (circleHoleOffset ? 'circle offset' : 'semicircle offset');
        const filletMsg = (filletBms && !useTabs) ? ' with filleted holes' : '';
        const busbarMsg = busbarShapes.length > 0 ? ` + ${busbarShapes.length} busbar${busbarShapes.length === 1 ? '' : 's'}` : '';

        showStatus(
            `${layoutName} generated with ${positions.length} cells (${holeType}${filletMsg})${busbarMsg}`,
            'success'
        );
    } catch (error) {
        console.error('Generation error:', error);
        showStatus('Error: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}
