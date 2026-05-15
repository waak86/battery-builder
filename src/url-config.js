const SCHEMA_VERSION = 2;
const HASH_PREFIX = '#config=';

const ALLOWED_LAYOUTS = new Set(['grid', 'honeycomb', 'vertical']);
const ALLOWED_BMS_TYPES = new Set(['off', 'halfcircles', 'fullcircles', 'tabs']);
const ALLOWED_TAB_OVERLAP_SIDES = new Set(['off', 'top', 'bottom', 'left', 'right']);

function normalizeTabOverlapSide(value) {
    if (value === 'top' || value === 'bottom' || value === 'off') return value;
    if (value === 'left' || value === 'right') return 'off';
    throw new Error('Invalid tab overlap side');
}
const ALLOWED_PACK_MODES = new Set(['sp', 'mm']);
const ALLOWED_BUSBAR_FORMATS = new Set(['step', 'dxf']);

function toBase64Url(input) {
    const bytes = new TextEncoder().encode(input);
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input) {
    const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
    const padding = '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(normalized + padding);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function requireFiniteNumber(value, label) {
    if (!Number.isFinite(value)) throw new Error(`Invalid number: ${label}`);
    return value;
}

function requireString(value, label) {
    if (typeof value !== 'string') throw new Error(`Invalid string: ${label}`);
    return value;
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') throw new Error(`Invalid boolean: ${label}`);
    return value;
}

function normalizeBusbar(raw, index) {
    if (!raw || typeof raw !== 'object') throw new Error(`Invalid busbar at index ${index}`);

    const id = requireString(raw.id, `busbars.list[${index}].id`);
    const name = requireString(raw.name, `busbars.list[${index}].name`);
    const color = requireString(raw.color, `busbars.list[${index}].color`);
    const thickness = requireFiniteNumber(Number(raw.thickness), `busbars.list[${index}].thickness`);
    if (thickness <= 0) throw new Error(`Invalid busbar thickness at index ${index}`);

    if (!Array.isArray(raw.cellIndices)) {
        throw new Error(`Invalid busbar cell index list at index ${index}`);
    }
    const cellIndices = raw.cellIndices.map((v) => {
        const n = Number(v);
        if (!Number.isInteger(n) || n < 0) {
            throw new Error(`Invalid busbar cell index at index ${index}`);
        }
        return n;
    });

    const face = raw.face === 'bottom' ? 'bottom' : 'top';
    const overlapEnabled = raw.overlapEnabled == null ? false : requireBoolean(raw.overlapEnabled, `busbars.list[${index}].overlapEnabled`);
    const overlapSize = raw.overlapSize == null
        ? 10
        : requireFiniteNumber(Number(raw.overlapSize), `busbars.list[${index}].overlapSize`);
    if (overlapSize <= 0) throw new Error(`Invalid overlap size at index ${index}`);
    return { id, name, color, thickness, cellIndices, face, overlapEnabled, overlapSize };
}

function normalizeConfig(raw) {
    if (!raw || typeof raw !== 'object') throw new Error('Missing config object');

    const v = Number(raw.v);
    if (!Number.isInteger(v)) throw new Error('Missing schema version');
    if (v !== SCHEMA_VERSION) throw new Error('Unsupported schema version');

    const pack = raw.pack;
    const cell = raw.cell;
    const bms = raw.bms;
    const busbars = raw.busbars;

    if (!pack || !cell || !bms || !busbars) {
        throw new Error('Missing required sections');
    }

    const packMode = requireString(pack.mode, 'pack.mode');
    if (!ALLOWED_PACK_MODES.has(packMode)) throw new Error('Invalid pack mode');

    const layoutType = requireString(cell.layoutType, 'cell.layoutType');
    if (!ALLOWED_LAYOUTS.has(layoutType)) throw new Error('Invalid layout type');

    const bmsType = requireString(bms.type, 'bms.type');
    if (!ALLOWED_BMS_TYPES.has(bmsType)) throw new Error('Invalid BMS type');
    const rawTabOverlapSide = requireString(bms.tabOverlapSide ?? 'off', 'bms.tabOverlapSide');
    if (!ALLOWED_TAB_OVERLAP_SIDES.has(rawTabOverlapSide)) throw new Error('Invalid tab overlap side');
    const tabOverlapSide = normalizeTabOverlapSide(rawTabOverlapSide);

    const busbarFormat = requireString(busbars.format, 'busbars.format');
    if (!ALLOWED_BUSBAR_FORMATS.has(busbarFormat)) throw new Error('Invalid busbar format');
    const cellCutoutEnabled = busbars.cellCutoutEnabled == null
        ? false
        : requireBoolean(busbars.cellCutoutEnabled, 'busbars.cellCutoutEnabled');

    const list = Array.isArray(busbars.list)
        ? busbars.list.map((bb, i) => normalizeBusbar(bb, i))
        : (() => { throw new Error('Invalid busbar list'); })();

    const activeId = busbars.activeId == null ? null : requireString(busbars.activeId, 'busbars.activeId');

    if (activeId !== null && !list.some((bb) => bb.id === activeId)) {
        throw new Error('Active busbar id not found in list');
    }

    return {
        v,
        pack: {
            mode: packMode,
            series: requireFiniteNumber(Number(pack.series), 'pack.series'),
            parallel: requireFiniteNumber(Number(pack.parallel), 'pack.parallel'),
            xDim: requireFiniteNumber(Number(pack.xDim), 'pack.xDim'),
            yDim: requireFiniteNumber(Number(pack.yDim), 'pack.yDim'),
        },
        cell: {
            cellSize: requireFiniteNumber(Number(cell.cellSize), 'cell.cellSize'),
            layoutType,
            spacing: requireFiniteNumber(Number(cell.spacing), 'cell.spacing'),
            height: requireFiniteNumber(Number(cell.height), 'cell.height'),
            coverThickness: requireFiniteNumber(Number(cell.coverThickness), 'cell.coverThickness'),
            ledgeWidth: requireFiniteNumber(Number(cell.ledgeWidth), 'cell.ledgeWidth'),
            roundedCorners: requireBoolean(cell.roundedCorners, 'cell.roundedCorners'),
        },
        bms: {
            type: bmsType,
            holeDiameter: requireFiniteNumber(Number(bms.holeDiameter), 'bms.holeDiameter'),
            tabWidth: requireFiniteNumber(Number(bms.tabWidth), 'bms.tabWidth'),
            tabLength: requireFiniteNumber(Number(bms.tabLength ?? 10), 'bms.tabLength'),
            tabDepth: requireFiniteNumber(Number(bms.tabDepth), 'bms.tabDepth'),
            tabOverlapSide,
        },
        busbars: {
            format: busbarFormat,
            activeId,
            cellCutoutEnabled,
            list,
        },
    };
}

