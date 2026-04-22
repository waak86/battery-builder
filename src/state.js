export const canvasState = {
    zoom: 1.0,
    panX: 0,
    panY: 0,
    isDragging: false,
    dragStartX: 0,
    dragStartY: 0,
    dragMoved: false,
    lastMouseX: 0,
    lastMouseY: 0,
    currentPositions: [],
    currentCellSize: 18,
    viewTransform: null,
};

export const positionCache = {
    key: null,
    positions: null,
};
