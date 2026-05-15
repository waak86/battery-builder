import { canvasState } from './state.js';
import { showStatus, showLoading } from './ui.js';
import { ocRef, initOC } from './oc.js';
import {
    generateGridLayout,
    generateHoneycombLayout,
    generateVerticalHoneycombLayout,
    getCachedPositions,
} from './layouts.js';
import { drawPreview, clearCanvas, drawPreviewCopy, drawPreviewMirroredCopy } from './preview.js';
import { create3DModel } from './model.js';
import { downloadSTEP, buildSTEPBytes } from './step-export.js';
import { buildBusbarDXF, downloadDXF } from './dxf-export.js';
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

let _orderUpdateCallback = null;
export function setOrderUpdateCallback(fn) {
    _orderUpdateCallback = fn;
}

let lastPreviewState = null;

export function refreshOrderFromLastState() {
    if (!_orderUpdateCallback || !lastPreviewState) return;
    const { positions, cellSize, spacing, seriesCount } = lastPreviewState;
    const cellRadius = cellSize / 2;
    const busbarsNeeded = seriesCount + 1;

    const busbarSheets = busbarStore.list.map(bb => {
        if (!bb.cellIndices || bb.cellIndices.length === 0) {
            return { name: bb.name, w: 0, h: 0, empty: true };
        }
        const pts = bb.cellIndices.map(i => positions[i]).filter(Boolean);
        if (pts.length === 0) return { name: bb.name, w: 0, h: 0, empty: true };
        const minX = Math.min(...pts.map(p => p[0])) - cellRadius - spacing;
        const maxX = Math.max(...pts.map(p => p[0])) + cellRadius + spacing;
        const minY = Math.min(...pts.map(p => p[1])) - cellRadius - spacing;
        const maxY = Math.max(...pts.map(p => p[1])) + cellRadius + spacing;
        return { name: bb.name, w: maxX - minX, h: maxY - minY, empty: false };
    });

    _orderUpdateCallback({ busbarSheets, busbarsNeeded });
}

