import { canvasState } from './state.js';
import { initOC } from './oc.js';
import { toggleBmsDiameter, initCustomSelects } from './ui.js';
import { drawPreview } from './preview.js';
import { updatePreview, generateLayout, redrawBusbarOverlay } from './app.js';
import { busbarStore } from './busbars.js';
import { initBusbarUI, renderBusbarList } from './busbar-ui.js';

const CLICK_PIXEL_THRESHOLD = 4;

function scaleCanvasForDPI() {
    const canvas = document.getElementById('preview');
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
}

function getPackMode() {
    const el = document.querySelector('[data-pack-mode]');
    return (el && el.dataset.mode) || 'sp';
}

// Compute the pack footprint (world mm) from Series and Parallel counts and write
// it to the xDim / yDim inputs so the existing layout generators pick it up. When
// the user switches to "Size (mm)" mode, xDim / yDim are entered directly and this
// routine just refreshes the summary.
function syncPackDimsFromSP() {
    const mode = getPackMode();
    const xEl = document.getElementById('xDim');
    const yEl = document.getElementById('yDim');
    const summary = document.getElementById('packSummary');

    if (mode === 'mm') {
        const xDim = parseFloat(xEl.value) || 0;
        const yDim = parseFloat(yEl.value) || 0;
        if (summary) {
            summary.innerHTML =
                `<strong>${xDim.toFixed(0)} &times; ${yDim.toFixed(0)} mm</strong> ` +
                `<span class="muted">footprint. Cells fit automatically.</span>`;
        }
        return;
    }

    const s = Math.max(1, Math.round(parseFloat(document.getElementById('series').value) || 1));
    const p = Math.max(1, Math.round(parseFloat(document.getElementById('parallel').value) || 1));
    const cellSize = parseFloat(document.getElementById('cellSize').value) || 21.35;
    const spacing = parseFloat(document.getElementById('spacing').value) || 0.6;
    const layoutType = document.getElementById('layoutType').value;

    const gridStride = cellSize + spacing;
    const hexStride = Math.sqrt(3) / 2 * gridStride;
    const EPS = 0.02;

    const gridSpan = (n) => cellSize + 2 * spacing + (n - 1) * gridStride + EPS;
    const hexSpan  = (n) => cellSize + 2 * spacing + (n - 1) * hexStride  + EPS;
    // Offset packing: size for the shifted row so both rows fit n cells.
    const offsetSpan = (n) => cellSize + 2 * spacing + (n - 1) * gridStride + gridStride / 2 + EPS;

    let xDim, yDim;
    if (layoutType === 'vertical') {
        xDim = hexSpan(s);
        yDim = offsetSpan(p);
    } else if (layoutType === 'honeycomb') {
        xDim = offsetSpan(s);
        yDim = hexSpan(p);
    } else {
        xDim = gridSpan(s);
        yDim = gridSpan(p);
    }

    xEl.value = xDim.toFixed(2);
    yEl.value = yDim.toFixed(2);

    if (summary) {
        const total = s * p;
        summary.innerHTML =
            `<strong>${s}S ${p}P</strong>. ${total} cells. ` +
            `<span class="muted">Footprint about ${xDim.toFixed(0)} &times; ${yDim.toFixed(0)} mm.</span>`;
    }
}

function wireInputs() {
    // Series/Parallel drive xDim/yDim in SP mode. When the user types into them (or
    // into spacing/cellSize/layoutType) we resync and re-render.
    const spInputs = ['series', 'parallel'];
    spInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => { syncPackDimsFromSP(); updatePreview(true); });
        el.addEventListener('change', () => busbarStore.clearAll());
    });

    // In mm mode xDim / yDim are user inputs; refresh summary and preview directly.
    const mmInputs = ['xDim', 'yDim'];
    mmInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', () => {
            if (getPackMode() === 'mm') {
                syncPackDimsFromSP();
                updatePreview(true);
            }
        });
        el.addEventListener('change', () => {
            if (getPackMode() === 'mm') busbarStore.clearAll();
        });
    });

    const layoutInputs = ['spacing', 'cellSize', 'layoutType'];
    layoutInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => busbarStore.clearAll());
    });

    const dimensionInputs = ['spacing', 'cellSize', 'layoutType', 'height', 'coverThickness'];
    dimensionInputs.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        const handler = () => { syncPackDimsFromSP(); updatePreview(true); };
        element.addEventListener('input', handler);
        element.addEventListener('change', handler);
    });

    const visualInputs = ['bmsHolesType', 'roundedCorners', 'bmsHoleDiameter', 'ledgeWidth', 'tabWidth', 'tabDepth'];
    visualInputs.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.addEventListener('input', () => updatePreview(false));
        element.addEventListener('change', () => updatePreview(false));
    });
}

