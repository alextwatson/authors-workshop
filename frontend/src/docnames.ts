import { main } from "../wailsjs/go/models";

// Next free "<prefix>-NN.md" filename given the docs that already exist.
export function nextNumberedFilename(
    docs: main.ChapterInfo[],
    prefix: string
): { filename: string; number: number } {
    let max = 0;
    for (const d of docs) {
        const m = d.filename.match(new RegExp(`^${prefix}-(\\d+)\\.md$`));
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const number = max + 1 || docs.length + 1;
    return { filename: `${prefix}-${String(number).padStart(2, "0")}.md`, number };
}

export function newId(): string {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