function getEdgeTabCenters(positions, cellRadius, spacing, layoutType) {
    if (!Array.isArray(positions) || positions.length < 2) {
        return { top: [], bottom: [] };
    }

    const rows = new Map();
    for (const [x, y] of positions) {
        const key = y.toFixed(4);
        if (!rows.has(key)) rows.set(key, []);
        rows.get(key).push([x, y]);
    }

    const rowKeys = Array.from(rows.keys()).sort((a, b) => Number(a) - Number(b));
    if (rowKeys.length === 0) return { top: [], bottom: [] };

    const topRow = (rows.get(rowKeys[0]) || []).slice().sort((a, b) => a[0] - b[0]);
    const bottomRow = (rows.get(rowKeys[rowKeys.length - 1]) || []).slice().sort((a, b) => a[0] - b[0]);
    const topY = Math.min(...positions.map(([, y]) => y)) - cellRadius - spacing;
    const bottomY = Math.max(...positions.map(([, y]) => y)) + cellRadius + spacing;
    const minAllX = Math.min(...positions.map(([x]) => x));

    const topMidpoints = topRow.slice(0, -1).map((cell, index) => ({
        key: `top_${index}`,
        x: (cell[0] + topRow[index + 1][0]) / 2,
        y: topY,
    }));
    const bottomMidpoints = bottomRow.slice(0, -1).map((cell, index) => ({
        key: `bottom_${index}`,
        x: (cell[0] + bottomRow[index + 1][0]) / 2,
        y: bottomY,
    }));

    // Grid: no extra tab on either edge
    if (layoutType === 'grid') {
        return { top: topMidpoints, bottom: bottomMidpoints };
    }

    // Vertical honeycomb: column pitch = min X delta between any two cells
    if (layoutType === 'vertical') {
        const allXSorted = [...new Set(positions.map(([x]) => Math.round(x * 1000)))]
            .sort((a, b) => a - b).map(v => v / 1000);
        const colPitch = allXSorted.length >= 2 ? allXSorted[1] - allXSorted[0] : 0;
        // Even-column rows start at minAllX; odd-column rows are offset by colPitch
        const topIsEven = colPitch === 0 || (topRow[0][0] - minAllX) < colPitch / 2;
        const bottomIsEven = colPitch === 0 || (bottomRow[0][0] - minAllX) < colPitch / 2;
        return {
            top: topIsEven
                ? topMidpoints
                : [{ key: 'top_extra_left', x: topRow[0][0] - colPitch / 2, y: topY },
                   ...topMidpoints,
                   { key: 'top_extra_right', x: topRow[topRow.length - 1][0] + colPitch / 2, y: topY }],
            bottom: bottomIsEven
                ? bottomMidpoints
                : [{ key: 'bottom_extra_left', x: bottomRow[0][0] - colPitch / 2, y: bottomY },
                   ...bottomMidpoints,
                   { key: 'bottom_extra_right', x: bottomRow[bottomRow.length - 1][0] + colPitch / 2, y: bottomY }],
        };
    }

    // Horizontal honeycomb: 1 extra tab on the side that has a gap to the wall
    const topPitch = topRow.length >= 2 ? topRow[topRow.length - 1][0] - topRow[topRow.length - 2][0] : 0;
    const bottomPitch = bottomRow.length >= 2 ? bottomRow[bottomRow.length - 1][0] - bottomRow[bottomRow.length - 2][0] : 0;
    const topExtraRight = topRow.length < 2 || (topRow[0][0] - minAllX) < topPitch / 4;
    const bottomExtraRight = bottomRow.length < 2 || (bottomRow[0][0] - minAllX) < bottomPitch / 4;
    return {
        top: topExtraRight
            ? [...topMidpoints, { key: 'top_extra', x: topRow[topRow.length - 1][0] + topPitch / 2, y: topY }]
            : [{ key: 'top_extra', x: topRow[0][0] - topPitch / 2, y: topY }, ...topMidpoints],
        bottom: bottomExtraRight
            ? [...bottomMidpoints, { key: 'bottom_extra', x: bottomRow[bottomRow.length - 1][0] + bottomPitch / 2, y: bottomY }]
            : [{ key: 'bottom_extra', x: bottomRow[0][0] - bottomPitch / 2, y: bottomY }, ...bottomMidpoints],
    };
}

function buildBusbarAnchorCandidates(geometry, positions) {
    const candidates = [];
    const seen = new Set();
    const addPoint = (x, y) => {
        const key = `${x.toFixed(4)},${y.toFixed(4)}`;
        if (seen.has(key)) return;
        seen.add(key);
        candidates.push([x, y]);
    };

    for (const index of geometry?.padIndices || []) {
        const point = positions[index];
        if (!point) continue;
        addPoint(point[0], point[1]);
    }

    for (const edge of geometry?.edges || []) {
        const stops = [positions[edge.from], ...(edge.waypoints || []), positions[edge.to]].filter(Boolean);
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i];
            const b = stops[i + 1];
            addPoint((a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
        }
    }

    for (const pad of geometry?.extraPads || []) {
        if (!Array.isArray(pad?.pos)) continue;
        addPoint(pad.pos[0], pad.pos[1]);
    }

    for (const segment of geometry?.extraSegments || []) {
        if (!Array.isArray(segment?.from) || !Array.isArray(segment?.to)) continue;
        addPoint(segment.from[0], segment.from[1]);
        addPoint(segment.to[0], segment.to[1]);
        addPoint((segment.from[0] + segment.to[0]) / 2, (segment.from[1] + segment.to[1]) / 2);
    }

    return candidates;
}

