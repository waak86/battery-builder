import { ocRef } from './oc.js';

export function build3DBusbar(geometry, positions, padRadius, zBase, thickness) {
    const oc = ocRef.instance;
    if (!oc || geometry.padIndices.length === 0) return null;

    const shapes = [];
    const extraPads = Array.isArray(geometry.extraPads) ? geometry.extraPads : [];
    const extraSegments = Array.isArray(geometry.extraSegments) ? geometry.extraSegments : [];
    const cutouts = Array.isArray(geometry.cutouts) ? geometry.cutouts : [];

    for (const i of geometry.padIndices) {
        if (!positions[i]) continue;
        const [x, y] = positions[i];
        const ax = new oc.gp_Ax2(new oc.gp_Pnt(x, y, zBase), oc.gp.prototype.DZ());
        shapes.push(new oc.BRepPrimAPI_MakeCylinder(ax, padRadius, thickness).Shape());
    }

    for (const pad of extraPads) {
        const [x, y] = pad.pos;
        const radius = pad.radius ?? padRadius;
        const ax = new oc.gp_Ax2(new oc.gp_Pnt(x, y, zBase), oc.gp.prototype.DZ());
        shapes.push(new oc.BRepPrimAPI_MakeCylinder(ax, radius, thickness).Shape());
    }

    for (const edge of geometry.edges) {
        const pts = [positions[edge.from], ...edge.waypoints, positions[edge.to]];

        for (let k = 1; k < pts.length - 1; k++) {
            const [wx, wy] = pts[k];
            const ax = new oc.gp_Ax2(new oc.gp_Pnt(wx, wy, zBase), oc.gp.prototype.DZ());
            shapes.push(new oc.BRepPrimAPI_MakeCylinder(ax, padRadius, thickness).Shape());
        }

        for (let k = 0; k < pts.length - 1; k++) {
            const [x1, y1] = pts[k];
            const [x2, y2] = pts[k + 1];
            const dx = x2 - x1, dy = y2 - y1;
            const len = Math.hypot(dx, dy);
            if (len < 1e-6) continue;
            const angle = Math.atan2(dy, dx);

            const box = new oc.BRepPrimAPI_MakeBox(len, 2 * padRadius, thickness).Shape();

            const trans1 = new oc.gp_Trsf();
            trans1.SetTranslation(new oc.gp_Vec(0, -padRadius, 0));
            let shape = new oc.BRepBuilderAPI_Transform(box, trans1, false).Shape();

            const rot = new oc.gp_Trsf();
            rot.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), oc.gp.prototype.DZ()), angle);
            shape = new oc.BRepBuilderAPI_Transform(shape, rot, false).Shape();

            const trans2 = new oc.gp_Trsf();
            trans2.SetTranslation(new oc.gp_Vec(x1, y1, zBase));
            shape = new oc.BRepBuilderAPI_Transform(shape, trans2, false).Shape();

            shapes.push(shape);
        }
    }

    for (const segment of extraSegments) {
        const [x1, y1] = segment.from;
        const [x2, y2] = segment.to;
        const segmentRadius = segment.radius ?? padRadius;
        const dx = x2 - x1, dy = y2 - y1;
        const len = Math.hypot(dx, dy);
        if (len < 1e-6) continue;
        const angle = Math.atan2(dy, dx);

        const box = new oc.BRepPrimAPI_MakeBox(len, 2 * segmentRadius, thickness).Shape();

        const trans1 = new oc.gp_Trsf();
        trans1.SetTranslation(new oc.gp_Vec(0, -segmentRadius, 0));
        let shape = new oc.BRepBuilderAPI_Transform(box, trans1, false).Shape();

        const rot = new oc.gp_Trsf();
        rot.SetRotation(new oc.gp_Ax1(new oc.gp_Pnt(0, 0, 0), oc.gp.prototype.DZ()), angle);
        shape = new oc.BRepBuilderAPI_Transform(shape, rot, false).Shape();

        const trans2 = new oc.gp_Trsf();
        trans2.SetTranslation(new oc.gp_Vec(x1, y1, zBase));
        shape = new oc.BRepBuilderAPI_Transform(shape, trans2, false).Shape();

        shapes.push(shape);
    }

    if (shapes.length === 0) return null;
    let combined = shapes[0];
    for (let i = 1; i < shapes.length; i++) {
        combined = new oc.BRepAlgoAPI_Fuse(combined, shapes[i]).Shape();
    }

    for (const cutout of cutouts) {
        const [cx, cy] = cutout.center;
        const width = cutout.width;
        const height = cutout.height;
        const cutter = new oc.BRepPrimAPI_MakeBox(width, height, thickness).Shape();

        const trans = new oc.gp_Trsf();
        trans.SetTranslation(new oc.gp_Vec(cx - width / 2, cy - height / 2, zBase));
        const placedCutter = new oc.BRepBuilderAPI_Transform(cutter, trans, false).Shape();
        combined = new oc.BRepAlgoAPI_Cut(combined, placedCutter).Shape();
    }

    return combined;
}
