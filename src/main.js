import { canvasState } from './state.js';
import { initOC } from './oc.js';
import { toggleBmsDiameter, initCustomSelects, showStatus } from './ui.js';
import { drawPreview } from './preview.js';
import { updatePreview, generateLayout, redrawBusbarOverlay, downloadSingleBusbar, downloadAllBusbarsZip, setOrderUpdateCallback, refreshOrderFromLastState } from './app.js';
import { busbarStore } from './busbars.js';
import { initBusbarUI, renderBusbarList } from './busbar-ui.js';
import { captureConfig, encodeConfigToHash, decodeHashToConfig } from './url-config.js';
import { renderOrderSection } from './order.js';

const CLICK_PIXEL_THRESHOLD = 4;
const URL_SYNC_DEBOUNCE_MS = 250;

let packModeController = null;
let urlSyncTimer = null;
let isApplyingUrlConfig = false;

function scaleCanvasById(id) {
    const canvas = document.getElementById(id);
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    // Only update the drawing buffer to match the current CSS-rendered size × DPR.
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
}

function scaleCanvasForDPI() {
    scaleCanvasById('preview');
    scaleCanvasById('preview-bottom');
}

function getPackMode() {
    const el = document.querySelector('[data-pack-mode]');
    return (el && el.dataset.mode) || 'sp';
}

function refreshCustomSelect(id) {
    const select = document.getElementById(id);
    if (!select) return;
    const wrapper = select.closest('.custom-select');
    if (!wrapper) return;
    const selected = wrapper.querySelector('.select-selected');
    const items = wrapper.querySelectorAll('.select-items div');
    if (selected) {
        selected.textContent = select.options[select.selectedIndex]?.text || '';
    }
    items.forEach((item) => {
        item.classList.toggle('same-as-selected', item.dataset.value === select.value);
    });
}

function setNumberInput(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.value = String(value);
}

function setCheckboxInput(id, value) {
    const input = document.getElementById(id);
    if (!input) return;
    input.checked = !!value;
}

function setSelectInput(id, value) {
    const select = document.getElementById(id);
    if (!select) return;
    select.value = String(value);
    refreshCustomSelect(id);
}

function setPackMode(mode, options = {}) {
    const { clearBusbars = true, refresh = true } = options;
    if (!packModeController) return;

    const nextMode = mode === 'mm' ? 'mm' : 'sp';
    const { toggle, buttons, indicator, spFields, mmFields } = packModeController;

    toggle.dataset.mode = nextMode;
    buttons.forEach((b) => {
        const on = b.dataset.mode === nextMode;
        b.classList.toggle('active', on);
        if (on && indicator) {
            indicator.style.left = b.offsetLeft + 'px';
            indicator.style.width = b.offsetWidth + 'px';
        }
    });

    if (spFields) spFields.hidden = nextMode !== 'sp';
    if (mmFields) mmFields.hidden = nextMode !== 'mm';

    if (refresh) {
        syncPackDimsFromSP();
        updatePreview(true);
    }
    if (clearBusbars) {
        busbarStore.clearAll();
    }
}

async function syncUrlHashNow() {
    if (isApplyingUrlConfig) return;
    try {
        const config = captureConfig(() => getPackMode(), busbarStore.getSnapshot());
        const hash = await encodeConfigToHash(config);
        if (window.location.hash !== hash) {
            window.history.replaceState(null, '', hash);
        }
    } catch (error) {
        console.error('Failed to sync URL hash:', error);
    }
}

function scheduleUrlHashSync() {
    if (isApplyingUrlConfig) return;
    if (urlSyncTimer) {
        clearTimeout(urlSyncTimer);
    }
    urlSyncTimer = setTimeout(() => {
        urlSyncTimer = null;
        void syncUrlHashNow();
    }, URL_SYNC_DEBOUNCE_MS);
}

