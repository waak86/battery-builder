const PALETTE = [
    '#ef4444', '#f59e0b', '#10b981', '#3b82f6',
    '#a855f7', '#ec4899', '#14b8a6', '#f97316',
];

let nextId = 1;
let paletteIdx = 0;

export const busbarStore = {
    list: [],
    activeId: null,
    listeners: new Set(),
    mutationListeners: new Set(),

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    },

    subscribeMutations(fn) {
        this.mutationListeners.add(fn);
        return () => this.mutationListeners.delete(fn);
    },

    _emitMutation(reason) {
        this.mutationListeners.forEach(fn => fn(reason));
    },

    _notify() {
        this.listeners.forEach(fn => fn());
    },

    getSnapshot() {
        return {
            activeId: this.activeId,
            list: this.list.map((b) => ({
                id: b.id,
                name: b.name,
                color: b.color,
                cellIndices: Array.isArray(b.cellIndices) ? [...b.cellIndices] : [],
                thickness: b.thickness,
                overlapEnabled: b.overlapEnabled === true,
                overlapSize: Number.isFinite(Number(b.overlapSize)) && Number(b.overlapSize) > 0
                    ? Number(b.overlapSize)
                    : 10,
                face: b.face === 'bottom' ? 'bottom' : 'top',
            })),
        };
    },

    replaceFromSnapshot(snapshot) {
        const incoming = snapshot && Array.isArray(snapshot.list) ? snapshot.list : [];
        this.list = incoming.map((b, i) => ({
            id: typeof b.id === 'string' && b.id ? b.id : `bb-${i + 1}`,
            name: typeof b.name === 'string' && b.name ? b.name : `Busbar ${i + 1}`,
            color: typeof b.color === 'string' && b.color ? b.color : PALETTE[i % PALETTE.length],
            cellIndices: Array.isArray(b.cellIndices)
                ? b.cellIndices
                    .map((idx) => Number(idx))
                    .filter((idx) => Number.isInteger(idx) && idx >= 0)
                : [],
            thickness: Number.isFinite(Number(b.thickness)) && Number(b.thickness) > 0
                ? Number(b.thickness)
                : 1.0,
            overlapEnabled: b.overlapEnabled === true,
            overlapSize: Number.isFinite(Number(b.overlapSize)) && Number(b.overlapSize) > 0
                ? Number(b.overlapSize)
                : 10,
            face: b.face === 'bottom' ? 'bottom' : 'top',
        }));

        if (typeof snapshot?.activeId === 'string' && this.list.some((b) => b.id === snapshot.activeId)) {
            this.activeId = snapshot.activeId;
        } else {
            this.activeId = this.list.length ? this.list[0].id : null;
        }

        const numericIdMax = this.list.reduce((max, b) => {
            const n = parseInt(String(b.id).replace(/^bb-/, ''), 10);
            return Number.isFinite(n) ? Math.max(max, n) : max;
        }, 0);
        nextId = numericIdMax + 1;
        paletteIdx = this.list.length;
        this._emitMutation('replaceFromSnapshot');
        this._notify();
    },

    add(face = 'top') {
        const otherFace = face === 'bottom' ? 'top' : 'bottom';
        const usedByOther = new Set(this.list.filter(b => b.face === otherFace).map(b => b.color));
        const usedBySame  = new Set(this.list.filter(b => b.face === face).map(b => b.color));
        // Prefer a color unused by both faces; fall back to one unused by the opposite face.
        let color = PALETTE.find(c => !usedByOther.has(c) && !usedBySame.has(c));
        if (!color) color = PALETTE.find(c => !usedByOther.has(c));
        if (!color) color = PALETTE[paletteIdx % PALETTE.length];

        const busbar = {
            id: 'bb-' + (nextId++),
            name: `Busbar ${this.list.length + 1}`,
            color,
            cellIndices: [],
            thickness: 1.0,
            overlapEnabled: false,
            overlapSize: 10,
            face: face === 'bottom' ? 'bottom' : 'top',
        };
        paletteIdx++;
        this.list.push(busbar);
        this.activeId = busbar.id;
        this._emitMutation('add');
        this._notify();
        return busbar;
    },

    remove(id) {
        this.list = this.list.filter(b => b.id !== id);
        if (this.activeId === id) {
            this.activeId = this.list.length ? this.list[0].id : null;
        }
        this._emitMutation('remove');
        this._notify();
    },

    rename(id, name) {
        const b = this.list.find(b => b.id === id);
        if (b) {
            b.name = name;
            this._emitMutation('rename');
            this._notify();
        }
    },

    setColor(id, color) {
        const b = this.list.find(b => b.id === id);
        if (b) {
            b.color = color;
            this._emitMutation('setColor');
            this._notify();
        }
    },

    setThickness(id, thickness) {
        const b = this.list.find(b => b.id === id);
        if (b) {
            b.thickness = thickness;
            this._emitMutation('setThickness');
            this._notify();
        }
    },

    setOverlapEnabled(id, overlapEnabled) {
        const b = this.list.find(b => b.id === id);
        if (b) {
            b.overlapEnabled = overlapEnabled === true;
            this._emitMutation('setOverlapEnabled');
            this._notify();
        }
    },

    setOverlapSize(id, overlapSize) {
        const b = this.list.find(b => b.id === id);
        if (b && Number.isFinite(Number(overlapSize)) && Number(overlapSize) > 0) {
            b.overlapSize = Number(overlapSize);
            this._emitMutation('setOverlapSize');
            this._notify();
        }
    },

    setFace(id, face) {
        const b = this.list.find(b => b.id === id);
        if (b) {
            b.face = face === 'bottom' ? 'bottom' : 'top';
            this._emitMutation('setFace');
            this._notify();
        }
    },

    setActive(id) {
        this.activeId = id;
        this._emitMutation('setActive');
        this._notify();
    },

    getActive() {
        return this.list.find(b => b.id === this.activeId) || null;
    },

    toggleCell(cellIndex) {
        const b = this.getActive();
        if (!b) return false;
        const idx = b.cellIndices.indexOf(cellIndex);
        if (idx >= 0) {
            // Always allow un-assigning.
            b.cellIndices.splice(idx, 1);
        } else {
            // Block only if another busbar on the SAME face already owns this cell.
            const owner = this.list.find(
                other => other.id !== b.id &&
                         (other.face || 'top') === (b.face || 'top') &&
                         other.cellIndices.includes(cellIndex)
            );
            if (owner) return false;
            b.cellIndices.push(cellIndex);
        }
        this._emitMutation('toggleCell');
        this._notify();
        return true;
    },

    clearAll() {
        if (this.list.length === 0) return;
        this.list = [];
        this.activeId = null;
        paletteIdx = 0;
        nextId = 1;
        this._emitMutation('clearAll');
        this._notify();
    },

    clearAllCells() {
        if (this.list.every(b => b.cellIndices.length === 0)) return;
        this.list.forEach(b => { b.cellIndices = []; });
        this._emitMutation('clearAllCells');
        this._notify();
    },
};