function attachEdgeTabsToNearestBusbars(busbars, geometries, positions, options) {
    const {
        enabled = false,
        cellRadius,
        spacing,
        tabWidth,
        tabOverlapSide,
        overlapLength = 28,
        layoutType = 'honeycomb',
    } = options;

    if (enabled !== true) return;
    if (tabOverlapSide !== 'top' && tabOverlapSide !== 'bottom') return;

    const tabCenters = getEdgeTabCenters(positions, cellRadius, spacing, layoutType)[tabOverlapSide];
    if (tabCenters.length === 0) return;

    const inwardDirection = tabOverlapSide === 'top' ? 1 : -1;
    const maxHorizontalGap = Math.max((tabWidth || 0), cellRadius * 2 + spacing * 2);
    const maxVerticalGap = overlapLength + cellRadius * 2 + spacing * 2;
    const betweenBusbarThreshold = Math.max((tabWidth || 0) * 0.6, cellRadius * 0.75);
    const connectorRadius = Math.max(0.05, ((tabWidth || 0) - 0.5) / 2);

    const selectedByBusbar = [];

    for (let i = 0; i < busbars.length; i++) {
        const busbar = busbars[i];
        const geometry = geometries[i];
        if (!geometry || geometry.blocked) continue;

        const anchors = buildBusbarAnchorCandidates(geometry, positions);
        if (anchors.length === 0) continue;

        const extremeY = tabOverlapSide === 'top'
            ? Math.min(...anchors.map(([, y]) => y))
            : Math.max(...anchors.map(([, y]) => y));
        const edgeBand = Math.max(cellRadius * 1.1, spacing + cellRadius * 0.35);
        const edgeAnchors = anchors.filter(([, y]) => (
            tabOverlapSide === 'top' ? y <= extremeY + edgeBand : y >= extremeY - edgeBand
        ));
        if (edgeAnchors.length === 0) continue;

        let best = null;
        for (const tab of tabCenters) {
            for (const anchor of edgeAnchors) {
                const dx = Math.abs(anchor[0] - tab.x);
                const dy = Math.abs(tab.y - anchor[1]);
                if (dx > maxHorizontalGap || dy > maxVerticalGap) continue;
                const score = dx * 3 + dy;
                const candidate = {
                    busbarIndex: i,
                    geometry,
                    anchor,
                    score,
                    tabKey: tab.key,
                    tab,
                    deltaX: anchor[0] - tab.x,
                };
                if (!best || candidate.score < best.score) {
                    best = candidate;
                }
            }
        }
        if (best) selectedByBusbar.push(best);
    }

    const conflictsByTab = new Map();
    for (const candidate of selectedByBusbar) {
        if (!conflictsByTab.has(candidate.tabKey)) conflictsByTab.set(candidate.tabKey, []);
        conflictsByTab.get(candidate.tabKey).push(candidate);
    }

    for (const best of selectedByBusbar) {
        // Skip if the anchor is too far horizontally from the tab centre — this
        // means the busbar doesn't straddle the slot and the arm would require a
        // hard 90° bend (e.g. a single-column vertical busbar next to a tab).
        // Valid connections have an edge midpoint exactly at tab.x → deltaX ≈ 0.
        // Invalid single-column case has deltaX ≈ ±pitch/2 > cellRadius.
        if (Math.abs(best.deltaX) > cellRadius) continue;

        const sameTabCandidates = conflictsByTab.get(best.tabKey) || [];
        const leftCandidate = sameTabCandidates.find((candidate) => candidate.deltaX < -betweenBusbarThreshold);
        const rightCandidate = sameTabCandidates.find((candidate) => candidate.deltaX > betweenBusbarThreshold);
        if (leftCandidate && rightCandidate) continue;

        const anchorPoint = best.anchor.slice();
        const edgePoint = [best.tab.x, best.tab.y];
        const innerPoint = [best.tab.x, best.tab.y + inwardDirection * overlapLength];
        const outerPoint = [best.tab.x, best.tab.y - inwardDirection * overlapLength];

        best.geometry.extraPads = Array.isArray(best.geometry.extraPads)
            ? best.geometry.extraPads
            : [];
        best.geometry.extraPads.push({
            key: `bms_tab_anchor_${tabOverlapSide}_${best.tabKey}`,
            pos: anchorPoint,
            radius: connectorRadius,
        });
        best.geometry.extraPads.push({
            key: `bms_tab_edge_${tabOverlapSide}_${best.tabKey}`,
            pos: edgePoint,
            radius: connectorRadius,
        });
        best.geometry.extraPads.push({
            key: `bms_tab_inner_${tabOverlapSide}_${best.tabKey}`,
            pos: innerPoint,
            radius: connectorRadius,
        });
        best.geometry.extraPads.push({
            key: `bms_tab_outer_${tabOverlapSide}_${best.tabKey}`,
            pos: outerPoint,
            radius: connectorRadius,
        });
        best.geometry.extraSegments = Array.isArray(best.geometry.extraSegments)
            ? best.geometry.extraSegments
            : [];
        best.geometry.extraSegments.push({
            from: anchorPoint,
            to: innerPoint,
            fromKey: `bms_tab_anchor_${tabOverlapSide}_${best.tabKey}`,
            toKey: `bms_tab_inner_${tabOverlapSide}_${best.tabKey}`,
            radius: connectorRadius,
        });
        best.geometry.extraSegments.push({
            from: edgePoint,
            to: innerPoint,
            fromKey: `bms_tab_edge_${tabOverlapSide}_${best.tabKey}`,
            toKey: `bms_tab_inner_${tabOverlapSide}_${best.tabKey}`,
            radius: connectorRadius,
        });
        best.geometry.extraSegments.push({
            from: edgePoint,
            to: outerPoint,
            fromKey: `bms_tab_edge_${tabOverlapSide}_${best.tabKey}`,
            toKey: `bms_tab_outer_${tabOverlapSide}_${best.tabKey}`,
            radius: connectorRadius,
        });
    }
}