function applyConfigToUi(config) {
    isApplyingUrlConfig = true;
    try {
        setNumberInput('series', config.pack.series);
        setNumberInput('parallel', config.pack.parallel);
        setNumberInput('xDim', config.pack.xDim);
        setNumberInput('yDim', config.pack.yDim);

        setNumberInput('cellSize', config.cell.cellSize);
        setSelectInput('layoutType', config.cell.layoutType);
        setNumberInput('spacing', config.cell.spacing);
        setNumberInput('height', config.cell.height);
        setNumberInput('coverThickness', config.cell.coverThickness);
        setNumberInput('ledgeWidth', config.cell.ledgeWidth);
        setCheckboxInput('roundedCorners', config.cell.roundedCorners);

        setSelectInput('bmsHolesType', config.bms.type);
        setNumberInput('bmsHoleDiameter', config.bms.holeDiameter);
        setNumberInput('tabWidth', config.bms.tabWidth);
        setNumberInput('tabLength', config.bms.tabLength ?? 10.0);
        setSelectInput('tabOverlapSide', config.bms.tabOverlapSide || 'off');

        setSelectInput('busbarFormat', config.busbars.format);
        setCheckboxInput('busbarCellCutoutEnabled', config.busbars.cellCutoutEnabled === true);
        setPackMode(config.pack.mode, { clearBusbars: false, refresh: false });

        toggleBmsDiameter();
        syncPackDimsFromSP();
        if (config.pack.mode === 'mm') {
            setNumberInput('xDim', config.pack.xDim);
            setNumberInput('yDim', config.pack.yDim);
        }

        busbarStore.replaceFromSnapshot({
            activeId: config.busbars.activeId,
            list: config.busbars.list,
        });
        renderBusbarList();
    } finally {
        isApplyingUrlConfig = false;
    }
}

async function loadConfigFromUrl() {
    if (!window.location.hash || !window.location.hash.startsWith('#config=')) {
        return false;
    }

    const decoded = await decodeHashToConfig(window.location.hash);
    if (!decoded.ok) {
        showStatus('Shared URL is invalid or corrupted. Loaded default configuration.', 'error');
        return false;
    }

    applyConfigToUi(decoded.config);
    return true;
}

function wireShareButton() {
    const button = document.getElementById('copyShareUrlBtn');
    if (!button) return;

    const defaultLabel = (button.textContent || 'Copy Share URL').trim();
    let resetTimer = null;

    const setTemporaryButtonState = (stateClass, text) => {
        if (resetTimer) clearTimeout(resetTimer);
        button.classList.remove('is-success', 'is-error');
        if (stateClass) button.classList.add(stateClass);
        button.textContent = text;
        resetTimer = setTimeout(() => {
            button.classList.remove('is-success', 'is-error');
            button.textContent = defaultLabel;
        }, 2000);
    };

    button.addEventListener('click', async () => {
        button.disabled = true;
        try {
            await syncUrlHashNow();
            const shareUrl = `${window.location.origin}${window.location.pathname}${window.location.hash}`;
            if (!navigator.clipboard?.writeText) {
                throw new Error('Clipboard API unavailable');
            }
            await navigator.clipboard.writeText(shareUrl);
            setTemporaryButtonState('is-success', '✓ Copied');
        } catch (error) {
            console.error('Failed to copy share URL:', error);
            setTemporaryButtonState('is-error', 'Copy failed');
        } finally {
            button.disabled = false;
        }
    });
}

function wireUrlSyncListeners() {
    const ids = [
        'series', 'parallel', 'xDim', 'yDim', 'height',
        'cellSize', 'layoutType', 'spacing', 'coverThickness', 'ledgeWidth',
        'roundedCorners', 'bmsHolesType', 'bmsHoleDiameter', 'tabWidth',
        'tabOverlapSide', 'busbarFormat', 'busbarCellCutoutEnabled',
    ];

    ids.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.addEventListener('input', scheduleUrlHashSync);
        el.addEventListener('change', scheduleUrlHashSync);
    });

    busbarStore.subscribeMutations(scheduleUrlHashSync);
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

    const visualInputs = ['bmsHolesType', 'roundedCorners', 'bmsHoleDiameter', 'ledgeWidth', 'tabWidth', 'tabLength', 'tabOverlapSide', 'busbarCellCutoutEnabled'];
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

    packModeController = { toggle, buttons, indicator, spFields, mmFields };

    buttons.forEach(b => b.addEventListener('click', () => setPackMode(b.dataset.mode)));
    requestAnimationFrame(() => {
        const active = buttons.find(b => b.classList.contains('active')) || buttons[0];
        if (active) moveIndicator(active);
    });
}

