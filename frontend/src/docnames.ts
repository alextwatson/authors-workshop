import { main } from "../wailsjs/go/models";

// Next free "<prefix>-NN<ext>" filename given the docs that already exist.
// Existing files of either manuscript extension count toward the number, so a
// format switch never collides with leftover names.
export function nextNumberedFilename(
    docs: main.ChapterInfo[],
    prefix: string,
    ext: string = ".md"
): { filename: string; number: number } {
    let max = 0;
    for (const d of docs) {
        const m = d.filename.match(new RegExp(`^${prefix}-(\\d+)\\.(?:md|txt)$`));
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const number = max + 1 || docs.length + 1;
    return { filename: `${prefix}-${String(number).padStart(2, "0")}${ext}`, number };
}

// Next free "<prefix>-NN.json" filename given the .json files that already
// exist (e.g. characters). Parallels nextNumberedFilename for .md docs.
export function nextNumberedJson(
    names: string[],
    prefix: string
): { filename: string; number: number } {
    let max = 0;
    for (const n of names) {
        const m = n.match(new RegExp(`^${prefix}-(\\d+)\\.json$`));
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const number = max + 1 || names.length + 1;
    return { filename: `${prefix}-${String(number).padStart(2, "0")}.json`, number };
}

export function newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
