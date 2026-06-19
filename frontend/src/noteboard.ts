// The Note Board: a free-form pinboard of sticky notes the writer can drag
// around and connect with "thread" lines. Stored as noteboard.json at the
// project root; the JSON is opaque to Go (this file owns the schema), mirroring
// the forgiving parse/serialize pattern in outline.ts / atlas.ts.
//
// Unlike the Atlas, there's no background image, so note positions and sizes
// are plain board-space pixel coordinates rather than normalized 0..1 values.

// The note palette. The first colour is the initial default for new notes; any
// note (and the board default) can be set to any of these seven.
export const NOTE_COLORS = [
    "#bfbfbf",
    "#71a668",
    "#6a86b0",
    "#76568f",
    "#ab5c74",
    "#b89d6e",
    "#4c5b6b",
];

export const DEFAULT_NOTE_COLOR = NOTE_COLORS[0];

// Sensible default sticky-note size in board pixels.
export const NOTE_W = 200;
export const NOTE_H = 160;
export const MIN_NOTE_W = 120;
export const MIN_NOTE_H = 90;

// The board is a finite area (in board px). Notes are clamped to stay inside
// it, and the dot-grid background spans exactly this size. GRID_SIZE is the
// spacing between dots, so the dots mark the corners of GRID_SIZE squares.
export const BOARD_W = 5000;
export const BOARD_H = 3500;
export const GRID_SIZE = 72;

export interface StickyNote {
    id: string;
    x: number; // board px
    y: number; // board px
    w: number; // board px
    h: number; // board px
    color: string; // one of NOTE_COLORS
    text: string;
}

export interface Thread {
    id: string;
    from: string; // note id
    to: string; // note id
}

export interface NoteBoard {
    defaultColor: string;
    notes: StickyNote[];
    threads: Thread[];
}

function num(v: unknown, fallback: number): number {
    return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}

function str(v: unknown): string {
    return typeof v === "string" ? v : "";
}

function color(v: unknown, fallback: string): string {
    return typeof v === "string" && NOTE_COLORS.includes(v) ? v : fallback;
}

function normalizeNote(raw: any): StickyNote | null {
    if (!raw || typeof raw.id !== "string") return null;
    return {
        id: raw.id,
        x: num(raw.x, 0),
        y: num(raw.y, 0),
        w: Math.max(MIN_NOTE_W, num(raw.w, NOTE_W)),
        h: Math.max(MIN_NOTE_H, num(raw.h, NOTE_H)),
        color: color(raw.color, DEFAULT_NOTE_COLOR),
        text: str(raw.text),
    };
}

function normalizeThread(raw: any, noteIds: Set<string>): Thread | null {
    if (!raw || typeof raw.id !== "string") return null;
    if (!noteIds.has(raw.from) || !noteIds.has(raw.to)) return null;
    if (raw.from === raw.to) return null;
    return { id: raw.id, from: raw.from, to: raw.to };
}

export function parseNoteBoard(json: string): NoteBoard {
    try {
        const data = JSON.parse(json);
        if (data && typeof data === "object") {
            const notes = Array.isArray(data.notes)
                ? data.notes
                      .map(normalizeNote)
                      .filter((n: StickyNote | null): n is StickyNote => n !== null)
                : [];
            const noteIds = new Set<string>(notes.map((n: StickyNote) => n.id));
            const threads = Array.isArray(data.threads)
                ? data.threads
                      .map((t: any) => normalizeThread(t, noteIds))
                      .filter((t: Thread | null): t is Thread => t !== null)
                : [];
            return {
                defaultColor: color(data.defaultColor, DEFAULT_NOTE_COLOR),
                notes,
                threads,
            };
        }
    } catch {
        // fall through to an empty board
    }
    return emptyBoard();
}

export function serializeNoteBoard(b: NoteBoard): string {
    return JSON.stringify({ version: 1, ...b }, null, 2) + "\n";
}

export function emptyBoard(): NoteBoard {
    return { defaultColor: DEFAULT_NOTE_COLOR, notes: [], threads: [] };
}
