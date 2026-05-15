import { busbarStore } from './busbars.js';

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

// Which faces are currently visible in the busbar list. 'both' | 'top'
let faceFilter = 'both';

// Callbacks injected from main.js to avoid circular imports.
let _onDownloadSingle = null;
let _onDownloadAll    = null;

// Sync thickness label visibility based on the current busbar export format.
function syncThicknessVisibility() {
    const list = document.getElementById('busbarList');
    if (!list) return;
    const fmt = document.getElementById('busbarFormat')?.value || 'step';
    list.classList.toggle('busbar-list-dxf', fmt === 'dxf');
}

// Download icon SVG (inline, no external deps)
const DL_ICON = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v13M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>`;

function buildBusbarRow(bb, blockedByBusbarId) {
    const row = document.createElement('div');
    row.className = 'busbar-row' + (bb.id === busbarStore.activeId ? ' active' : '');
    row.dataset.id = bb.id;

    row.innerHTML = `
        <div class="busbar-header">
            <label class="busbar-color-wrap" title="Busbar color">
                <input class="busbar-color" type="color" value="${escapeHtml(bb.color)}" aria-label="Busbar color for ${escapeHtml(bb.name)}">
            </label>
            <input class="busbar-name" type="text" value="${escapeHtml(bb.name)}">
            <button class="busbar-dl" title="Download this busbar">${DL_ICON}</button>
            <button class="busbar-del" title="Delete">×</button>
        </div>
        <div class="busbar-meta">
            <span class="busbar-count">${bb.cellIndices.length} cell${bb.cellIndices.length === 1 ? '' : 's'}</span>
            <label class="busbar-overlap-label">
                <input class="busbar-overlap" type="checkbox" ${bb.overlapEnabled === true ? 'checked' : ''}>
                Overlap
            </label>
            <label class="busbar-overlap-size-label">Size
                <input class="busbar-overlap-size" type="number" value="${bb.overlapSize ?? 10}" step="0.5" min="0.5" ${bb.overlapEnabled === true ? '' : 'disabled'}>
            </label>
            <label class="busbar-thickness-label">Thickness
                <input class="busbar-thickness" type="number" value="${bb.thickness}" step="0.1" min="0.1">
            </label>
        </div>
        ${blockedByBusbarId[bb.id] ? `<div class="busbar-blocked">⚠ ${escapeHtml(blockedByBusbarId[bb.id])}</div>` : ''}
    `;

    row.addEventListener('click', (e) => {
        if (e.target.closest('input') || e.target.closest('button')) return;
        busbarStore.setActive(bb.id);
    });
    row.querySelector('.busbar-name').addEventListener('change', (e) => {
        busbarStore.rename(bb.id, e.target.value);
    });
    row.querySelector('.busbar-color').addEventListener('input', (e) => {
        busbarStore.setColor(bb.id, e.target.value);
    });
    row.querySelector('.busbar-overlap').addEventListener('change', (e) => {
        busbarStore.setOverlapEnabled(bb.id, e.target.checked);
    });
    row.querySelector('.busbar-overlap-size').addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (v > 0) busbarStore.setOverlapSize(bb.id, v);
    });
    row.querySelector('.busbar-thickness').addEventListener('change', (e) => {
        const v = parseFloat(e.target.value);
        if (v > 0) busbarStore.setThickness(bb.id, v);
    });
    row.querySelector('.busbar-dl').addEventListener('click', (e) => {
        e.stopPropagation();
        if (_onDownloadSingle) _onDownloadSingle(bb.id);
    });
    row.querySelector('.busbar-del').addEventListener('click', (e) => {
        e.stopPropagation();
        busbarStore.remove(bb.id);
    });
    return row;
}

export function renderBusbarList(blockedByBusbarId = {}) {
    const container = document.getElementById('busbarList');
    if (!container) return;
    container.innerHTML = '';
    syncThicknessVisibility();

    if (busbarStore.list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'busbar-empty';
        empty.textContent = 'No busbars. Add a Top or Bottom busbar then click cells in the preview.';
        container.appendChild(empty);
        return;
    }

    const facesToShow = faceFilter === 'top' ? ['top'] : ['top', 'bottom'];

    for (const face of facesToShow) {
        const faceBusbars = busbarStore.list.filter(bb => (bb.face || 'top') === face);
        const section = document.createElement('div');
        section.className = 'busbar-face-section';
        const label = document.createElement('div');
        label.className = 'busbar-face-label';
        label.textContent = face === 'top' ? 'Top Face' : 'Bottom Face';
        section.appendChild(label);

        if (faceBusbars.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'busbar-face-empty';
            empty.textContent = `No ${face} busbars.`;
            section.appendChild(empty);
        } else {
            faceBusbars.forEach(bb => section.appendChild(buildBusbarRow(bb, blockedByBusbarId)));
        }
        container.appendChild(section);
    }
}

export function initBusbarUI({ onDownloadSingle, onDownloadAll, onFaceFilterChange } = {}) {
    _onDownloadSingle = onDownloadSingle ?? null;
    _onDownloadAll    = onDownloadAll    ?? null;

    const addTopBtn = document.getElementById('addTopBusbarBtn');
    if (addTopBtn) addTopBtn.addEventListener('click', () => busbarStore.add('top'));

    const addBottomBtn = document.getElementById('addBottomBusbarBtn');
    if (addBottomBtn) addBottomBtn.addEventListener('click', () => busbarStore.add('bottom'));

    // Face filter buttons
    const bottomFaceWrap = document.getElementById('bottomFaceWrap');
    document.querySelectorAll('.face-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            faceFilter = btn.dataset.filter;
            document.querySelectorAll('.face-filter-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.filter === faceFilter);
            });
            if (bottomFaceWrap) bottomFaceWrap.hidden = (faceFilter === 'top');
            if (onFaceFilterChange) onFaceFilterChange(faceFilter);
            renderBusbarList();
        });
    });

    // Clear all markings button
    const clearBtn = document.getElementById('clearMarkingsBtn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            if (busbarStore.list.every(b => b.cellIndices.length === 0)) return;
            busbarStore.clearAllCells();
        });
    }

    // Download all as ZIP button
    const dlAllBtn = document.getElementById('downloadAllBusbarsBtn');
    if (dlAllBtn) {
        dlAllBtn.addEventListener('click', () => {
            if (_onDownloadAll) _onDownloadAll();
        });
    }

    // Re-sync thickness visibility when export format changes
    const fmtSelect = document.getElementById('busbarFormat');
    if (fmtSelect) {
        fmtSelect.addEventListener('change', syncThicknessVisibility);
    }
}