function wirePackMode() {
    const toggle = document.querySelector('[data-pack-mode]');
    if (!toggle) return;
    const buttons = Array.from(toggle.querySelectorAll('.seg'));
    const indicator = toggle.querySelector('.seg-indicator');
    const spFields = document.querySelector('.pack-sp-fields');
    const mmFields = document.querySelector('.pack-mm-fields');

    const moveIndicator = (btn) => {
        if (!indicator || !btn) return;
        indicator.style.left = btn.offsetLeft + 'px';
        indicator.style.width = btn.offsetWidth + 'px';
    };

    const apply = (mode) => {
        toggle.dataset.mode = mode;
        buttons.forEach(b => {
            const on = b.dataset.mode === mode;
            b.classList.toggle('active', on);
            if (on) moveIndicator(b);
        });
        if (spFields) spFields.hidden = mode !== 'sp';
        if (mmFields) mmFields.hidden = mode !== 'mm';
        syncPackDimsFromSP();
        updatePreview(true);
        busbarStore.clearAll();
    };

    buttons.forEach(b => b.addEventListener('click', () => apply(b.dataset.mode)));
    requestAnimationFrame(() => {
        const active = buttons.find(b => b.classList.contains('active')) || buttons[0];
        if (active) moveIndicator(active);
    });
}

function redrawFromState() {
    if (canvasState.currentPositions.length > 0) {
        drawPreview(canvasState.currentPositions, canvasState.currentCellSize);
        redrawBusbarOverlay();
    }
}

function canvasPointToWorld(cx, cy) {
    const t = canvasState.viewTransform;
    if (!t) return null;
    const localX = (cx - canvasState.panX) / canvasState.zoom;
    const localY = (cy - canvasState.panY) / canvasState.zoom;
    const worldX = (localX - t.offsetX) / t.scale + t.minX - t.r - t.spacing;
    const worldY = (localY - t.offsetY) / t.scale + t.minY - t.r - t.spacing;
    return [worldX, worldY];
}

function handleCanvasClick(cx, cy) {
    const active = busbarStore.getActive();
    if (!active) return;
    const world = canvasPointToWorld(cx, cy);
    if (!world) return;
    const cellRadius = canvasState.currentCellSize / 2;

    let bestIdx = -1, bestDist = cellRadius;
    canvasState.currentPositions.forEach(([x, y], i) => {
        const d = Math.hypot(world[0] - x, world[1] - y);
        if (d < bestDist) { bestDist = d; bestIdx = i; }
    });

    if (bestIdx >= 0) busbarStore.toggleCell(bestIdx);
}