function drawBothCanvases(positions, cellSize, padRadius, spacing) {
    drawPreview(positions, cellSize);

    const indexed = busbarStore.list.map((bb, i) => ({ bb, geom: lastComputedGeometries[i] }));
    const topPairs    = indexed.filter(p => (p.bb.face || 'top') === 'top');
    const bottomPairs = indexed.filter(p => (p.bb.face || 'top') === 'bottom');

    // Copy the clean pack layout BEFORE any busbar overlay is painted.
    drawPreviewMirroredCopy('preview-bottom');

    // Now draw each face's busbars on its own canvas only.
    drawBusbarsOverlay(
        topPairs.map(p => p.bb), topPairs.map(p => p.geom),
        positions, cellSize, padRadius, spacing, busbarStore.activeId, 'preview'
    );

    drawBusbarsOverlay(
        bottomPairs.map(p => p.bb), bottomPairs.map(p => p.geom),
        positions, cellSize, padRadius, spacing, busbarStore.activeId, 'preview-bottom',
        false, true
    );
}

export function redrawBusbarOverlay() {
    if (!lastBusbarDrawArgs) return;
    const { positions, cellSize, padRadius, spacing } = lastBusbarDrawArgs;
    drawBothCanvases(positions, cellSize, padRadius, spacing);
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

        const cellRadius = cellSize / 2;
        const busbarPadRadius = Math.max(cellRadius - ledgeWidth, 1.0);
        const busbarKeepoutRadius = 4.0;
        const busbarCellCutoutEnabled = document.getElementById('busbarCellCutoutEnabled')?.checked === true;
        const packBounds = {
            left: Math.min(...positions.map(p => p[0])) - cellRadius - spacing,
            right: Math.max(...positions.map(p => p[0])) + cellRadius + spacing,
            bottom: Math.min(...positions.map(p => p[1])) - cellRadius - spacing,
            top: Math.max(...positions.map(p => p[1])) + cellRadius + spacing,
        };
        lastComputedGeometries = busbarStore.list.map(bb =>
            computeBusbarGeometry(
                bb.cellIndices,
                positions,
                cellRadius,
                busbarPadRadius,
                spacing,
                busbarKeepoutRadius,
                packBounds,
                bb.overlapEnabled !== false,
                layoutType,
                bb.overlapSize,
                busbarCellCutoutEnabled,
            )
        );
        attachEdgeTabsToNearestBusbars(busbarStore.list, lastComputedGeometries, positions, {
            enabled: document.getElementById('bmsHolesType')?.value === 'tabs',
            cellRadius,
            spacing,
            tabWidth: (parseFloat(document.getElementById('tabWidth')?.value) || 4.0) - 1,
            tabOverlapSide: document.getElementById('tabOverlapSide')?.value || 'off',
            overlapLength: parseFloat(document.getElementById('height')?.value) || 10.0,
            layoutType,
        });
        lastBusbarDrawArgs = { positions, cellSize, padRadius: busbarPadRadius, spacing };
        drawBothCanvases(positions, cellSize, busbarPadRadius, spacing);

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
            const areaCm2 = (actualWidth * actualHeight / 100).toFixed(0);
            stats.textContent = `${positions.length} cells • ${actualWidth.toFixed(0)}×${actualHeight.toFixed(0)} mm • ${areaCm2} cm²`;
            const s = Math.max(1, Math.round(parseFloat(document.getElementById('series')?.value) || 1));
            lastPreviewState = { positions, cellSize, spacing, seriesCount: s };
            refreshOrderFromLastState();
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

        const edgeCutWidth = parseFloat(document.getElementById('tabWidth')?.value) || 4.0;
        const tabLength = parseFloat(document.getElementById('tabLength')?.value) || 10.0;
        const tabOverlapSide = document.getElementById('tabOverlapSide')?.value || 'off';

        const config = {
            cellSize, spacing, height, terminalDiameter, terminalDepth,
            coverThickness, roundedCorners, bmsHoles, ledgeWidth,
            filletBms, circleHoleOffset, useTabs, useFullCircles, bmsHoleDiameter,
            tabWidth: edgeCutWidth, tabLength, tabDepth: 1.0, tabOverlapSide, layoutType,
        };

        const holderShape = create3DModel(positions, config);

        if (!holderShape) {
            showStatus('Failed to create 3D model', 'error');
            return;
        }

        const busbarPadRadius = Math.max(cellRadius - ledgeWidth, 1.0);
        const busbarKeepoutRadius = terminalDiameter / 2;
        const busbarCellCutoutEnabled = document.getElementById('busbarCellCutoutEnabled')?.checked === true;
        const packBounds = {
            left: Math.min(...positions.map(p => p[0])) - cellRadius - spacing,
            right: Math.max(...positions.map(p => p[0])) + cellRadius + spacing,
            bottom: Math.min(...positions.map(p => p[1])) - cellRadius - spacing,
            top: Math.max(...positions.map(p => p[1])) + cellRadius + spacing,
        };
        const busbarGeometries = busbarStore.list.map(bb =>
            computeBusbarGeometry(
                bb.cellIndices,
                positions,
                cellRadius,
                busbarPadRadius,
                spacing,
                busbarKeepoutRadius,
                packBounds,
                bb.overlapEnabled !== false,
                layoutType,
                bb.overlapSize,
                busbarCellCutoutEnabled,
            )
        );
        attachEdgeTabsToNearestBusbars(busbarStore.list, busbarGeometries, positions, {
            enabled: bmsHolesType === 'tabs',
            cellRadius,
            spacing,
            tabWidth: edgeCutWidth - 1,
            tabOverlapSide,
            overlapLength: height,
            layoutType,
        });

        for (let i = 0; i < busbarStore.list.length; i++) {
            const bb = busbarStore.list[i];
            const geom = busbarGeometries[i];
            if (geom.blocked) {
                showStatus(`${bb.name}: ${geom.blocked.reason}. Cannot export.`, 'error');
                showLoading(false);
                return;
            }
        }

        const holderCenterX = (Math.min(...positions.map(p => p[0])) + Math.max(...positions.map(p => p[0]))) / 2;
        const holderCenterY = (Math.min(...positions.map(p => p[1])) + Math.max(...positions.map(p => p[1]))) / 2;
        const centeredPositions = positions.map(([x, y]) => [x - holderCenterX, y - holderCenterY]);

        // Sanitize a busbar name for use in a filename (ASCII letters/digits/underscores only).
        const safeName = (name) => (name || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'busbar';

        // Signature invariant under rigid motion AND reflection. Two busbars with equal
        // signatures are congruent, so we only need to print one copy. Uses sorted
        // pairwise cell distances; pairwise distance sets are the same under
        // translation, rotation, and mirror.
        const busbarSignature = (bb, geom) => {
            const idxs = bb.cellIndices;
            const cellCutoutEnabled = document.getElementById('busbarCellCutoutEnabled')?.checked === true;
            const tabSegments = (Array.isArray(geom?.extraSegments) ? geom.extraSegments : [])
                .filter((segment) => String(segment?.fromKey || '').startsWith('bms_tab_') || String(segment?.toKey || '').startsWith('bms_tab_'))
                .map((segment) => `${segment.from[0].toFixed(3)},${segment.from[1].toFixed(3)}>${segment.to[0].toFixed(3)},${segment.to[1].toFixed(3)}`)
                .sort()
                .join(';');
            if (idxs.length === 0) return null;
            if (idxs.length === 1) {
                return `single|${bb.thickness.toFixed(2)}|ov:${bb.overlapEnabled === true ? 1 : 0}|os:${Number(bb.overlapSize ?? 10).toFixed(2)}|cc:${cellCutoutEnabled ? 1 : 0}|tabs:${tabSegments}`;
            }
            const pts = idxs.map(i => centeredPositions[i]).filter(Boolean);
            const dists = [];
            for (let a = 0; a < pts.length; a++) {
                for (let b = a + 1; b < pts.length; b++) {
                    dists.push(Math.hypot(pts[a][0] - pts[b][0], pts[a][1] - pts[b][1]));
                }
            }
            dists.sort((x, y) => x - y);
            return `${pts.length}|${bb.thickness.toFixed(2)}|ov:${bb.overlapEnabled === true ? 1 : 0}|os:${Number(bb.overlapSize ?? 10).toFixed(2)}|cc:${cellCutoutEnabled ? 1 : 0}|tabs:${tabSegments}|${dists.map(d => d.toFixed(3)).join(',')}`;
        };

        // Export format for busbars: STEP solid or DXF flat pattern. The cellholder
        // is always exported as STEP.
        const busbarFormat = (document.getElementById('busbarFormat')?.value) || 'step';

        // Deduplicate busbars by signature. For STEP we also need to build the 3D
        // shape; for DXF we only need the geometry so we can skip the expensive build.
        const uniqueBusbars = [];
        const sigSeen = new Map();
        for (let i = 0; i < busbarStore.list.length; i++) {
            const bb = busbarStore.list[i];
            if (bb.cellIndices.length === 0) continue;
            const sig = busbarSignature(bb, busbarGeometries[i]);
            if (sig && sigSeen.has(sig)) {
                sigSeen.get(sig).copies.push(bb.name);
                continue;
            }
            const entry = { bb, geom: busbarGeometries[i], copies: [bb.name], shape: null };
            if (busbarFormat === 'step') {
                entry.shape = build3DBusbar(centeredGeom(busbarGeometries[i], holderCenterX, holderCenterY), centeredPositions, busbarPadRadius, height, bb.thickness);
                if (!entry.shape) continue;
            }
            uniqueBusbars.push(entry);
            if (sig) sigSeen.set(sig, entry);
        }

        // Trigger downloads sequentially with small delays so browsers allow them.
        const wait = (ms) => new Promise(r => setTimeout(r, ms));
        downloadSTEP(holderShape, `cellholder_${layoutType}.step`);
        for (let i = 0; i < uniqueBusbars.length; i++) {
            await wait(250);
            const { bb, geom, shape } = uniqueBusbars[i];
            const base = `busbar_${safeName(bb.name)}`;
            if (busbarFormat === 'dxf') {
                const content = buildBusbarDXF(centeredGeom(geom, holderCenterX, holderCenterY), centeredPositions, busbarPadRadius);
                downloadDXF(content, `${base}.dxf`);
            } else {
                downloadSTEP(shape, `${base}.step`);
            }
        }

        const totalBusbars = busbarStore.list.filter(b => b.cellIndices.length > 0).length;
        const skipped = totalBusbars - uniqueBusbars.length;
        const busbarMsg = uniqueBusbars.length > 0
            ? `. ${uniqueBusbars.length} unique ${busbarFormat.toUpperCase()} busbar file${uniqueBusbars.length === 1 ? '' : 's'}${skipped > 0 ? ` (${skipped} mirrored duplicate${skipped === 1 ? '' : 's'} skipped)` : ''}`
            : '';
        const holeType = useTabs ? 'edge tabs' :
            (circleHoleOffset ? 'circle offset' : 'semicircle offset');
        const filletMsg = (filletBms && !useTabs) ? ' with filleted holes' : '';

        showStatus(
            `${layoutName} generated. ${positions.length} cells (${holeType}${filletMsg})${busbarMsg}.`,
            'success'
        );
    } catch (error) {
        console.error('Generation error:', error);
        showStatus('Error: ' + error.message, 'error');
    } finally {
        showLoading(false);
    }
}

