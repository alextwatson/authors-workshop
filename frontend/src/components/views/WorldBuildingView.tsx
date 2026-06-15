import { Fragment, useEffect, useState } from "react";
import {
    DeleteCodexEntry,
    ListCodexEntries,
    ReadCodexEntry,
    WriteCodexEntry,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import { emptyCodexEntry, parseCodexEntry, serializeCodexEntry } from "../../codex";
import { nextNumberedJson } from "../../docnames";
import CodexEditor from "../CodexEditor";
import AtlasView from "../AtlasView";

interface Props {
    project: main.Project;
}

type Tab = "codex" | "atlas";
type EntryRef = { filename: string; title: string; category: string };

const UNCATEGORIZED = "Uncategorized";

function displayTitle(title: string, filename: string): string {
    return title.trim() || filename.replace(/\.json$/, "");
}

// Group entries by category for the list, categories sorted alphabetically with
// the uncategorized bucket pinned last. Order within a group follows filename
// (creation) order so rows don't jump around while a title is being typed.
function groupByCategory(entries: EntryRef[]): { category: string; entries: EntryRef[] }[] {
    const groups = new Map<string, EntryRef[]>();
    for (const e of entries) {
        const key = e.category.trim() || UNCATEGORIZED;
        const bucket = groups.get(key);
        if (bucket) bucket.push(e);
        else groups.set(key, [e]);
    }
    const names = [...groups.keys()].sort((a, b) => {
        if (a === UNCATEGORIZED) return 1;
        if (b === UNCATEGORIZED) return -1;
        return a.toLowerCase().localeCompare(b.toLowerCase());
    });
    return names.map((category) => ({ category, entries: groups.get(category)! }));
}

export default function WorldBuildingView({ project }: Props) {
    const [tab, setTab] = useState<Tab>("codex");
    const [entries, setEntries] = useState<EntryRef[]>([]);
    const [active, setActive] = useState<string | null>(null);
    const [listOpen, setListOpen] = useState(true);
    const [error, setError] = useState("");

    useEffect(() => {
        ListCodexEntries(project.path)
            .then(async (names) => {
                const refs = await Promise.all(
                    names.map(async (filename) => {
                        const content = await ReadCodexEntry(project.path, filename).catch(
                            () => ""
                        );
                        const parsed = parseCodexEntry(content);
                        return { filename, title: parsed.title, category: parsed.category };
                    })
                );
                setEntries(refs);
                if (refs.length > 0) setActive(refs[0].filename);
            })
            .catch((err) => setError(String(err)));
    }, [project.path]);

    async function newEntry() {
        setError("");
        const { filename } = nextNumberedJson(
            entries.map((e) => e.filename),
            "entry"
        );
        try {
            await WriteCodexEntry(project.path, filename, serializeCodexEntry(emptyCodexEntry()));
            setEntries((es) => [...es, { filename, title: "", category: "" }]);
            setActive(filename);
        } catch (err) {
            setError(String(err));
        }
    }

    async function deleteEntry(filename: string) {
        setError("");
        try {
            await DeleteCodexEntry(project.path, filename);
            const next = entries.filter((e) => e.filename !== filename);
            setEntries(next);
            if (active === filename) {
                setActive(next.length > 0 ? next[0].filename : null);
            }
        } catch (err) {
            setError(String(err));
        }
    }

    function onSaved(filename: string, info: { title: string; category: string }) {
        setEntries((es) =>
            es.map((e) =>
                e.filename === filename
                    ? { ...e, title: info.title, category: info.category }
                    : e
            )
        );
    }

    const grouped = groupByCategory(entries);
    const categories = [
        ...new Set(entries.map((e) => e.category.trim()).filter((c) => c !== "")),
    ];

    return (
        <div className="worldbuilding">
            <div className="wb-tabs">
                <button
                    className={`wb-tab ${tab === "codex" ? "active" : ""}`}
                    onClick={() => setTab("codex")}
                >
                    Codex
                </button>
                <button
                    className={`wb-tab ${tab === "atlas" ? "active" : ""}`}
                    onClick={() => setTab("atlas")}
                >
                    Atlas
                </button>
            </div>
            {tab === "atlas" ? (
                <AtlasView
                    project={project}
                    entries={entries}
                    onOpenEntry={(filename) => {
                        setActive(filename);
                        setTab("codex");
                    }}
                />
            ) : (
                <div className="manuscript">
                    {listOpen && (
                        <div className="chapter-list">
                            <div className="list-top">
                                <span className="list-heading">Entries</span>
                                <button
                                    className="collapse-btn"
                                    title="Hide entries"
                                    onClick={() => setListOpen(false)}
                                >
                                    «
                                </button>
                            </div>
                            {grouped.map((group) => (
                                <Fragment key={group.category}>
                                    <div className="list-heading">{group.category}</div>
                                    {group.entries.map((e) => (
                                        <div className="doc-row" key={e.filename}>
                                            <button
                                                className={`doc-select ${
                                                    active === e.filename ? "active" : ""
                                                }`}
                                                onClick={() => setActive(e.filename)}
                                            >
                                                <span className="chapter-title">
                                                    {displayTitle(e.title, e.filename)}
                                                </span>
                                            </button>
                                            <button
                                                className="doc-trash"
                                                title="Move to Trash"
                                                onClick={() => deleteEntry(e.filename)}
                                            >
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </Fragment>
                            ))}
                            <button className="new-chapter" onClick={newEntry}>
                                + New Entry
                            </button>
                        </div>
                    )}
                    <div className="editor-pane">
                        {!listOpen && (
                            <button
                                className="list-reopen"
                                title="Show entries"
                                onClick={() => setListOpen(true)}
                            >
                                ☰
                            </button>
                        )}
                        {active ? (
                            <CodexEditor
                                key={active}
                                read={() => ReadCodexEntry(project.path, active)}
                                write={(content) => WriteCodexEntry(project.path, active, content)}
                                onSaved={(info) => onSaved(active, info)}
                                fallbackTitle={active.replace(/\.json$/, "")}
                                categories={categories}
                            />
                        ) : (
                            <div className="view">
                                <h2>World Building</h2>
                                <p className="subtitle">
                                    {error ||
                                        "No entries yet — create one to start building your world's lore, locations, and magic."}
                                </p>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
