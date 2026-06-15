// The Atlas: an uploaded world map plus the markers placed on it. Stored as
// worldbuilding/atlas.json; the image itself is a file under worldbuilding/maps/
// and only its filename is referenced here. All marker coordinates are
// normalized 0..1 relative to the image, so they survive zoom and image swaps.
// Mirrors the forgiving parse/serialize pattern in outline.ts / characters.ts.

export type PinType = "city" | "town" | "landmark" | "battle";

export interface Pin {
    id: string;
    x: number; // 0..1
    y: number; // 0..1
    type: PinType;
    label: string;
    entryId: string; // codex entry filename this pin links to, or ""
}

export interface Region {
    id: string;
    points: { x: number; y: number }[]; // 0..1 polygon, drawn as a dotted outline
    label: string;
    color: string; // one of ATLAS_COLORS
    entryId: string;
}

// One map: its own image plus the markers placed on it. A project can hold
// several (a world map, a city, a continent…).
export interface AtlasMap {
    id: string;
    name: string;
    mapImage: string; // filename under worldbuilding/maps/, or ""
    pins: Pin[];
    regions: Region[];
}

export interface Atlas {
    maps: AtlasMap[];
}

export const PIN_TYPES: PinType[] = ["city", "town", "landmark", "battle"];

export const PIN_GLYPH: Record<PinType, string> = {
    city: "⬤",
    town: "◍",
    landmark: "◆",
    battle: "⚔",
};

// Territory outline colors. Region.color stores the literal value.
export const ATLAS_COLORS = [
    "#c97a6a",
    "#b37b22",
    "#6a8ec9",
    "#7faa6a",
    "#9b6ac9",
    "#c2c26a",
];

function clamp01(n: unknown): number {
    const v = typeof n === "number" && Number.isFinite(n) ? n : 0;
    return Math.min(1, Math.max(0, v));
}

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function normalizePin(raw: any): Pin | null {
    if (!raw || typeof raw.id !== "string") return null;
    const type: PinType = PIN_TYPES.includes(raw.type) ? raw.type : "city";
    return {
        id: raw.id,
        x: clamp01(raw.x),
        y: clamp01(raw.y),
        type,
        label: str(raw.label),
        entryId: str(raw.entryId),
    };
}

function normalizeRegion(raw: any): Region | null {
    if (!raw || typeof raw.id !== "string") return null;
    const points = Array.isArray(raw.points)
        ? raw.points
              .filter((p: any) => p && typeof p === "object")
              .map((p: any) => ({ x: clamp01(p.x), y: clamp01(p.y) }))
        : [];
    return {
        id: raw.id,
        points,
        label: str(raw.label),
        color: typeof raw.color === "string" ? raw.color : ATLAS_COLORS[0],
        entryId: str(raw.entryId),
    };
}

function normalizeMap(raw: any, i: number): AtlasMap {
    return {
        id: typeof raw?.id === "string" && raw.id ? raw.id : `map-${i + 1}`,
        name: str(raw?.name) || `Map ${i + 1}`,
        mapImage: str(raw?.mapImage),
        pins: Array.isArray(raw?.pins)
            ? raw.pins.map(normalizePin).filter((p: Pin | null): p is Pin => p !== null)
            : [],
        regions: Array.isArray(raw?.regions)
            ? raw.regions.map(normalizeRegion).filter((r: Region | null): r is Region => r !== null)
            : [],
    };
}

export function parseAtlas(json: string): Atlas {
    try {
        const data = JSON.parse(json);
        if (data && typeof data === "object") {
            if (Array.isArray(data.maps)) {
                return { maps: data.maps.map((m: any, i: number) => normalizeMap(m, i)) };
            }
            // Legacy single-map format ({ mapImage, pins, regions }) — migrate it
            // into the maps array so older projects keep their markers.
            if (
                typeof data.mapImage === "string" ||
                Array.isArray(data.pins) ||
                Array.isArray(data.regions)
            ) {
                const legacy = normalizeMap(data, 0);
                if (legacy.mapImage || legacy.pins.length || legacy.regions.length) {
                    return { maps: [legacy] };
                }
            }
        }
    } catch {
        // fall through to empty atlas
    }
    return emptyAtlas();
}

export function serializeAtlas(a: Atlas): string {
    return JSON.stringify({ version: 1, ...a }, null, 2) + "\n";
}

export function emptyAtlas(): Atlas {
    return { maps: [] };
}

// Average of a polygon's vertices — good enough to anchor a region's label.
export function centroid(points: { x: number; y: number }[]): { x: number; y: number } {
    if (points.length === 0) return { x: 0.5, y: 0.5 };
    const sum = points.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
    return { x: sum.x / points.length, y: sum.y / points.length };
}
