import { ocRef } from './oc.js';

export function create3DModel(positions, config) {
    const oc = ocRef.instance;
    if (!oc || positions.length === 0) return null;

    const {
        cellSize,
        spacing,
        height,
        terminalDiameter,
        terminalDepth,
        coverThickness,
        ledgeWidth,
        roundedCorners,
        bmsHoles,
        useTabs,
        useFullCircles,
        filletBms,
    } = config;

    const r = cellSize / 2;

    const minX = Math.min(...positions.map(p => p[0])) - r - spacing;
    const minY = Math.min(...positions.map(p => p[1])) - r - spacing;
    const maxX = Math.max(...positions.map(p => p[0])) + r + spacing;
    const maxY = Math.max(...positions.map(p => p[1])) + r + spacing;

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    const adjusted = positions.map(([x, y]) => [x - centerX, y - centerY]);

    const width = maxX - minX;
    const length = maxY - minY;

    const perfStart = performance.now();
    let perfLast = perfStart;
    const logTime = (label) => {
        const now = performance.now();
        perfLast = now;
    };

    const boxMaker = new oc.BRepPrimAPI_MakeBox(width, length, height);
    let base = boxMaker.Shape();
    const translation = new oc.gp_Trsf();
    translation.SetTranslation(new oc.gp_Vec(-width / 2, -length / 2, 0));
    const transform = new oc.BRepBuilderAPI_Transform(base, translation, false);
    base = transform.Shape();

    if (roundedCorners) {
        try {
            const cornerRadius = 5.0;

            const forEachEdge = (shape, callback) => {
                const edgeHashes = {};
                let edgeIndex = 0;
                const anExplorer = new oc.TopExp_Explorer(shape, oc.TopAbs_EDGE);
                for (anExplorer.Init(shape, oc.TopAbs_EDGE); anExplorer.More(); anExplorer.Next()) {
                    const edge = oc.TopoDS.prototype.Edge(anExplorer.Current());
                    const edgeHash = edge.HashCode(100000000);
                    if (!edgeHashes.hasOwnProperty(edgeHash)) {
                        edgeHashes[edgeHash] = edgeIndex;
                        callback(edgeIndex++, edge);
                    }
                }
                return edgeHashes;
            };

            const verticalEdgeIndices = [];
            forEachEdge(base, (index, edge) => {
                try {
                    const bbox = new oc.Bnd_Box();
                    oc.BRepBndLib.prototype.Add(edge, bbox, false);
                    const bboxMin = bbox.CornerMin();
                    const bboxMax = bbox.CornerMax();
                    const dx = Math.abs(bboxMax.X() - bboxMin.X());
                    const dy = Math.abs(bboxMax.Y() - bboxMin.Y());
                    const dz = Math.abs(bboxMax.Z() - bboxMin.Z());
                    if (dx < 1.0 && dy < 1.0 && dz > height * 0.8) {
                        verticalEdgeIndices.push(index);
                    }
                } catch (e) { /* ignore */ }
            });

            if (verticalEdgeIndices.length > 0) {
                const mkFillet = new oc.BRepFilletAPI_MakeFillet(base);
                let edgeCount = 0;
                forEachEdge(base, (index, edge) => {
                    if (verticalEdgeIndices.includes(index)) {
                        try {
                            mkFillet.Add(cornerRadius, edge);
                            edgeCount++;
                        } catch (e) {
                            console.error(`    Failed to add edge ${index}:`, e.message);
                        }
                    }
                });
                if (edgeCount > 0) {
                    base = new oc.TopoDS_Solid(mkFillet.Shape());
                    console.log('  Applied rounded corners');
                    logTime('Rounded corners');
                }
            } else {
                console.log('  No vertical edges found to fillet');
            }
        } catch (e) {
            console.error('  Fillet operation failed:', e.message);
            console.log('  Continuing without rounded corners');
        }
    }

    // Build cell hole cutters.
    // When a ledge is requested (ledgeWidth > 0 || coverThickness > 0) we use a
    // two-step bore so the ledge ring stays part of the base body:
    //   • outer bore  (radius r)               from z=coverThickness to z=height
    //   • inner bore  (radius r - ledgeWidth)  from z=0             to z=height
    const hasLedge = (ledgeWidth > 0 || coverThickness > 0);

    if (!hasLedge) {
        const cutters = adjusted.map(([x, y]) => {
            const ax = new oc.gp_Ax2(new oc.gp_Pnt(x, y, 0), oc.gp.prototype.DZ());
            return new oc.BRepPrimAPI_MakeCylinder(ax, r, height).Shape();
        });
        let allCutters = cutters[0];
        for (let i = 1; i < cutters.length; i++) {
            allCutters = new oc.BRepAlgoAPI_Fuse(allCutters, cutters[i]).Shape();
        }
        base = new oc.BRepAlgoAPI_Cut(base, allCutters).Shape();
    } else {
        const outerZ = coverThickness;
        const outerH = height - coverThickness;
        const innerR = Math.max(0.1, r - ledgeWidth);

        const outerCutters = adjusted.map(([x, y]) => {
            const ax = new oc.gp_Ax2(new oc.gp_Pnt(x, y, outerZ), oc.gp.prototype.DZ());
            return new oc.BRepPrimAPI_MakeCylinder(ax, r, outerH).Shape();
        });
        let allOuter = outerCutters[0];
        for (let i = 1; i < outerCutters.length; i++) {
            allOuter = new oc.BRepAlgoAPI_Fuse(allOuter, outerCutters[i]).Shape();
        }
        base = new oc.BRepAlgoAPI_Cut(base, allOuter).Shape();

        const innerCutters = adjusted.map(([x, y]) => {
            const ax = new oc.gp_Ax2(new oc.gp_Pnt(x, y, 0), oc.gp.prototype.DZ());
            return new oc.BRepPrimAPI_MakeCylinder(ax, innerR, height).Shape();
        });
        let allInner = innerCutters[0];
        for (let i = 1; i < innerCutters.length; i++) {
            allInner = new oc.BRepAlgoAPI_Fuse(allInner, innerCutters[i]).Shape();
        }
        base = new oc.BRepAlgoAPI_Cut(base, allInner).Shape();
    }
    console.log('  Cell holes cut' + (hasLedge ? ' (with integrated ledge)' : ''));
    logTime('Cell holes');

    if (bmsHoles) {
        const holeDiameter = config.bmsHoleDiameter || 4.0;

        let holeYTop, holeYBottom;
        if (useFullCircles) {
            holeYTop = null;
            holeYBottom = null;
        } else {
            holeYTop = length / 2;
            holeYBottom = -length / 2;
        }

        const rows = {};
        adjusted.forEach(([x, y]) => {
            const yKey = Math.round(y * 1000);
            if (!rows[yKey]) rows[yKey] = [];
            rows[yKey].push([x, y]);
        });

        const rowKeys = Object.keys(rows).map(k => parseInt(k)).sort((a, b) => b - a);
        const topYKey = rowKeys[0];
        const bottomYKey = rowKeys[rowKeys.length - 1];

        if (useFullCircles) {
            const topCellY = rows[topYKey][0][1];
            const bottomCellY = rows[bottomYKey][0][1];
            const wallTop = length / 2;
            const wallBottom = -length / 2;

            const solveEquilateral3D = (wallY, cellY, x1, x2) => {
                const xMid = (x1 + x2) / 2;
                const flip = cellY < wallY ? -1 : 1;
                let lo = flip > 0 ? -Math.PI / 2 : 0;
                let hi = flip > 0 ? 0 : Math.PI / 2;
                for (let i = 0; i < 80; i++) {
                    const alpha = (lo + hi) / 2;
                    const Bx = x1 + r * Math.cos(alpha);
                    const By = cellY + r * Math.sin(alpha);
                    const d = xMid - Bx;
                    const h = (By - wallY) * flip;
                    const diff = h - d * Math.sqrt(3);
                    if (Math.abs(diff) < 1e-8) break;
                    if (diff < 0) { flip > 0 ? (lo = alpha) : (hi = alpha); }
                    else          { flip > 0 ? (hi = alpha) : (lo = alpha); }
                }
                const alpha = (lo + hi) / 2;
                const By = cellY + r * Math.sin(alpha);
                return (wallY + 2 * By) / 3;
            };

            holeYTop    = solveEquilateral3D(wallTop,    topCellY,    rows[topYKey][0][0],    rows[topYKey][1][0]);
            holeYBottom = solveEquilateral3D(wallBottom, bottomCellY, rows[bottomYKey][0][0], rows[bottomYKey][1][0]);
        }

        const topRow = rows[topYKey].sort((a, b) => a[0] - b[0]);
        const bottomRow = rows[bottomYKey].sort((a, b) => a[0] - b[0]);

        const topHoles = [];
        for (let i = 0; i < topRow.length - 1; i++) {
            const xMid = (topRow[i][0] + topRow[i + 1][0]) / 2;
            topHoles.push([xMid, holeYTop]);
        }

        const bottomHoles = [];
        for (let i = 0; i < bottomRow.length - 1; i++) {
            const xMid = (bottomRow[i][0] + bottomRow[i + 1][0]) / 2;
            bottomHoles.push([xMid, holeYBottom]);
        }

        const allBmsHoles = [...topHoles, ...bottomHoles];

        if (useTabs) {
            const slotWidth = config.tabWidth || holeDiameter;
            const slotInset = config.tabDepth || 1.0;
            const topEdgeY = length / 2;
            const bottomEdgeY = -length / 2;

            const allSlots = [];

            topHoles.forEach(([xPos]) => {
                const slotBox = new oc.BRepPrimAPI_MakeBox(slotWidth, slotInset, height);
                const slot = slotBox.Shape();
                const trans = new oc.gp_Trsf();
                trans.SetTranslation(new oc.gp_Vec(xPos - slotWidth / 2, topEdgeY - slotInset, 0));
                const slotTransform = new oc.BRepBuilderAPI_Transform(slot, trans, false);
                allSlots.push(slotTransform.Shape());
            });

            bottomHoles.forEach(([xPos]) => {
                const slotBox = new oc.BRepPrimAPI_MakeBox(slotWidth, slotInset, height);
                const slot = slotBox.Shape();
                const trans = new oc.gp_Trsf();
                trans.SetTranslation(new oc.gp_Vec(xPos - slotWidth / 2, bottomEdgeY, 0));
                const slotTransform = new oc.BRepBuilderAPI_Transform(slot, trans, false);
                allSlots.push(slotTransform.Shape());
            });

            if (allSlots.length > 0) {
                if (allSlots.length === 1) {
                    base = new oc.BRepAlgoAPI_Cut(base, allSlots[0]).Shape();
                } else {
                    let compound = allSlots[0];
                    for (let i = 1; i < allSlots.length; i++) {
                        compound = new oc.BRepAlgoAPI_Fuse(compound, allSlots[i]).Shape();
                    }
                    base = new oc.BRepAlgoAPI_Cut(base, compound).Shape();
                }
            }
            logTime('Edge tabs');
        } else {
            if (allBmsHoles.length <= 10) {
                allBmsHoles.forEach(([x, y]) => {
                    const cylinderAxis = new oc.gp_Ax2(new oc.gp_Pnt(x, y, 0), oc.gp.prototype.DZ());
                    const cylinder = new oc.BRepPrimAPI_MakeCylinder(cylinderAxis, holeDiameter / 2, height).Shape();
                    base = new oc.BRepAlgoAPI_Cut(base, cylinder).Shape();
                });
            } else {
                const bmsCylinders = allBmsHoles.map(([x, y]) => {
                    const cylinderAxis = new oc.gp_Ax2(new oc.gp_Pnt(x, y, 0), oc.gp.prototype.DZ());
                    return new oc.BRepPrimAPI_MakeCylinder(cylinderAxis, holeDiameter / 2, height).Shape();
                });

                let compound = bmsCylinders[0];
                for (let i = 1; i < bmsCylinders.length; i++) {
                    compound = new oc.BRepAlgoAPI_Fuse(compound, bmsCylinders[i]).Shape();
                }
                base = new oc.BRepAlgoAPI_Cut(base, compound).Shape();
            }

            logTime('BMS holes');

            if (filletBms && allBmsHoles.length > 0) {
                try {
                    console.log('  Filleting BMS hole edges...');
                    const bmsFilletRadius = 0.5;

                    const forEachEdge = (shape, callback) => {
                        const edgeHashes = {};
                        let edgeIndex = 0;
                        const anExplorer = new oc.TopExp_Explorer(shape, oc.TopAbs_EDGE);
                        for (anExplorer.Init(shape, oc.TopAbs_EDGE); anExplorer.More(); anExplorer.Next()) {
                            const edge = oc.TopoDS.prototype.Edge(anExplorer.Current());
                            const edgeHash = edge.HashCode(100000000);
                            if (!edgeHashes.hasOwnProperty(edgeHash)) {
                                edgeHashes[edgeHash] = edgeIndex;
                                callback(edgeIndex++, edge);
                            }
                        }
                        return edgeHashes;
                    };

                    const bmsEdgeIndices = [];

                    forEachEdge(base, (index, edge) => {
                        try {
                            const bbox = new oc.Bnd_Box();
                            oc.BRepBndLib.prototype.Add(edge, bbox, false);
                            const bboxMin = bbox.CornerMin();
                            const bboxMax = bbox.CornerMax();
                            const centerX = (bboxMin.X() + bboxMax.X()) / 2;
                            const centerY = (bboxMin.Y() + bboxMax.Y()) / 2;
                            const centerZ = (bboxMin.Z() + bboxMax.Z()) / 2;

                            for (const [holeX, holeY] of allBmsHoles) {
                                const distXY = Math.hypot(centerX - holeX, centerY - holeY);
                                const isNearHole = distXY < holeDiameter;
                                const isAtTopOrBottom = Math.abs(centerZ - 0) < 1.0 || Math.abs(centerZ - height) < 1.0;
                                if (isNearHole && isAtTopOrBottom) {
                                    bmsEdgeIndices.push(index);
                                    break;
                                }
                            }
                        } catch (e) { /* ignore */ }
                    });

                    if (bmsEdgeIndices.length > 0) {
                        const mkFillet = new oc.BRepFilletAPI_MakeFillet(base);
                        let edgeCount = 0;
                        forEachEdge(base, (index, edge) => {
                            if (bmsEdgeIndices.includes(index)) {
                                try {
                                    mkFillet.Add(bmsFilletRadius, edge);
                                    edgeCount++;
                                } catch (e) {
                                    console.error(`    Failed to add BMS edge ${index}`);
                                }
                            }
                        });
                        if (edgeCount > 0) {
                            base = new oc.TopoDS_Solid(mkFillet.Shape());
                            console.log(`  Applied ${bmsFilletRadius}mm fillet to ${edgeCount} BMS hole edges`);
                        }
                    }
                } catch (e) {
                    console.error('  BMS fillet failed:', e.message);
                    console.log('  Continuing without BMS filleting');
                }
            }
        }
    }

    if (adjusted.length <= 10) {
        adjusted.forEach(([x, y]) => {
            const cylinderAxis = new oc.gp_Ax2(new oc.gp_Pnt(x, y, height - terminalDepth), oc.gp.prototype.DZ());
            const cylinder = new oc.BRepPrimAPI_MakeCylinder(cylinderAxis, terminalDiameter / 2, terminalDepth).Shape();
            base = new oc.BRepAlgoAPI_Cut(base, cylinder).Shape();
        });
    } else {
        const terminals = adjusted.map(([x, y]) => {
            const cylinderAxis = new oc.gp_Ax2(new oc.gp_Pnt(x, y, height - terminalDepth), oc.gp.prototype.DZ());
            return new oc.BRepPrimAPI_MakeCylinder(cylinderAxis, terminalDiameter / 2, terminalDepth).Shape();
        });

        const batchSize = 30;
        const batches = [];

        for (let i = 0; i < terminals.length; i += batchSize) {
            const end = Math.min(i + batchSize, terminals.length);
            let batch = terminals[i];
            for (let j = i + 1; j < end; j++) {
                batch = new oc.BRepAlgoAPI_Fuse(batch, terminals[j]).Shape();
            }
            batches.push(batch);
        }

        let allTerminals = batches[0];
        for (let i = 1; i < batches.length; i++) {
            allTerminals = new oc.BRepAlgoAPI_Fuse(allTerminals, batches[i]).Shape();
        }

        base = new oc.BRepAlgoAPI_Cut(base, allTerminals).Shape();
    }

    console.log('  Terminal recesses cut');
    logTime('Terminal recesses');

    if (hasLedge) {
        console.log('  Ledge integrated into cell holes');
    }
    logTime('Ledge rings');
    logTime('TOTAL GENERATION');

    return base;
}
