// Character sheet data model, stored as one characters/character-NN.json file
// each. The filename is the stable id; the display name lives inside the JSON,
// so renaming a character never orphans references to it (e.g. emotional-arc
// states keyed by character id).

export type AttrType = "text" | "scale";

// A custom attribute an author adds to a sheet. `value` is always a string:
// freeform prose for "text", a numeric-as-string for "scale" (so an empty
// scale is just ""). min/max bound the scale and are only meaningful then.
export interface CharAttr {
    id: string;
    label: string;
    type: AttrType;
    value: string;
    min: number;
    max: number;
}

// One beat in a character's emotional arc: a couple of words, optionally
// connected to an outline object (story point / scene / chapter) by its id.
export interface ArcPoint {
    id: string;
    text: string;
    outlineId: string;
}

export interface Character {
    name: string;
    role: string;
    bio: string;
    attrs: CharAttr[];
    arc: ArcPoint[];
}

export const DEFAULT_SCALE_MIN = 1;
export const DEFAULT_SCALE_MAX = 10;

function normalizeAttr(raw: any): CharAttr | null {
    if (!raw || typeof raw.id !== "string") return null;
    const type: AttrType = raw.type === "scale" ? "scale" : "text";
    const min = Number.isFinite(raw.min) ? raw.min : DEFAULT_SCALE_MIN;
    const max = Number.isFinite(raw.max) ? raw.max : DEFAULT_SCALE_MAX;
    return {
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label : "",
        type,
        value: typeof raw.value === "string" ? raw.value : "",
        min,
        max,
    };
}

function normalizeArcPoint(raw: any): ArcPoint | null {
    if (!raw || typeof raw.id !== "string") return null;
    return {
        id: raw.id,
        text: typeof raw.text === "string" ? raw.text : "",
        outlineId: typeof raw.outlineId === "string" ? raw.outlineId : "",
    };
}

// Parse a character JSON string, tolerating empty/malformed content by falling
// back to an empty sheet. Mirrors the forgiving parse pattern in outline.ts.
export function parseCharacter(json: string): Character {
    try {
        const data = JSON.parse(json);
        if (data && typeof data === "object") {
            return {
                name: typeof data.name === "string" ? data.name : "",
                role: typeof data.role === "string" ? data.role : "",
                bio: typeof data.bio === "string" ? data.bio : "",
                attrs: Array.isArray(data.attrs)
                    ? data.attrs
                          .map(normalizeAttr)
                          .filter((a: CharAttr | null): a is CharAttr => a !== null)
                    : [],
                arc: Array.isArray(data.arc)
                    ? data.arc
                          .map(normalizeArcPoint)
                          .filter((p: ArcPoint | null): p is ArcPoint => p !== null)
                    : [],
            };
        }
    } catch {
        // fall through to empty sheet
    }
    return emptyCharacter();
}

export function serializeCharacter(c: Character): string {
    return JSON.stringify({ version: 1, ...c }, null, 2) + "\n";
}

export function emptyCharacter(): Character {
    return { name: "", role: "", bio: "", attrs: [], arc: [] };
}