// ── Per-busbar download helpers ────────────────────────────────────────────────

// Return a copy of geom with extraPads, extraSegments, and cutouts shifted by (-cx, -cy).
function centeredGeom(geom, cx, cy) {
    if (!geom) return geom;
    const cutouts = Array.isArray(geom.cutouts)
        ? geom.cutouts.map(c => ({ ...c, center: [c.center[0] - cx, c.center[1] - cy] }))
        : geom.cutouts;
    const extraPads = Array.isArray(geom.extraPads)
        ? geom.extraPads.map(p => ({ ...p, pos: [p.pos[0] - cx, p.pos[1] - cy] }))
        : geom.extraPads;
    const extraSegments = Array.isArray(geom.extraSegments)
        ? geom.extraSegments.map(s => ({ ...s, from: [s.from[0] - cx, s.from[1] - cy], to: [s.to[0] - cx, s.to[1] - cy] }))
        : geom.extraSegments;
    return { ...geom, cutouts, extraPads, extraSegments };
}

function getBusbarExportContext() {
    if (!lastBusbarDrawArgs || lastComputedGeometries.length === 0) return null;
    const { positions, padRadius } = lastBusbarDrawArgs;
    const cx = (Math.min(...positions.map(p => p[0])) + Math.max(...positions.map(p => p[0]))) / 2;
    const cy = (Math.min(...positions.map(p => p[1])) + Math.max(...positions.map(p => p[1]))) / 2;
    const centeredPositions = positions.map(([x, y]) => [x - cx, y - cy]);
    const height = parseFloat(document.getElementById('height').value);
    const busbarFormat = document.getElementById('busbarFormat')?.value || 'step';
    const safeName = (name) => (name || '').replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'busbar';
    return { centeredPositions, centerX: cx, centerY: cy, padRadius, height, busbarFormat, safeName };
}

