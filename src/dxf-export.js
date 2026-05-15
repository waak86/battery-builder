// DXF (AutoCAD R12) writer that emits only the union outline of the busbar body
// (pads + capsule rectangles). Each pad contributes the arcs of its circle that
// aren't covered by an attached capsule's half-disc; each capsule contributes the
// portions of its two side lines that lie outside every other primitive. CAM
// software stitches the resulting ARC + LINE entities into closed cut paths.

function dxfHeader() {
    return [
        '0', 'SECTION',
        '2', 'HEADER',
        '9', '$ACADVER', '1', 'AC1009',
        '9', '$INSUNITS', '70', '4',
        '0', 'ENDSEC',
    ];
}

function dxfTables() {
    return [
        '0', 'SECTION',
        '2', 'TABLES',
        '0', 'TABLE', '2', 'LAYER', '70', '1',
        '0', 'LAYER', '2', 'busbar', '70', '0', '62', '7', '6', 'CONTINUOUS',
        '0', 'ENDTAB',
        '0', 'ENDSEC',
    ];
}

function circleEntity(cx, cy, r, layer) {
    return [
        '0', 'CIRCLE', '8', layer,
        '10', cx.toFixed(4), '20', cy.toFixed(4), '30', '0.0',
        '40', r.toFixed(4),
    ];
}

function arcEntity(cx, cy, r, startRad, endRad, layer) {
    const toDeg = (a) => (a * 180 / Math.PI);
    return [
        '0', 'ARC', '8', layer,
        '10', cx.toFixed(4), '20', cy.toFixed(4), '30', '0.0',
        '40', r.toFixed(4),
        '50', toDeg(startRad).toFixed(4),
        '51', toDeg(endRad).toFixed(4),
    ];
}

function lineEntity(x1, y1, x2, y2, layer) {
    return [
        '0', 'LINE', '8', layer,
        '10', x1.toFixed(4), '20', y1.toFixed(4), '30', '0.0',
        '11', x2.toFixed(4), '21', y2.toFixed(4), '31', '0.0',
    ];
}

const TWO_PI = 2 * Math.PI;
const EPS = 1e-5;
const normAngle = (a) => { const m = a % TWO_PI; return m < 0 ? m + TWO_PI : m; };
const angularDist = (a, b) => {
    const d = Math.abs(normAngle(a) - normAngle(b));
    return d > Math.PI ? TWO_PI - d : d;
};

// Clip a segment against a circle disc. Returns [[t0, t1], ...] intervals in [0, 1]
// where the segment lies strictly inside the disc (radius r at center c).
function segInsideCircle(p, q, c, r) {
    const dx = q[0] - p[0], dy = q[1] - p[1];
    const fx = p[0] - c[0], fy = p[1] - c[1];
    const A = dx * dx + dy * dy;
    if (A < EPS) return [];
    const B = 2 * (fx * dx + fy * dy);
    const C = fx * fx + fy * fy - r * r;
    const disc = B * B - 4 * A * C;
    if (disc <= 0) return [];
    const sq = Math.sqrt(disc);
    const t1 = (-B - sq) / (2 * A);
    const t2 = (-B + sq) / (2 * A);
    const lo = Math.max(0, t1);
    const hi = Math.min(1, t2);
    if (hi - lo < EPS) return [];
    return [[lo, hi]];
}

// Clip a segment against a rotated axis-aligned capsule rectangle (Minkowski body
// without the end caps). Returns intervals in [0, 1] strictly inside the rectangle.
function segInsideCapsule(p, q, aStart, aEnd, halfWidth) {
    const ax = aStart[0], ay = aStart[1];
    const bx = aEnd[0], by = aEnd[1];
    const ux = bx - ax, uy = by - ay;
    const len = Math.hypot(ux, uy);
    if (len < EPS) return [];
    const cos = ux / len, sin = uy / len;
    const toLocal = (pt) => [
        (pt[0] - ax) * cos + (pt[1] - ay) * sin,
        -(pt[0] - ax) * sin + (pt[1] - ay) * cos,
    ];
    const lp = toLocal(p);
    const lq = toLocal(q);
    // Liang–Barsky against [0, len] × [-halfWidth, halfWidth].
    let t0 = 0, t1 = 1;
    const dx = lq[0] - lp[0], dy = lq[1] - lp[1];
    const tests = [
        [-dx, lp[0] - 0],
        [ dx, len - lp[0]],
        [-dy, lp[1] - (-halfWidth)],
        [ dy, halfWidth - lp[1]],
    ];
    for (const [pp, qq] of tests) {
        if (Math.abs(pp) < EPS) {
            if (qq < -EPS) return [];
        } else {
            const r = qq / pp;
            if (pp < 0) { if (r > t1 + EPS) return []; if (r > t0) t0 = r; }
            else        { if (r < t0 - EPS) return []; if (r < t1) t1 = r; }
        }
    }
    if (t1 - t0 < EPS) return [];
    return [[t0, t1]];
}