function wireCanvasInteractions() {
    const canvas = document.getElementById('preview');
    if (!canvas) return;

    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        const zoomSpeed = 0.1;
        const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
        const newZoom = Math.max(0.2, Math.min(5.0, canvasState.zoom + delta));

        const rect = canvas.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const zoomRatio = newZoom / canvasState.zoom;
        canvasState.panX = mouseX - (mouseX - canvasState.panX) * zoomRatio;
        canvasState.panY = mouseY - (mouseY - canvasState.panY) * zoomRatio;
        canvasState.zoom = newZoom;

        redrawFromState();
    });

    canvas.addEventListener('mousedown', (e) => {
        canvasState.isDragging = true;
        canvasState.dragStartX = e.clientX;
        canvasState.dragStartY = e.clientY;
        canvasState.dragMoved = false;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;
        canvas.style.cursor = 'grabbing';
    });

    canvas.addEventListener('mousemove', (e) => {
        if (!canvasState.isDragging) return;
        const totalDx = e.clientX - canvasState.dragStartX;
        const totalDy = e.clientY - canvasState.dragStartY;
        if (Math.abs(totalDx) > CLICK_PIXEL_THRESHOLD || Math.abs(totalDy) > CLICK_PIXEL_THRESHOLD) {
            canvasState.dragMoved = true;
        }

        const deltaX = e.clientX - canvasState.lastMouseX;
        const deltaY = e.clientY - canvasState.lastMouseY;
        canvasState.panX += deltaX;
        canvasState.panY += deltaY;
        canvasState.lastMouseX = e.clientX;
        canvasState.lastMouseY = e.clientY;

        if (canvasState.currentPositions.length > 0) {
            requestAnimationFrame(() => { drawPreview(canvasState.currentPositions, canvasState.currentCellSize); redrawBusbarOverlay(); });
        }
    });

    canvas.addEventListener('mouseup', (e) => {
        if (canvasState.isDragging && !canvasState.dragMoved) {
            const rect = canvas.getBoundingClientRect();
            handleCanvasClick(e.clientX - rect.left, e.clientY - rect.top);
        }
        canvasState.isDragging = false;
        canvasState.dragMoved = false;
        canvas.style.cursor = 'grab';
    });

    canvas.addEventListener('mouseleave', () => {
        canvasState.isDragging = false;
        canvasState.dragMoved = false;
        canvas.style.cursor = 'grab';
    });

    let touchStartDistance = 0;
    let touchStartZoom = 1.0;
    let touchStartPanX = 0;
    let touchStartPanY = 0;
    let touchCenterX = 0;
    let touchCenterY = 0;
    let lastTouchX = 0;
    let lastTouchY = 0;
    let touchStartClientX = 0;
    let touchStartClientY = 0;
    let touchMoved = false;
    let isTouching = false;

    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (e.touches.length === 1) {
            isTouching = true;
            lastTouchX = e.touches[0].clientX;
            lastTouchY = e.touches[0].clientY;
            touchStartClientX = lastTouchX;
            touchStartClientY = lastTouchY;
            touchMoved = false;
        } else if (e.touches.length === 2) {
            isTouching = false;
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            touchStartDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            touchStartZoom = canvasState.zoom;
            touchStartPanX = canvasState.panX;
            touchStartPanY = canvasState.panY;
            const rect = canvas.getBoundingClientRect();
            touchCenterX = ((t1.clientX + t2.clientX) / 2) - rect.left;
            touchCenterY = ((t1.clientY + t2.clientY) / 2) - rect.top;
        }
    });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        if (e.touches.length === 1 && isTouching) {
            const touch = e.touches[0];
            const totalDx = touch.clientX - touchStartClientX;
            const totalDy = touch.clientY - touchStartClientY;
            if (Math.abs(totalDx) > CLICK_PIXEL_THRESHOLD || Math.abs(totalDy) > CLICK_PIXEL_THRESHOLD) {
                touchMoved = true;
            }
            canvasState.panX += touch.clientX - lastTouchX;
            canvasState.panY += touch.clientY - lastTouchY;
            lastTouchX = touch.clientX;
            lastTouchY = touch.clientY;
            if (canvasState.currentPositions.length > 0) {
                requestAnimationFrame(() => { drawPreview(canvasState.currentPositions, canvasState.currentCellSize); redrawBusbarOverlay(); });
            }
        } else if (e.touches.length === 2) {
            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDistance = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const zoomRatio = currentDistance / touchStartDistance;
            const newZoom = Math.max(0.2, Math.min(5.0, touchStartZoom * zoomRatio));
            const zoomChange = newZoom / touchStartZoom;
            canvasState.panX = touchCenterX - (touchCenterX - touchStartPanX) * zoomChange;
            canvasState.panY = touchCenterY - (touchCenterY - touchStartPanY) * zoomChange;
            canvasState.zoom = newZoom;
            if (canvasState.currentPositions.length > 0) {
                requestAnimationFrame(() => { drawPreview(canvasState.currentPositions, canvasState.currentCellSize); redrawBusbarOverlay(); });
            }
        }
    });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        if (e.changedTouches.length > 0 && isTouching && !touchMoved) {
            const t = e.changedTouches[0];
            const rect = canvas.getBoundingClientRect();
            handleCanvasClick(t.clientX - rect.left, t.clientY - rect.top);
        }
        if (e.touches.length === 0) {
            isTouching = false;
            touchMoved = false;
        }
        if (e.touches.length < 2) touchStartDistance = 0;
    });

    canvas.addEventListener('touchcancel', () => {
        isTouching = false;
        touchMoved = false;
        touchStartDistance = 0;
    });

    canvas.style.cursor = 'grab';
}

function wireSidebarTabs() {
    const root = document.querySelector('[data-tabs]');
    if (!root) return;
    const tabs = Array.from(root.querySelectorAll('.tab'));
    const indicator = root.querySelector('.tab-indicator');
    const panels = Array.from(document.querySelectorAll('.tab-panel'));

    const moveIndicator = (tab) => {
        if (!indicator || !tab) return;
        indicator.style.left = tab.offsetLeft + 'px';
        indicator.style.width = tab.offsetWidth + 'px';
    };

    const activate = (key) => {
        for (const tab of tabs) {
            const on = tab.dataset.panel === key;
            tab.classList.toggle('active', on);
            tab.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on) moveIndicator(tab);
        }
        for (const panel of panels) {
            panel.classList.toggle('active', panel.dataset.panel === key);
        }
    };

    for (const tab of tabs) {
        tab.addEventListener('click', () => activate(tab.dataset.panel));
    }

    // Set initial indicator position after layout settles.
    requestAnimationFrame(() => {
        const active = tabs.find(t => t.classList.contains('active')) || tabs[0];
        if (active) moveIndicator(active);
    });
    window.addEventListener('resize', () => {
        const active = tabs.find(t => t.classList.contains('active'));
        if (active) moveIndicator(active);
    });
}

async function initializeApp() {
    scaleCanvasForDPI();
    initCustomSelects();
    wireSidebarTabs();
    wirePackMode();
    syncPackDimsFromSP();

    const bmsTypeSelect = document.getElementById('bmsHolesType');
    if (bmsTypeSelect) {
        bmsTypeSelect.addEventListener('change', toggleBmsDiameter);
        toggleBmsDiameter();
    }

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateLayout);
    }

    initBusbarUI();
    renderBusbarList();
    busbarStore.subscribe(() => updatePreview(false));

    wireInputs();
    wireCanvasInteractions();

    await initOC();

    setTimeout(() => updatePreview(true), 100);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