function readNumber(id, fallback = 0) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const value = Number(el.value);
    return Number.isFinite(value) ? value : fallback;
}

function readString(id, fallback = '') {
    const el = document.getElementById(id);
    if (!el) return fallback;
    return typeof el.value === 'string' ? el.value : fallback;
}

function readBool(id, fallback = false) {
    const el = document.getElementById(id);
    if (!el) return fallback;
    return !!el.checked;
}

async function sha256Hex(input) {
    if (!crypto?.subtle) throw new Error('Web Crypto API is unavailable');
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
    const bytes = new Uint8Array(hash);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function getSchemaVersion() {
    return SCHEMA_VERSION;
}

export function captureConfig(getPackMode, busbarSnapshot) {
    const packMode = typeof getPackMode === 'function' ? getPackMode() : 'sp';

    return normalizeConfig({
        v: SCHEMA_VERSION,
        pack: {
            mode: packMode,
            series: readNumber('series', 1),
            parallel: readNumber('parallel', 1),
            xDim: readNumber('xDim', 150),
            yDim: readNumber('yDim', 100),
        },
        cell: {
            cellSize: readNumber('cellSize', 21.35),
            layoutType: readString('layoutType', 'honeycomb'),
            spacing: readNumber('spacing', 0.6),
            height: readNumber('height', 10),
            coverThickness: readNumber('coverThickness', 0.4),
            ledgeWidth: readNumber('ledgeWidth', 2.75),
            roundedCorners: readBool('roundedCorners', true),
        },
        bms: {
            type: readString('bmsHolesType', 'fullcircles'),
            holeDiameter: readNumber('bmsHoleDiameter', 4.0),
            tabWidth: readNumber('tabWidth', 4.0),
            tabLength: readNumber('tabLength', 10.0),
            tabDepth: readNumber('tabDepth', 1.0),
            tabOverlapSide: normalizeTabOverlapSide(readString('tabOverlapSide', 'off')),
        },
        busbars: {
            format: readString('busbarFormat', 'step'),
            activeId: busbarSnapshot?.activeId ?? null,
            cellCutoutEnabled: readBool('busbarCellCutoutEnabled', false),
            list: Array.isArray(busbarSnapshot?.list)
                ? busbarSnapshot.list.map(bb => ({ ...bb, face: bb.face === 'bottom' ? 'bottom' : 'top' }))
                : [],
        },
    });
}

export async function encodeConfigToHash(config) {
    const normalized = normalizeConfig(config);
    const rawJson = JSON.stringify(normalized);
    const payload = toBase64Url(rawJson);
    const checksum = (await sha256Hex(rawJson)).slice(0, 16);
    return `${HASH_PREFIX}${payload}_${checksum}`;
}

export async function decodeHashToConfig(hash) {
    if (!hash || !hash.startsWith(HASH_PREFIX)) {
        return { ok: false, reason: 'missing' };
    }

    const body = hash.slice(HASH_PREFIX.length);
    const separator = body.lastIndexOf('_');
    if (separator <= 0 || separator === body.length - 1) {
        return { ok: false, reason: 'format' };
    }

    const payload = body.slice(0, separator);
    const checksum = body.slice(separator + 1);
    if (!/^[0-9a-f]{16}$/i.test(checksum)) {
        return { ok: false, reason: 'checksum-format' };
    }

    try {
        const rawJson = fromBase64Url(payload);
        const expected = (await sha256Hex(rawJson)).slice(0, 16);
        if (checksum.toLowerCase() !== expected.toLowerCase()) {
            return { ok: false, reason: 'checksum-mismatch' };
        }
        const parsed = JSON.parse(rawJson);
        const config = normalizeConfig(parsed);
        return { ok: true, config };
    } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : 'decode-failed' };
    }
}

export function normalizeDecodedConfig(config) {
    return normalizeConfig(config);
}
