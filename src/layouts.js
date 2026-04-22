import { positionCache } from './state.js';

export function generateGridLayout(xDim, yDim, spacing, cellSize) {
    const positions = [];
    const radius = cellSize / 2;
    const xStart = radius + spacing;
    const yStart = radius + spacing;

    for (let y = yStart; y + radius + spacing <= yDim; y += cellSize + spacing) {
        for (let x = xStart; x + radius + spacing <= xDim; x += cellSize + spacing) {
            positions.push([x, y]);
        }
    }
    return positions;
}

export function generateHoneycombLayout(xDim, yDim, spacing, cellSize) {
    const positions = [];
    const radius = cellSize / 2;
    let y = radius + spacing;
    let row = 0;

    while (y + radius + spacing <= yDim) {
        const xOffset = (row % 2 === 0) ? 0 : (cellSize + spacing) / 2;
        let x = radius + spacing + xOffset;

        while (x + radius + spacing <= xDim) {
            positions.push([x, y]);
            x += cellSize + spacing;
        }

        y += Math.sqrt(3) * (radius + spacing / 2);
        row++;
    }
    return positions;
}

export function generateVerticalHoneycombLayout(xDim, yDim, spacing, cellSize) {
    const positions = [];
    const radius = cellSize / 2;
    let x = radius + spacing;
    let col = 0;

    while (x + radius + spacing <= xDim) {
        const yOffset = (col % 2 === 0) ? 0 : (cellSize + spacing) / 2;
        let y = radius + spacing + yOffset;

        while (y + radius + spacing <= yDim) {
            positions.push([x, y]);
            y += cellSize + spacing;
        }

        x += Math.sqrt(3) * (radius + spacing / 2);
        col++;
    }
    return positions;
}

export function generateLayoutPositions(layoutType, xDim, yDim, spacing, cellSize) {
    if (layoutType === 'grid') return generateGridLayout(xDim, yDim, spacing, cellSize);
    if (layoutType === 'honeycomb') return generateHoneycombLayout(xDim, yDim, spacing, cellSize);
    return generateVerticalHoneycombLayout(xDim, yDim, spacing, cellSize);
}

export function getCachedPositions(xDim, yDim, spacing, cellSize, layoutType) {
    const configKey = `${xDim}_${yDim}_${spacing}_${cellSize}_${layoutType}`;

    if (positionCache.key === configKey && positionCache.positions) {
        return positionCache.positions;
    }

    const positions = generateLayoutPositions(layoutType, xDim, yDim, spacing, cellSize);
    positionCache.key = configKey;
    positionCache.positions = positions;
    return positions;
}