function subtractIntervals(intervals) {
    const sorted = intervals.slice().sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of sorted) {
        if (merged.length && iv[0] <= merged[merged.length - 1][1] + EPS) {
            merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
        } else {
            merged.push([iv[0], iv[1]]);
        }
    }
    const outside = [];
    let last = 0;
    for (const [a, b] of merged) {
        if (a > last + EPS) outside.push([last, Math.min(a, 1)]);
        last = Math.max(last, b);
    }
    if (last < 1 - EPS) outside.push([last, 1]);
    return outside;
}

// Is an angle inside any covered half-disc at this pad?
function angleCovered(theta, dirs) {
    for (const d of dirs) {
        if (angularDist(theta, d) < Math.PI / 2 - EPS) return true;
    }
    return false;
}

export function buildBusbarDXF(geometry, positions, padRadius) {
    const layer = 'busbar';
    const tokens = [...dxfHeader(), ...dxfTables(), '0', 'SECTION', '2', 'ENTITIES'];
    const extraPads = Array.isArray(geometry.extraPads) ? geometry.extraPads : [];
    const extraSegments = Array.isArray(geometry.extraSegments) ? geometry.extraSegments : [];
    const cutouts = Array.isArray(geometry.cutouts) ? geometry.cutouts : [];

    // Enumerate pads (cells + waypoints) and capsule segments with shared keys so we
    // can tell which shapes are "self" vs "other" when clipping.
    const pads = new Map();
    const caps = []; // { a, b, padKeyA, padKeyB, radius }

    const ensurePad = (key, pos, radius = padRadius) => {
        if (!pads.has(key)) pads.set(key, { pos, dirs: [], radius });
        else pads.get(key).radius = Math.max(pads.get(key).radius, radius);
        return pads.get(key);
    };

    for (const idx of geometry.padIndices) {
        const p = positions[idx];
        if (!p) continue;
        ensurePad(`c${idx}`, p, padRadius);
    }

    for (const pad of extraPads) {
        if (!pad?.key || !Array.isArray(pad.pos)) continue;
        ensurePad(pad.key, pad.pos, pad.radius ?? padRadius);
    }

    geometry.edges.forEach((edge, ei) => {
        const from = positions[edge.from];
        const to = positions[edge.to];
        if (!from || !to) return;
        const stops = [
            { key: `c${edge.from}`, pos: from },
            ...edge.waypoints.map((wp, wi) => ({ key: `w${ei}_${wi}`, pos: wp })),
            { key: `c${edge.to}`, pos: to },
        ];
        for (let i = 1; i < stops.length - 1; i++) ensurePad(stops[i].key, stops[i].pos, padRadius);
        for (let i = 0; i < stops.length - 1; i++) {
            const a = stops[i], b = stops[i + 1];
            const dx = b.pos[0] - a.pos[0];
            const dy = b.pos[1] - a.pos[1];
            const len = Math.hypot(dx, dy);
            if (len < EPS) continue;
            const ang = Math.atan2(dy, dx);
            ensurePad(a.key, a.pos, padRadius).dirs.push(ang);
            ensurePad(b.key, b.pos, padRadius).dirs.push(ang + Math.PI);
            caps.push({ a: a.pos.slice(), b: b.pos.slice(), padKeyA: a.key, padKeyB: b.key, radius: padRadius });
        }
    });

    extraSegments.forEach((segment, index) => {
        if (!Array.isArray(segment?.from) || !Array.isArray(segment?.to)) return;
        const fromKey = segment.fromKey || `extra_from_${index}`;
        const toKey = segment.toKey || `extra_to_${index}`;
        const radius = segment.radius ?? padRadius;
        ensurePad(fromKey, segment.from, radius);
        ensurePad(toKey, segment.to, radius);

        const dx = segment.to[0] - segment.from[0];
        const dy = segment.to[1] - segment.from[1];
        const len = Math.hypot(dx, dy);
        if (len < EPS) return;

        const ang = Math.atan2(dy, dx);
        ensurePad(fromKey, segment.from, radius).dirs.push(ang);
        ensurePad(toKey, segment.to, radius).dirs.push(ang + Math.PI);
        caps.push({ a: segment.from.slice(), b: segment.to.slice(), padKeyA: fromKey, padKeyB: toKey, radius });
    });

    // Pad arcs: parts of each circle not covered by any connected capsule half-disc
    // AND not interior to any other capsule rectangle or pad circle.
    const padList = Array.from(pads.entries()).map(([key, data]) => ({ key, ...data }));
    for (const pad of padList) {
        const [cx, cy] = pad.pos;
        const localRadius = pad.radius ?? padRadius;
        if (pad.dirs.length === 0) {
            tokens.push(...circleEntity(cx, cy, localRadius, layer));
            continue;
        }
        const tangents = [];
        for (const d of pad.dirs) {
            tangents.push(normAngle(d - Math.PI / 2));
            tangents.push(normAngle(d + Math.PI / 2));
        }
        tangents.sort((a, b) => a - b);
        const uniq = [];
        for (const t of tangents) {
            if (uniq.length === 0 || Math.abs(t - uniq[uniq.length - 1]) > EPS) uniq.push(t);
        }
        for (let i = 0; i < uniq.length; i++) {
            const t1 = uniq[i];
            const t2 = uniq[(i + 1) % uniq.length];
            const span = (i + 1 < uniq.length) ? (t2 - t1) : (TWO_PI - t1 + t2);
            if (span < EPS) continue;
            const mid = normAngle(t1 + span / 2);
            if (angleCovered(mid, pad.dirs)) continue;
            // Also require the arc's midpoint to be outside all other shapes so it's
            // genuinely on the outline — an arc that enters a neighbour's capsule is
            // interior and must be dropped.
            const mx = cx + localRadius * Math.cos(mid);
            const my = cy + localRadius * Math.sin(mid);
            let buried = false;
            for (const cap of caps) {
                if (cap.padKeyA === pad.key || cap.padKeyB === pad.key) continue;
                if (segInsideCapsule([mx, my], [mx, my], cap.a, cap.b, cap.radius ?? padRadius).length) { buried = true; break; }
            }
            if (!buried) {
                for (const other of padList) {
                    if (other.key === pad.key) continue;
                    const dx = mx - other.pos[0], dy = my - other.pos[1];
                    const otherRadius = other.radius ?? padRadius;
                    if (dx * dx + dy * dy < otherRadius * otherRadius - EPS) { buried = true; break; }
                }
            }
            if (!buried) tokens.push(...arcEntity(cx, cy, localRadius, t1, t2, layer));
        }
    }

    // Capsule side lines, clipped against every other pad circle and every other
    // capsule rectangle. Only the portions that remain outside everything else
    // contribute to the cut path.
    for (let ci = 0; ci < caps.length; ci++) {
        const cap = caps[ci];
        const dx = cap.b[0] - cap.a[0];
        const dy = cap.b[1] - cap.a[1];
        const len = Math.hypot(dx, dy);
        if (len < EPS) continue;
        const localRadius = cap.radius ?? padRadius;
        const nx = -dy / len * localRadius;
        const ny =  dx / len * localRadius;
        const sides = [
            { p: [cap.a[0] + nx, cap.a[1] + ny], q: [cap.b[0] + nx, cap.b[1] + ny] },
            { p: [cap.a[0] - nx, cap.a[1] - ny], q: [cap.b[0] - nx, cap.b[1] - ny] },
        ];
        for (const side of sides) {
            const insides = [];
            for (let j = 0; j < caps.length; j++) {
                if (j === ci) continue;
                insides.push(...segInsideCapsule(side.p, side.q, caps[j].a, caps[j].b, caps[j].radius ?? padRadius));
            }
            for (const pad of padList) {
                if (pad.key === cap.padKeyA || pad.key === cap.padKeyB) continue;
                insides.push(...segInsideCircle(side.p, side.q, pad.pos, pad.radius ?? padRadius));
            }
            const outside = subtractIntervals(insides);
            for (const [t0, t1] of outside) {
                if (t1 - t0 < 1e-3) continue; // drop microscopic fragments
                const sx = side.p[0] + t0 * (side.q[0] - side.p[0]);
                const sy = side.p[1] + t0 * (side.q[1] - side.p[1]);
                const ex = side.p[0] + t1 * (side.q[0] - side.p[0]);
                const ey = side.p[1] + t1 * (side.q[1] - side.p[1]);
                tokens.push(...lineEntity(sx, sy, ex, ey, layer));
            }
        }
    }

    for (const cutout of cutouts) {
        const [cx, cy] = cutout.center;
        const halfWidth = cutout.width / 2;
        const halfHeight = cutout.height / 2;
        const x1 = cx - halfWidth;
        const x2 = cx + halfWidth;
        const y1 = cy - halfHeight;
        const y2 = cy + halfHeight;
        tokens.push(...lineEntity(x1, y1, x2, y1, layer));
        tokens.push(...lineEntity(x2, y1, x2, y2, layer));
        tokens.push(...lineEntity(x2, y2, x1, y2, layer));
        tokens.push(...lineEntity(x1, y2, x1, y1, layer));
    }

    tokens.push('0', 'ENDSEC', '0', 'EOF');
    return tokens.join('\n') + '\n';
}

export function downloadDXF(content, filename) {
    const blob = new Blob([content], { type: 'application/dxf' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}
