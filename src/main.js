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

function wireInputs() {
    const layoutInputs = ['xDim', 'yDim', 'spacing', 'cellSize', 'layoutType'];
    layoutInputs.forEach(id => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('change', () => busbarStore.clearAll());
    });

    const dimensionInputs = ['xDim', 'yDim', 'spacing', 'cellSize', 'layoutType', 'height', 'coverThickness'];
    dimensionInputs.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.addEventListener('input', () => updatePreview(true));
        element.addEventListener('change', () => updatePreview(true));
    });

    const visualInputs = ['bmsHolesType', 'roundedCorners', 'bmsHoleDiameter', 'ledgeWidth', 'tabWidth', 'tabDepth'];
    visualInputs.forEach(id => {
        const element = document.getElementById(id);
        if (!element) return;
        element.addEventListener('input', () => updatePreview(false));
        element.addEventListener('change', () => updatePreview(false));
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

async function initializeApp() {
    scaleCanvasForDPI();
    initCustomSelects();

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
