const WIDTHS  = [50, 100, 150, 200, 300];
const LENGTHS = [300, 1000, 1500];

function calcCuts(sheetW, sheetL, busbarW, busbarH) {
    if (busbarW <= 0 || busbarH <= 0) return 0;
    const orientA = Math.floor(sheetW / busbarW) * Math.floor(sheetL / busbarH);
    const orientB = Math.floor(sheetW / busbarH) * Math.floor(sheetL / busbarW);
    return Math.max(orientA, orientB);
}

export function renderOrderSection({ busbarSheets, busbarsNeeded }) {
    const container = document.getElementById('orderContent');
    if (!container) return;

    const defined   = busbarSheets.length;
    const nonEmpty  = busbarSheets.filter(b => !b.empty);
    const emptyOnes = busbarSheets.filter(b => b.empty);
    const missing   = busbarsNeeded - defined;   // negative = too many defined, 0 = exact, positive = missing

    // ── Warnings ─────────────────────────────────────────────────────────────
    let warnings = '';
    if (defined === 0) {
        warnings += `<div class="order-warning">No busbars defined. Add busbars in the list above and assign cells by clicking them in the preview.</div>`;
    } else {
        if (missing > 0) {
            warnings += `<div class="order-warning">${missing} busbar${missing > 1 ? 's' : ''} missing &mdash; need ${busbarsNeeded}, have ${defined}.</div>`;
        }
        if (emptyOnes.length > 0) {
            const names = emptyOnes.map(b => `<strong>${escHtml(b.name)}</strong>`).join(', ');
            warnings += `<div class="order-warning">${names} ${emptyOnes.length === 1 ? 'has' : 'have'} no cells assigned &mdash; click cells in the preview to assign them.</div>`;
        }
    }

    // ── Nothing to calculate ─────────────────────────────────────────────────
    if (nonEmpty.length === 0) {
        container.innerHTML = warnings +
            `<p class="order-placeholder">Assign cells to busbars to calculate sheet requirements.</p>`;
        return;
    }

    // ── Max sheet dimensions (largest busbar drives the order size) ───────────
    const maxW       = Math.max(...nonEmpty.map(b => b.w));
    const maxH       = Math.max(...nonEmpty.map(b => b.h));
    const totalSheets = busbarsNeeded;          // what we actually need to order
    const totalAreaCm2  = (maxW * maxH * totalSheets / 100).toFixed(1);
    const singleAreaCm2 = (maxW * maxH / 100).toFixed(1);

    // ── Per-busbar size breakdown (only when sizes differ) ────────────────────
    const sizesVary = nonEmpty.some(b => Math.abs(b.w - maxW) > 0.5 || Math.abs(b.h - maxH) > 0.5);
    let perBusbarHtml = '';
    if (sizesVary) {
        perBusbarHtml = `<div class="order-busbar-sizes">`;
        for (const b of nonEmpty) {
            perBusbarHtml += `<div class="order-busbar-size-row">
                <span class="order-label">${escHtml(b.name)}</span>
                <span class="order-value">${b.w.toFixed(0)} &times; ${b.h.toFixed(0)} mm &nbsp;<span class="order-muted">(${(b.w * b.h / 100).toFixed(1)} cm²)</span></span>
            </div>`;
        }
        perBusbarHtml += `</div>`;
    }

    // ── Sheet table ───────────────────────────────────────────────────────────
    const rows = [];
    for (const w of WIDTHS) {
        for (const l of LENGTHS) {
            const cuts   = calcCuts(w, l, maxW, maxH);
            const sheets = cuts > 0 ? Math.ceil(totalSheets / cuts) : null;
            rows.push({ w, l, cuts, sheets });
        }
    }
    const fittingSheets = rows.filter(r => r.sheets !== null).map(r => r.sheets);
    const bestSheets    = fittingSheets.length > 0 ? Math.min(...fittingSheets) : null;

    let tableHtml = `
        <table class="order-table">
            <thead>
                <tr>
                    <th>Sheet (W&times;L mm)</th>
                    <th>Cuts / sheet</th>
                    <th>Sheets to buy</th>
                </tr>
            </thead>
            <tbody>
    `;
    for (const { w, l, cuts, sheets } of rows) {
        const noFit  = cuts === 0;
        const isBest = !noFit && sheets === bestSheets;
        const cls    = noFit ? 'order-row-nofit' : (isBest ? 'order-row-best' : '');
        tableHtml += `
            <tr class="${cls}">
                <td>${w} &times; ${l}</td>
                <td>${noFit ? '&mdash;' : cuts}</td>
                <td>${noFit ? '&mdash;' : sheets}</td>
            </tr>
        `;
    }
    tableHtml += `</tbody></table>`;

    // ── Summary ───────────────────────────────────────────────────────────────
    const summaryHtml = `
        <div class="order-summary">
            <div class="order-summary-row">
                <span class="order-label">Largest busbar</span>
                <span class="order-value">${maxW.toFixed(0)} &times; ${maxH.toFixed(0)} mm</span>
            </div>
            <div class="order-summary-row">
                <span class="order-label">Sheets needed</span>
                <span class="order-value">${totalSheets}</span>
            </div>
            <div class="order-summary-row">
                <span class="order-label">Total copper area</span>
                <span class="order-value">${totalAreaCm2} cm² <span class="order-muted">(${singleAreaCm2} cm² each)</span></span>
            </div>
        </div>
    `;

    container.innerHTML = warnings + summaryHtml + perBusbarHtml + tableHtml;
}

function escHtml(s) {
    return String(s).replace(/[&<>"']/g, ch => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
    ));
}
