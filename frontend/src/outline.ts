// Outline data model, stored as outline.json in the project folder.
// The spine is an ordered list of nodes; each node is either a story point
// or a reference to a scene/chapter document, and may carry side "arms"
// pointing at scene/chapter documents.

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

export function parseOutline(json: string): OutlineNode[] {
    try {
        const data = JSON.parse(json);
        if (Array.isArray(data?.nodes)) {
            return data.nodes
                .map(normalizeNode)
                .filter((n: OutlineNode | null): n is OutlineNode => n !== null);
        }
    } catch {
        // fall through to empty outline
    }
    return [];
}

export function parseGroups(json: string): OutlineGroup[] {
    try {
        const data = JSON.parse(json);
        if (Array.isArray(data?.groups)) {
            return data.groups
                .map(normalizeGroup)
                .filter((g: OutlineGroup | null): g is OutlineGroup => g !== null);
        }
    } catch {
        // fall through to empty
    }
    return [];
}

export function serializeOutline(nodes: OutlineNode[], groups: OutlineGroup[] = []): string {
    return JSON.stringify({ version: 1, nodes, groups }, null, 2) + "\n";
}
