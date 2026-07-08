import { useEffect, useRef, useState } from "react";
import {
    CodexEntry,
    emptyCodexEntry,
    isEmptyCodexEntry,
    parseCodexEntry,
    serializeCodexEntry,
    SUGGESTED_CATEGORIES,
} from "../codex";
import { blurOnEnter } from "../ui";
import CodexBody from "./CodexBody";

interface Props {
    read: () => Promise<string>;
    write: (content: string) => Promise<void>;
    onSaved?: (info: { title: string; category: string }) => void;
    fallbackTitle: string;
    // Categories already used elsewhere in the project, offered as datalist
    // suggestions alongside SUGGESTED_CATEGORIES.
    categories: string[];
}

type SaveState = "idle" | "unsaved" | "saved" | "error";
type Mode = "view" | "edit";

const AUTOSAVE_DELAY_MS = 800;

// A world-building wiki entry editor backed by JSON. Reuses the same debounced,
// flush-on-unmount autosave mechanics as CharacterEditor/DocEditor, and the same
// view/edit toggle as the character sheet. Remount (via key) to switch entries.
export default function CodexEditor({ read, write, onSaved, fallbackTitle, categories }: Props) {
    const [loaded, setLoaded] = useState(false);
    const [entry, setEntry] = useState<CodexEntry>(emptyCodexEntry);
    const [mode, setMode] = useState<Mode>("view");
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");
    // Whether the optional pronunciation field is revealed in edit mode. It also
    // shows whenever a pronunciation is already set.
    const [showPron, setShowPron] = useState(false);

    const saveTimer = useRef<number | undefined>(undefined);
    const entryRef = useRef<CodexEntry>(emptyCodexEntry());
    const dirtyRef = useRef(false);

    useEffect(() => {
        read()
            .then((content) => {
                const parsed = parseCodexEntry(content);
                entryRef.current = parsed;
                setEntry(parsed);
                // Fresh, unfilled entries open in edit mode; ones with content
                // open read-only so the page reads like a wiki article.
                setMode(isEmptyCodexEntry(parsed) ? "edit" : "view");
                setLoaded(true);
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                write(serializeCodexEntry(entryRef.current)).catch(() => {});
            }
        };
    }, []);

    async function saveNow() {
        window.clearTimeout(saveTimer.current);
        const e = entryRef.current;
        try {
            await write(serializeCodexEntry(e));
            dirtyRef.current = false;
            setSaveState("saved");
            onSaved?.({ title: e.title.trim() || fallbackTitle, category: e.category.trim() });
        } catch (err) {
            setSaveState("error");
            setError(String(err));
        }
    }

    function scheduleSave() {
        dirtyRef.current = true;
        setSaveState("unsaved");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(saveNow, AUTOSAVE_DELAY_MS);
    }

    function update(patch: Partial<CodexEntry>) {
        const next = { ...entryRef.current, ...patch };
        entryRef.current = next;
        setEntry(next);
        scheduleSave();
    }

    // Split a line into runs, rendering **bold** spans as <strong>.
    function renderInline(text: string) {
        return text.split(/(\*\*[\s\S]+?\*\*)/g).map((part, i) => {
            const b = part.match(/^\*\*([\s\S]+?)\*\*$/);
            return b ? <strong key={i}>{b[1]}</strong> : part;
        });
    }

    // Render the read view of the body: bullet lines get a hanging indent (so
    // wrapped overhang aligns under the text), with nesting from leading spaces.
    function renderBody(body: string) {
        return body.split("\n").map((line, i) => {
            const m = line.match(/^(\s*)([•▪★])\s?(.*)$/);
            if (m) {
                const level = Math.floor(m[1].length / 4);
                return (
                    <div
                        key={i}
                        className="codex-view-bullet"
                        style={{ marginLeft: `${level * 1.4}em` }}
                    >
                        {`${m[2]} `}
                        {renderInline(m[3])}
                    </div>
                );
            }
            if (line.trim() === "") return <div key={i} className="codex-view-gap" />;
            return (
                <div key={i} className="codex-view-line">
                    {renderInline(line)}
                </div>
            );
        });
    }

    if (error && !loaded) {
        return (
            <div className="view">
                <p className="subtitle">{error}</p>
            </div>
        );
    }
    if (!loaded) return <div className="editor-pane" />;

    // Existing categories first, then any suggested ones not already present.
    const options = [
        ...categories,
        ...SUGGESTED_CATEGORIES.filter((c) => !categories.includes(c)),
    ];

    return (
        <div className="character-sheet">
            <div className="sheet-toolbar">
                <button
                    className="mode-toggle"
                    onClick={() => setMode((m) => (m === "edit" ? "view" : "edit"))}
                >
                    {mode === "edit" ? "Done" : "Edit"}
                </button>
            </div>

            {mode === "edit" ? (
                <>
                    <input
                        className="editor-title"
                        value={entry.title}
                        onChange={(e) => update({ title: e.target.value })}
                        onKeyDown={blurOnEnter}
                        placeholder="Entry title"
                        spellCheck
                    />
                    {entry.pronunciation.trim() || showPron ? (
                        <label className="field">
                            <span className="field-label">Pronunciation</span>
                            <div className="field-inline">
                                <input
                                    className="field-input"
                                    value={entry.pronunciation}
                                    onChange={(e) => update({ pronunciation: e.target.value })}
                                    onKeyDown={blurOnEnter}
                                    placeholder="e.g. AZ-er-oth · /ˈæzɛrɒθ/"
                                    autoFocus={!entry.pronunciation}
                                />
                                <button
                                    className="attr-remove"
                                    title="Remove pronunciation"
                                    onClick={() => {
                                        update({ pronunciation: "" });
                                        setShowPron(false);
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                        </label>
                    ) : (
                        <button
                            className="attr-add pron-add"
                            onClick={() => setShowPron(true)}
                        >
                            + Add pronunciation
                        </button>
                    )}
                    <label className="field">
                        <span className="field-label">Category</span>
                        <input
                            className="field-input"
                            value={entry.category}
                            onChange={(e) => update({ category: e.target.value })}
                            onKeyDown={blurOnEnter}
                            placeholder="e.g. Magic, Politics, Locations"
                            list="codex-categories"
                            spellCheck
                        />
                        <datalist id="codex-categories">
                            {options.map((c) => (
                                <option key={c} value={c} />
                            ))}
                        </datalist>
                    </label>
                    <CodexBody value={entry.body} onChange={(v) => update({ body: v })} />

                    <div className="editor-status">
                        <span className="save-status-spacer" />
                        <span className={`save-status ${saveState}`}>
                            {saveState === "unsaved" && "Saving…"}
                            {saveState === "saved" && "Saved"}
                            {saveState === "error" && `Could not save: ${error}`}
                        </span>
                    </div>
                </>
            ) : (
                <div className="sheet-view">
                    <h1 className="view-name">{entry.title.trim() || fallbackTitle}</h1>
                    {entry.pronunciation.trim() && (
                        <div className="view-pronunciation">{entry.pronunciation}</div>
                    )}
                    {entry.category.trim() && (
                        <div className="view-role">{entry.category}</div>
                    )}
                    {entry.body.trim() ? (
                        <div className="view-bio codex-body">{renderBody(entry.body)}</div>
                    ) : (
                        <p className="view-empty">
                            Nothing written yet. Press Edit to start this entry.
                        </p>
                    )}
                </div>
            )}
        </div>
    );
}