export async function downloadSingleBusbar(busbarId) {
    const ctx = getBusbarExportContext();
    if (!ctx) {
        showStatus('Configure the layout first to enable busbar downloads.', 'error');
        return;
    }
    const bbIdx = busbarStore.list.findIndex(b => b.id === busbarId);
    if (bbIdx < 0) return;
    const bb = busbarStore.list[bbIdx];
    if (bb.cellIndices.length === 0) {
        showStatus(`${bb.name} has no cells assigned.`, 'error');
        return;
    }
    const geom = lastComputedGeometries[bbIdx];
    if (!geom || geom.blocked) {
        showStatus(`${bb.name}: ${geom?.blocked?.reason ?? 'geometry unavailable'}`, 'error');
        return;
    }
    if (ctx.busbarFormat === 'step' && !ocRef.initialized) {
        showStatus('3D engine not ready. Please wait.', 'error');
        return;
    }
    const base = `busbar_${ctx.safeName(bb.name)}`;
    showLoading(true, `Exporting ${bb.name}`, '');
    await new Promise(r => setTimeout(r, 20));
    try {
        if (ctx.busbarFormat === 'dxf') {
            const content = buildBusbarDXF(centeredGeom(geom, ctx.centerX, ctx.centerY), ctx.centeredPositions, ctx.padRadius);
            downloadDXF(content, `${base}.dxf`);
        } else {
            const shape = build3DBusbar(centeredGeom(geom, ctx.centerX, ctx.centerY), ctx.centeredPositions, ctx.padRadius, ctx.height, bb.thickness);
            if (!shape) { showStatus(`Failed to build 3D shape for ${bb.name}.`, 'error'); return; }
            downloadSTEP(shape, `${base}.step`);
        }
    } catch (e) {
        showStatus(`Export error: ${e.message}`, 'error');
    } finally {
        showLoading(false);
    }
}

