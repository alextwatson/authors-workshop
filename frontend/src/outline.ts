// Outline data model, stored as outline.json in the project folder.
// A project holds one or more outlines (parallel plots, mirroring how the
// atlas holds several maps). Each outline's spine is an ordered list of
// nodes; each node is either a story point or a reference to a scene/chapter
// document, and may carry side "arms" pointing at scene/chapter documents.

export type TagColor = "" | "dark" | "green" | "orange";
export type DocKind = "scene" | "chapter";
export type NodeKind = "point" | DocKind;

export interface OutlineArm {
    id: string;
    kind: DocKind;
    file: string;
}

export interface OutlineNode {
    id: string;
    kind: NodeKind;
    title: string;
    note: string;
    tag: TagColor;
    tagLabel: string;
    file: string;
    arms: OutlineArm[];
}

// An overarching plot point: a labeled curly brace, drawn to the left of the
// spine, that groups a set of nodes (by id).
export interface OutlineGroup {
    id: string;
    label: string;
    note: string;
    color: TagColor;
    members: string[];
}

const TAG_COLORS: TagColor[] = ["", "dark", "green", "orange"];

function normalizeArm(raw: any): OutlineArm | null {
    if (!raw || typeof raw.file !== "string" || !raw.file) return null;
    return {
        id: typeof raw.id === "string" ? raw.id : raw.file,
        kind: raw.kind === "chapter" ? "chapter" : "scene",
        file: raw.file,
    };
}

function normalizeNode(raw: any): OutlineNode | null {
    if (!raw || typeof raw.id !== "string") return null;
    const kind: NodeKind =
        raw.kind === "scene" || raw.kind === "chapter" ? raw.kind : "point";
    return {
        id: raw.id,
        kind,
        title: typeof raw.title === "string" ? raw.title : "",
        note: typeof raw.note === "string" ? raw.note : "",
        tag: TAG_COLORS.includes(raw.tag) ? raw.tag : "",
        tagLabel: typeof raw.tagLabel === "string" ? raw.tagLabel : "",
        file: typeof raw.file === "string" ? raw.file : "",
        arms: Array.isArray(raw.arms)
            ? raw.arms.map(normalizeArm).filter((a: OutlineArm | null): a is OutlineArm => a !== null)
            : [],
    };
}

function normalizeGroup(raw: any): OutlineGroup | null {
    if (!raw || typeof raw.id !== "string") return null;
    return {
        id: raw.id,
        label: typeof raw.label === "string" ? raw.label : "",
        note: typeof raw.note === "string" ? raw.note : "",
        color: TAG_COLORS.includes(raw.color) ? raw.color : "green",
        members: Array.isArray(raw.members) ? raw.members.filter((m: any) => typeof m === "string") : [],
    };
}

// One outline: a named spine of nodes plus its plot-arc groups. A project
// can hold several (the main plot, a subplot running in parallel…).
export interface Outline {
    id: string;
    name: string;
    nodes: OutlineNode[];
    groups: OutlineGroup[];
}

function normalizeNodes(raw: any): OutlineNode[] {
    return Array.isArray(raw)
        ? raw.map(normalizeNode).filter((n: OutlineNode | null): n is OutlineNode => n !== null)
        : [];
}

function normalizeGroups(raw: any): OutlineGroup[] {
    return Array.isArray(raw)
        ? raw.map(normalizeGroup).filter((g: OutlineGroup | null): g is OutlineGroup => g !== null)
        : [];
}

function normalizeOutline(raw: any, i: number): Outline {
    return {
        id: typeof raw?.id === "string" && raw.id ? raw.id : `outline-${i + 1}`,
        name: typeof raw?.name === "string" && raw.name ? raw.name : `Outline ${i + 1}`,
        nodes: normalizeNodes(raw?.nodes),
        groups: normalizeGroups(raw?.groups),
    };
}

export function emptyOutline(): Outline {
    return { id: "outline-1", name: "Main Plot", nodes: [], groups: [] };
}

// Always returns at least one outline, so the view never has an empty state.
export function parseOutlines(json: string): Outline[] {
    try {
        const data = JSON.parse(json);
        if (data && typeof data === "object") {
            if (Array.isArray(data.outlines) && data.outlines.length > 0) {
                return data.outlines.map((o: any, i: number) => normalizeOutline(o, i));
            }
            // Legacy single-outline format ({ nodes, groups }) — migrate it into
            // the outlines array so older projects keep their spine.
            if (Array.isArray(data.nodes) || Array.isArray(data.groups)) {
                return [
                    {
                        ...emptyOutline(),
                        nodes: normalizeNodes(data.nodes),
                        groups: normalizeGroups(data.groups),
                    },
                ];
            }
        }
    } catch {
        // fall through to a single empty outline
    }
    return [emptyOutline()];
}

export function serializeOutlines(outlines: Outline[]): string {
    return JSON.stringify({ version: 1, outlines }, null, 2) + "\n";
}
