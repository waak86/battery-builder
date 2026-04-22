import { busbarStore } from './busbars.js';

function escapeHtml(s) {
    return s.replace(/[&<>"']/g, ch => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[ch]));
}

export function renderBusbarList(blockedByBusbarId = {}) {
    const container = document.getElementById('busbarList');
    if (!container) return;
    container.innerHTML = '';

    if (busbarStore.list.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'busbar-empty';
        empty.textContent = 'No busbars. Click "Add Busbar" then click cells in the preview.';
        container.appendChild(empty);
        return;
    }

    busbarStore.list.forEach(bb => {
        const row = document.createElement('div');
        row.className = 'busbar-row' + (bb.id === busbarStore.activeId ? ' active' : '');
        row.dataset.id = bb.id;

        row.innerHTML = `
            <div class="busbar-header">
                <div class="busbar-swatch" style="background:${bb.color}"></div>
                <input class="busbar-name" type="text" value="${escapeHtml(bb.name)}">
                <button class="busbar-del" title="Delete">×</button>
            </div>
            <div class="busbar-meta">
                <span class="busbar-count">${bb.cellIndices.length} cell${bb.cellIndices.length === 1 ? '' : 's'}</span>
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
        row.querySelector('.busbar-thickness').addEventListener('change', (e) => {
            const v = parseFloat(e.target.value);
            if (v > 0) busbarStore.setThickness(bb.id, v);
        });
        row.querySelector('.busbar-del').addEventListener('click', (e) => {
            e.stopPropagation();
            busbarStore.remove(bb.id);
        });

        container.appendChild(row);
    });
}

export function initBusbarUI() {
    const addBtn = document.getElementById('addBusbarBtn');
    if (addBtn) {
        addBtn.addEventListener('click', () => busbarStore.add());
    }
}
