// World-building "Codex" entries — the in-world wiki. Each entry is one
// worldbuilding/codex/entry-NN.json file. The filename is the stable id; the
// title and category live inside the JSON, so renaming never orphans the file.
// Mirrors the forgiving parse/serialize pattern in characters.ts.

export interface CodexEntry {
    title: string;
    // Optional pronunciation guide for the title (e.g. "AZ-er-oth · /ˈæzɛrɒθ/").
    // Hidden in the editor until the author chooses to add it.
    pronunciation: string;
    // Free-form, user-defined grouping (e.g. "Magic", "Politics", "Locations").
    // Empty means the entry is shown under "Uncategorized".
    category: string;
    // Freeform prose, plain text like the manuscript (newlines preserved).
    body: string;
}

// Suggested starting categories surfaced in the editor's datalist. Authors are
// free to type anything else — these are just conveniences, not a fixed set.
export const SUGGESTED_CATEGORIES = [
    "Locations",
    "Magic",
    "Politics",
    "History",
    "Religion",
    "Culture",
    "Factions",
];

export function parseCodexEntry(json: string): CodexEntry {
    try {
        const data = JSON.parse(json);
        if (data && typeof data === "object") {
            return {
                title: typeof data.title === "string" ? data.title : "",
                pronunciation:
                    typeof data.pronunciation === "string" ? data.pronunciation : "",
                category: typeof data.category === "string" ? data.category : "",
                body: typeof data.body === "string" ? data.body : "",
            };
        }
    } catch {
        // fall through to empty entry
    }
    return emptyCodexEntry();
}

export function serializeCodexEntry(e: CodexEntry): string {
    return JSON.stringify({ version: 1, ...e }, null, 2) + "\n";
}

export function emptyCodexEntry(): CodexEntry {
    return { title: "", pronunciation: "", category: "", body: "" };
}

// A freshly created entry with nothing filled in — used to decide whether to
// open in edit mode (empty) or read-only view mode (has content).
export function isEmptyCodexEntry(e: CodexEntry): boolean {
    return !e.title.trim() && !e.pronunciation.trim() && !e.category.trim() && !e.body.trim();
}
