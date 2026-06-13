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

export function serializeOutline(nodes: OutlineNode[]): string {
    return JSON.stringify({ version: 1, nodes }, null, 2) + "\n";
}
