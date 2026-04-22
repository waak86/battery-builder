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

    subscribe(fn) {
        this.listeners.add(fn);
        return () => this.listeners.delete(fn);
    },

    _notify() {
        this.listeners.forEach(fn => fn());
    },

    add() {
        const busbar = {
            id: 'bb-' + (nextId++),
            name: `Busbar ${this.list.length + 1}`,
            color: PALETTE[paletteIdx % PALETTE.length],
            cellIndices: [],
            thickness: 1.0,
        };
        paletteIdx++;
        this.list.push(busbar);
        this.activeId = busbar.id;
        this._notify();
        return busbar;
    },

    remove(id) {
        this.list = this.list.filter(b => b.id !== id);
        if (this.activeId === id) {
            this.activeId = this.list.length ? this.list[0].id : null;
        }
        this._notify();
    },

    rename(id, name) {
        const b = this.list.find(b => b.id === id);
        if (b) { b.name = name; this._notify(); }
    },

    setColor(id, color) {
        const b = this.list.find(b => b.id === id);
        if (b) { b.color = color; this._notify(); }
    },

    setThickness(id, thickness) {
        const b = this.list.find(b => b.id === id);
        if (b) { b.thickness = thickness; this._notify(); }
    },

    setActive(id) {
        this.activeId = id;
        this._notify();
    },

    getActive() {
        return this.list.find(b => b.id === this.activeId) || null;
    },

    toggleCell(cellIndex) {
        const b = this.getActive();
        if (!b) return false;
        const idx = b.cellIndices.indexOf(cellIndex);
        if (idx >= 0) b.cellIndices.splice(idx, 1);
        else b.cellIndices.push(cellIndex);
        this._notify();
        return true;
    },

    clearAll() {
        if (this.list.length === 0) return;
        this.list = [];
        this.activeId = null;
        paletteIdx = 0;
        this._notify();
    },
};
