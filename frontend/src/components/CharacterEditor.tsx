import { useEffect, useRef, useState } from "react";
import {
    ArcPoint,
    Character,
    CharAttr,
    DEFAULT_SCALE_MAX,
    DEFAULT_SCALE_MIN,
    emptyCharacter,
    parseCharacter,
    serializeCharacter,
} from "../characters";
import { newId } from "../docnames";

export interface OutlineMoment {
    id: string;
    label: string;
}

interface Props {
    read: () => Promise<string>;
    write: (content: string) => Promise<void>;
    onSaved?: (info: { name: string }) => void;
    fallbackName: string;
    // Outline objects this character's arc points can connect to.
    outlineMoments: OutlineMoment[];
    onJumpToOutline: (outlineId: string) => void;
}

type SaveState = "idle" | "unsaved" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

// A structured character sheet editor backed by JSON. Reuses DocEditor's
// debounced, flush-on-unmount autosave mechanics. Remount (via key) to switch
// characters.
export default function CharacterEditor({
    read,
    write,
    onSaved,
    fallbackName,
    outlineMoments,
    onJumpToOutline,
}: Props) {
    const [loaded, setLoaded] = useState(false);
    const [character, setCharacter] = useState<Character>(emptyCharacter);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const saveTimer = useRef<number | undefined>(undefined);
    const charRef = useRef<Character>(emptyCharacter());
    const dirtyRef = useRef(false);

    useEffect(() => {
        read()
            .then((content) => {
                const parsed = parseCharacter(content);
                charRef.current = parsed;
                setCharacter(parsed);
                setLoaded(true);
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                write(serializeCharacter(charRef.current)).catch(() => {});
            }
        };
    }, []);

    async function saveNow() {
        window.clearTimeout(saveTimer.current);
        const c = charRef.current;
        try {
            await write(serializeCharacter(c));
            dirtyRef.current = false;
            setSaveState("saved");
            onSaved?.({ name: c.name.trim() || fallbackName });
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

    // Apply a change to the working character: update both the rendered state
    // and the ref the autosave/flush reads from, then debounce a save.
    function update(patch: Partial<Character>) {
        const next = { ...charRef.current, ...patch };
        charRef.current = next;
        setCharacter(next);
        scheduleSave();
    }

    function updateAttr(id: string, patch: Partial<CharAttr>) {
        update({
            attrs: charRef.current.attrs.map((a) => (a.id === id ? { ...a, ...patch } : a)),
        });
    }

    function addAttr() {
        update({
            attrs: [
                ...charRef.current.attrs,
                {
                    id: newId(),
                    label: "",
                    type: "text",
                    value: "",
                    min: DEFAULT_SCALE_MIN,
                    max: DEFAULT_SCALE_MAX,
                },
            ],
        });
    }

    function removeAttr(id: string) {
        update({ attrs: charRef.current.attrs.filter((a) => a.id !== id) });
    }

    function addArcPoint() {
        update({
            arc: [...charRef.current.arc, { id: newId(), text: "", outlineId: "" }],
        });
    }

    function patchArcPoint(id: string, patch: Partial<ArcPoint>) {
        update({
            arc: charRef.current.arc.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        });
    }

    function removeArcPoint(id: string) {
        update({ arc: charRef.current.arc.filter((p) => p.id !== id) });
    }

    // Swap a point with its neighbour to reorder the emotional sequence.
    function moveArcPoint(id: string, dir: -1 | 1) {
        const arc = [...charRef.current.arc];
        const i = arc.findIndex((p) => p.id === id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= arc.length) return;
        [arc[i], arc[j]] = [arc[j], arc[i]];
        update({ arc });
    }

    if (error && !loaded) {
        return (
            <div className="view">
                <p className="subtitle">{error}</p>
            </div>
        );
    }
    if (!loaded) return <div className="editor-pane" />;

    return (
        <div className="character-sheet">
            <input
                className="editor-title"
                value={character.name}
                onChange={(e) => update({ name: e.target.value })}
                placeholder="Character name"
                spellCheck
            />
            <label className="field">
                <span className="field-label">Role</span>
                <input
                    className="field-input"
                    value={character.role}
                    onChange={(e) => update({ role: e.target.value })}
                    placeholder="e.g. Protagonist, Antagonist, Mentor"
                    spellCheck
                />
            </label>
            <label className="field">
                <span className="field-label">Bio</span>
                <textarea
                    className="field-input field-textarea"
                    value={character.bio}
                    onChange={(e) => update({ bio: e.target.value })}
                    placeholder="A short summary of who they are."
                    spellCheck
                />
            </label>

            <div className="attrs">
                <div className="attrs-heading">Attributes</div>
                {character.attrs.map((attr) => (
                    <div className="attr-row" key={attr.id}>
                        <div className="attr-top">
                            <input
                                className="attr-label"
                                value={attr.label}
                                onChange={(e) => updateAttr(attr.id, { label: e.target.value })}
                                placeholder="Attribute name"
                                spellCheck
                            />
                            <select
                                className="attr-type"
                                value={attr.type}
                                onChange={(e) =>
                                    updateAttr(attr.id, {
                                        type: e.target.value === "scale" ? "scale" : "text",
                                    })
                                }
                            >
                                <option value="text">Text</option>
                                <option value="scale">Scale</option>
                            </select>
                            <button
                                className="attr-remove"
                                title="Remove attribute"
                                onClick={() => removeAttr(attr.id)}
                            >
                                ✕
                            </button>
                        </div>
                        {attr.type === "text" ? (
                            <textarea
                                className="field-input field-textarea"
                                value={attr.value}
                                onChange={(e) => updateAttr(attr.id, { value: e.target.value })}
                                placeholder="Description…"
                                spellCheck
                            />
                        ) : (
                            <div className="attr-scale">
                                <input
                                    type="number"
                                    className="attr-scale-value"
                                    value={attr.value}
                                    min={attr.min}
                                    max={attr.max}
                                    onChange={(e) => updateAttr(attr.id, { value: e.target.value })}
                                    placeholder="—"
                                />
                                <span className="attr-scale-range">
                                    <label>
                                        min
                                        <input
                                            type="number"
                                            value={attr.min}
                                            onChange={(e) =>
                                                updateAttr(attr.id, {
                                                    min: Number(e.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                    <label>
                                        max
                                        <input
                                            type="number"
                                            value={attr.max}
                                            onChange={(e) =>
                                                updateAttr(attr.id, {
                                                    max: Number(e.target.value),
                                                })
                                            }
                                        />
                                    </label>
                                </span>
                            </div>
                        )}
                    </div>
                ))}
                <button className="attr-add" onClick={addAttr}>
                    + Add Attribute
                </button>
            </div>

            <div className="arc-section">
                <div className="attrs-heading">Emotional Arc</div>
                <p className="arc-section-hint">
                    A few words per beat. Optionally connect a beat to a moment in your outline.
                </p>
                {character.arc.map((point, i) => {
                    const linked = outlineMoments.find((m) => m.id === point.outlineId);
                    return (
                        <div className="arc-point-row" key={point.id}>
                            <div className="arc-point-move">
                                <button
                                    title="Move up"
                                    disabled={i === 0}
                                    onClick={() => moveArcPoint(point.id, -1)}
                                >
                                    ↑
                                </button>
                                <button
                                    title="Move down"
                                    disabled={i === character.arc.length - 1}
                                    onClick={() => moveArcPoint(point.id, 1)}
                                >
                                    ↓
                                </button>
                            </div>
                            <input
                                className="arc-point-text"
                                value={point.text}
                                placeholder="e.g. hopeful"
                                onChange={(e) => patchArcPoint(point.id, { text: e.target.value })}
                                spellCheck
                            />
                            <select
                                className="arc-point-link"
                                value={point.outlineId}
                                onChange={(e) =>
                                    patchArcPoint(point.id, { outlineId: e.target.value })
                                }
                            >
                                <option value="">(link a moment)</option>
                                {outlineMoments.map((m) => (
                                    <option key={m.id} value={m.id}>
                                        {m.label}
                                    </option>
                                ))}
                                {point.outlineId && !linked && (
                                    <option value={point.outlineId}>(missing moment)</option>
                                )}
                            </select>
                            {point.outlineId && linked && (
                                <button
                                    className="arc-point-jump"
                                    title="Go to this moment in the Outline"
                                    onClick={() => onJumpToOutline(point.outlineId)}
                                >
                                    →
                                </button>
                            )}
                            <button
                                className="attr-remove"
                                title="Remove beat"
                                onClick={() => removeArcPoint(point.id)}
                            >
                                ✕
                            </button>
                        </div>
                    );
                })}
                <button className="attr-add" onClick={addArcPoint}>
                    + Add Beat
                </button>
            </div>

            <div className="editor-status">
                <span className="save-status-spacer" />
                <span className={`save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${error}`}
                </span>
            </div>
        </div>
    );
}