function redrawFromState() {
    if (canvasState.currentPositions.length > 0) {
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
    // Wire both canvases with identical pan/zoom/click behaviour.
    // They share canvasState so moving one moves both.

    // When a canvas for a given face is focused, auto-switch to a busbar of that face.
    function switchActiveToFace(face) {
        const active = busbarStore.getActive();
        if (active && (active.face || 'top') !== face) {
            const match = busbarStore.list.find(b => (b.face || 'top') === face);
            if (match) {
                busbarStore.setActive(match.id);
            }
        }
    }

    function wirePanZoom(el, face) {
        if (!el) return;
        el.style.cursor = 'grab';

        // ── Wheel zoom ────────────────────────────────────────────────────────
        el.addEventListener('wheel', (e) => {
            e.preventDefault();
            const zoomSpeed = 0.1;
            const delta = e.deltaY > 0 ? -zoomSpeed : zoomSpeed;
            const newZoom = Math.max(0.2, Math.min(5.0, canvasState.zoom + delta));
            const rect = el.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const mouseY = e.clientY - rect.top;
            const zoomRatio = newZoom / canvasState.zoom;
            canvasState.panX = mouseX - (mouseX - canvasState.panX) * zoomRatio;
            canvasState.panY = mouseY - (mouseY - canvasState.panY) * zoomRatio;
            canvasState.zoom = newZoom;
            redrawFromState();
        }, { passive: false });

        // ── Mouse drag ────────────────────────────────────────────────────────
        el.addEventListener('mousedown', (e) => {
            switchActiveToFace(face);
            canvasState.isDragging = true;
            canvasState.dragStartX = e.clientX;
            canvasState.dragStartY = e.clientY;
            canvasState.dragMoved = false;
            canvasState.lastMouseX = e.clientX;
            canvasState.lastMouseY = e.clientY;
            el.style.cursor = 'grabbing';
        });

        el.addEventListener('mousemove', (e) => {
            if (!canvasState.isDragging) return;
            const totalDx = e.clientX - canvasState.dragStartX;
            const totalDy = e.clientY - canvasState.dragStartY;
            if (Math.abs(totalDx) > CLICK_PIXEL_THRESHOLD || Math.abs(totalDy) > CLICK_PIXEL_THRESHOLD) {
                canvasState.dragMoved = true;
            }
            canvasState.panX += e.clientX - canvasState.lastMouseX;
            canvasState.panY += e.clientY - canvasState.lastMouseY;
            canvasState.lastMouseX = e.clientX;
            canvasState.lastMouseY = e.clientY;
            if (canvasState.currentPositions.length > 0) {
                requestAnimationFrame(() => redrawFromState());
            }
        });

        el.addEventListener('mouseup', (e) => {
            if (canvasState.isDragging && !canvasState.dragMoved) {
                const rect = el.getBoundingClientRect();
                handleCanvasClick(e.clientX - rect.left, e.clientY - rect.top);
            }
            canvasState.isDragging = false;
            canvasState.dragMoved = false;
            el.style.cursor = 'grab';
        });

        el.addEventListener('mouseleave', () => {
            // Only reset cursor, NOT isDragging — user may move to the other canvas.
            el.style.cursor = 'grab';
        });

        // ── Touch ─────────────────────────────────────────────────────────────
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

        el.addEventListener('touchstart', (e) => {
            e.preventDefault();
            switchActiveToFace(face);
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
                const rect = el.getBoundingClientRect();
                touchCenterX = ((t1.clientX + t2.clientX) / 2) - rect.left;
                touchCenterY = ((t1.clientY + t2.clientY) / 2) - rect.top;
            }
        }, { passive: false });

        el.addEventListener('touchmove', (e) => {
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
                    requestAnimationFrame(() => redrawFromState());
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
                    requestAnimationFrame(() => redrawFromState());
                }
            }
        }, { passive: false });

        el.addEventListener('touchend', (e) => {
            e.preventDefault();
            if (e.changedTouches.length > 0 && isTouching && !touchMoved) {
                const t = e.changedTouches[0];
                const rect = el.getBoundingClientRect();
                handleCanvasClick(t.clientX - rect.left, t.clientY - rect.top);
            }
            if (e.touches.length === 0) { isTouching = false; touchMoved = false; }
            if (e.touches.length < 2) touchStartDistance = 0;
        }, { passive: false });

        el.addEventListener('touchcancel', () => {
            isTouching = false;
            touchMoved = false;
            touchStartDistance = 0;
        });
    }

    // Global mouseup so releasing outside a canvas still ends the drag.
    window.addEventListener('mouseup', () => {
        if (canvasState.isDragging) {
            canvasState.isDragging = false;
            canvasState.dragMoved = false;
            document.getElementById('preview')?.style && (document.getElementById('preview').style.cursor = 'grab');
            document.getElementById('preview-bottom')?.style && (document.getElementById('preview-bottom').style.cursor = 'grab');
        }
    });

    wirePanZoom(document.getElementById('preview'), 'top');
    wirePanZoom(document.getElementById('preview-bottom'), 'bottom');
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
    setOrderUpdateCallback(renderOrderSection);
    busbarStore.subscribe(() => refreshOrderFromLastState());
    wireSidebarTabs();
    wirePackMode();

    const bmsTypeSelect = document.getElementById('bmsHolesType');
    if (bmsTypeSelect) {
        bmsTypeSelect.addEventListener('change', toggleBmsDiameter);
        toggleBmsDiameter();
    }

    const generateBtn = document.getElementById('generateBtn');
    if (generateBtn) {
        generateBtn.addEventListener('click', generateLayout);
    }

    initBusbarUI({
        onDownloadSingle: downloadSingleBusbar,
        onDownloadAll: downloadAllBusbarsZip,
        onFaceFilterChange(filter) {
            // Double rAF: first frame applies the hidden/visible DOM change,
            // second frame reads the settled flex layout dimensions.
            requestAnimationFrame(() => requestAnimationFrame(() => {
                scaleCanvasById('preview');
                if (filter === 'both') scaleCanvasById('preview-bottom');
                redrawBusbarOverlay();
            }));
        },
    });
    renderBusbarList();
    busbarStore.subscribe(() => updatePreview(false));

    wireInputs();
    wireCanvasInteractions();
    wireShareButton();
    wireUrlSyncListeners();

    const loadedFromUrl = await loadConfigFromUrl();
    if (!loadedFromUrl) {
        syncPackDimsFromSP();
    }

    await initOC();

    // Keep canvas drawing buffers in sync whenever their CSS size changes
    // (e.g. window resize, flex layout settling, face-filter toggles).
    const canvasResizeObserver = new ResizeObserver(() => {
        scaleCanvasForDPI();
        updatePreview(false);
    });
    const previewCanvas = document.getElementById('preview');
    const previewBottomCanvas = document.getElementById('preview-bottom');
    if (previewCanvas) canvasResizeObserver.observe(previewCanvas);
    if (previewBottomCanvas) canvasResizeObserver.observe(previewBottomCanvas);

    window.addEventListener('resize', () => {
        scaleCanvasForDPI();
        updatePreview(false);
    });

    setTimeout(() => {
        // Force a fresh render after both OC init and config load are complete.
        // This ensures viewTransform and geometries are in sync with loaded busbars.
        updatePreview(true);
        void syncUrlHashNow();
    }, 100);
}

if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', initializeApp);
} else {
    initializeApp();
}