export async function downloadAllBusbarsZip() {
    const ctx = getBusbarExportContext();
    if (!ctx) {
        showStatus('Configure the layout first to enable busbar downloads.', 'error');
        return;
    }
    const eligible = busbarStore.list
        .map((bb, i) => ({ bb, geom: lastComputedGeometries[i], i }))
        .filter(({ bb, geom }) => bb.cellIndices.length > 0 && geom && !geom.blocked);
    if (eligible.length === 0) {
        showStatus('No busbars with cells to export.', 'error');
        return;
    }
    if (ctx.busbarFormat === 'step' && !ocRef.initialized) {
        showStatus('3D engine not ready. Please wait.', 'error');
        return;
    }
    showLoading(true, 'Building busbar ZIP', 'Please wait...');
    await new Promise(r => setTimeout(r, 50));
    try {
        const { default: JSZip } = await import('jszip');
        const zip = new JSZip();
        for (const { bb, geom } of eligible) {
            const base = `busbar_${ctx.safeName(bb.name)}`;
            if (ctx.busbarFormat === 'dxf') {
                const content = buildBusbarDXF(centeredGeom(geom, ctx.centerX, ctx.centerY), ctx.centeredPositions, ctx.padRadius);
                zip.file(`${base}.dxf`, content);
            } else {
                const shape = build3DBusbar(centeredGeom(geom, ctx.centerX, ctx.centerY), ctx.centeredPositions, ctx.padRadius, ctx.height, bb.thickness);
                if (!shape) continue;
                const bytes = buildSTEPBytes(shape, `_zip_${base}.step`);
                if (bytes) zip.file(`${base}.step`, bytes);
            }
        }
        const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'busbars.zip';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showStatus(`Downloaded busbars.zip (${eligible.length} file${eligible.length === 1 ? '' : 's'}).`, 'success');
    } catch (e) {
        console.error('ZIP export error:', e);
        showStatus('ZIP export error: ' + e.message, 'error');
    } finally {
        showLoading(false);
    }
}
