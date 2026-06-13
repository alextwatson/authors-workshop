import { useEffect, useRef, useState } from "react";
import {
    ListChapters,
    ListCharacters,
    ListScenes,
    ReadCharacter,
    ReadOutline,
    WriteOutline,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import { Section } from "../Sidebar";
import { parseCharacter } from "../../characters";
import { newId } from "../../docnames";
import {
    EmotionalState,
    OutlineGroup,
    OutlineNode,
    Scale,
    parseGroups,
    parseOutline,
    parseScales,
    serializeOutline,
} from "../../outline";

interface Props {
    project: main.Project;
    focusId: string | null;
    onNavigate: (section: Section, focusId?: string | null) => void;
}

type SaveState = "idle" | "unsaved" | "saved" | "error";
type Selection = { kind: "node" | "group"; id: string };
type CharRef = { id: string; name: string };

const AUTOSAVE_DELAY_MS = 800;
const BAR_MAX_PX = 44;

function charName(chars: CharRef[], id: string): string {
    const c = chars.find((x) => x.id === id);
    return c ? c.name || c.id.replace(/\.json$/, "") : "(unknown)";
}

// Fraction 0..1 of where `value` sits on [min, max], clamped. "" → null.
function normalize(value: string, scale: Scale | undefined): number | null {
    if (!scale || value.trim() === "") return null;
    const v = Number(value);
    if (!Number.isFinite(v) || scale.max === scale.min) return null;
    return Math.max(0, Math.min(1, (v - scale.min) / (scale.max - scale.min)));
}

export default function ArcView({ project, focusId, onNavigate }: Props) {
    const [nodes, setNodes] = useState<OutlineNode[]>([]);
    const [groups, setGroups] = useState<OutlineGroup[]>([]);
    const [scales, setScales] = useState<Scale[]>([]);
    const [chars, setChars] = useState<CharRef[]>([]);
    const [titles, setTitles] = useState<Record<string, string>>({});
    const [selected, setSelected] = useState<Selection | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const nodesRef = useRef<OutlineNode[]>([]);
    const groupsRef = useRef<OutlineGroup[]>([]);
    const scalesRef = useRef<Scale[]>([]);
    const dirtyRef = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);

    useEffect(() => {
        Promise.all([
            ReadOutline(project.path),
            ListScenes(project.path),
            ListChapters(project.path),
            ListCharacters(project.path),
        ])
            .then(async ([json, sceneList, chapterList, charNames]) => {
                const parsedNodes = parseOutline(json);
                const parsedGroups = parseGroups(json);
                const parsedScales = parseScales(json);
                nodesRef.current = parsedNodes;
                groupsRef.current = parsedGroups;
                scalesRef.current = parsedScales;
                setNodes(parsedNodes);
                setGroups(parsedGroups);
                setScales(parsedScales);
                const titleMap: Record<string, string> = {};
                for (const d of [...sceneList, ...chapterList]) titleMap[d.filename] = d.title;
                setTitles(titleMap);
                const refs = await Promise.all(
                    charNames.map(async (filename) => {
                        const content = await ReadCharacter(project.path, filename).catch(() => "");
                        return { id: filename, name: parseCharacter(content).name };
                    })
                );
                setChars(refs);
                if (focusId) setSelected({ kind: "node", id: focusId });
                setLoaded(true);
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                WriteOutline(
                    project.path,
                    serializeOutline(nodesRef.current, groupsRef.current, scalesRef.current)
                ).catch(() => {});
            }
        };
    }, [project.path]);

    function scheduleSave() {
        dirtyRef.current = true;
        setSaveState("unsaved");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
            try {
                await WriteOutline(
                    project.path,
                    serializeOutline(nodesRef.current, groupsRef.current, scalesRef.current)
                );
                dirtyRef.current = false;
                setSaveState("saved");
            } catch (err) {
                setSaveState("error");
                setError(String(err));
            }
        }, AUTOSAVE_DELAY_MS);
    }

    // Apply a transform to the selected object's emotions, in both the rendered
    // state and the ref the autosave reads, then debounce a save.
    function editEmotions(sel: Selection, fn: (es: EmotionalState[]) => EmotionalState[]) {
        if (sel.kind === "node") {
            const next = nodesRef.current.map((n) =>
                n.id === sel.id ? { ...n, emotions: fn(n.emotions) } : n
            );
            nodesRef.current = next;
            setNodes(next);
        } else {
            const next = groupsRef.current.map((g) =>
                g.id === sel.id ? { ...g, emotions: fn(g.emotions) } : g
            );
            groupsRef.current = next;
            setGroups(next);
        }
        scheduleSave();
    }

    function addEmotion(sel: Selection) {
        editEmotions(sel, (es) => [
            ...es,
            { id: newId(), characterId: chars[0]?.id ?? "", text: "", value: "", scaleId: "" },
        ]);
    }

    function patchEmotion(sel: Selection, id: string, patch: Partial<EmotionalState>) {
        editEmotions(sel, (es) => es.map((e) => (e.id === id ? { ...e, ...patch } : e)));
    }

    function removeEmotion(sel: Selection, id: string) {
        editEmotions(sel, (es) => es.filter((e) => e.id !== id));
    }

    function setScalesAnd(next: Scale[]) {
        scalesRef.current = next;
        setScales(next);
        scheduleSave();
    }

    function addScale() {
        setScalesAnd([...scalesRef.current, { id: newId(), label: "New scale", min: 1, max: 10 }]);
    }

    function patchScale(id: string, patch: Partial<Scale>) {
        setScalesAnd(scalesRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s)));
    }

    function removeScale(id: string) {
        // Detach the scale from any emotion referencing it so no dangling ids remain.
        const detach = (es: EmotionalState[]) =>
            es.map((e) => (e.scaleId === id ? { ...e, scaleId: "" } : e));
        nodesRef.current = nodesRef.current.map((n) => ({ ...n, emotions: detach(n.emotions) }));
        groupsRef.current = groupsRef.current.map((g) => ({ ...g, emotions: detach(g.emotions) }));
        setNodes(nodesRef.current);
        setGroups(groupsRef.current);
        setScalesAnd(scalesRef.current.filter((s) => s.id !== id));
    }

    function emotionsOf(sel: Selection): EmotionalState[] {
        if (sel.kind === "node") return nodes.find((n) => n.id === sel.id)?.emotions ?? [];
        return groups.find((g) => g.id === sel.id)?.emotions ?? [];
    }

    function nodeTitle(n: OutlineNode): string {
        if (n.kind === "point") return n.title || "Story point";
        return titles[n.file] || n.title || n.file;
    }

    function glyph(n: OutlineNode): string {
        return n.kind === "scene" ? "◇" : n.kind === "chapter" ? "§" : "•";
    }

    // The set of characters that actually have a state somewhere, so empty
    // rows don't clutter the grid. Falls back to all characters when none yet.
    function activeCharIds(): string[] {
        const ids = new Set<string>();
        for (const n of nodes) for (const e of n.emotions) if (e.characterId) ids.add(e.characterId);
        for (const g of groups) for (const e of g.emotions) if (e.characterId) ids.add(e.characterId);
        const ordered = chars.map((c) => c.id).filter((id) => ids.has(id));
        return ordered.length > 0 ? ordered : chars.map((c) => c.id);
    }

    function emotionCell(charId: string, emotions: EmotionalState[]) {
        const mine = emotions.filter((e) => e.characterId === charId);
        if (mine.length === 0) return <span className="arc-cell-empty">·</span>;
        return (
            <div className="arc-cell-states">
                {mine.map((e) => {
                    const scale = scales.find((s) => s.id === e.scaleId);
                    const frac = normalize(e.value, scale);
                    return (
                        <div className="arc-state" key={e.id}>
                            {frac !== null && (
                                <span className="arc-bar-wrap" title={`${e.value} (${scale?.label})`}>
                                    <span
                                        className="arc-bar"
                                        style={{ height: Math.round(frac * BAR_MAX_PX) || 2 }}
                                    />
                                    <span className="arc-bar-num">{e.value}</span>
                                </span>
                            )}
                            {e.text && <span className="arc-state-text">{e.text}</span>}
                        </div>
                    );
                })}
            </div>
        );
    }

    if (!loaded) {
        return (
            <div className="view">
                <h2>Emotional Arc</h2>
                <p className="subtitle">{error || "Loading…"}</p>
            </div>
        );
    }

    const charIds = activeCharIds();
    const sel = selected;
    const selObject =
        sel?.kind === "node"
            ? nodes.find((n) => n.id === sel.id)
            : sel?.kind === "group"
            ? groups.find((g) => g.id === sel.id)
            : undefined;

    return (
        <div className="arc">
            <div className="arc-head">
                <h2>Emotional Arc</h2>
                <span className={`save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${error}`}
                </span>
            </div>
            <p className="subtitle">
                Track how each character feels across the story's beats. Click a moment or plot
                arc to add states.
            </p>

            {nodes.length === 0 ? (
                <div className="placeholder">
                    No outline yet. Build your story's spine in the Outline first, then map
                    emotions onto it.
                </div>
            ) : chars.length === 0 ? (
                <div className="placeholder">
                    No characters yet. Add characters first — emotional states are tied to them.
                </div>
            ) : (
                <div className="arc-grid-scroll">
                    <table className="arc-grid">
                        <thead>
                            {groups.length > 0 && (
                                <tr className="arc-arc-row">
                                    <th className="arc-corner" />
                                    {nodes.map((n) => {
                                        const g = groups.find((gr) => gr.members.includes(n.id));
                                        return (
                                            <th key={n.id} className="arc-arc-cell">
                                                {g && (
                                                    <button
                                                        className={`arc-arc-chip ${g.color}`}
                                                        title="Edit this plot arc's emotions"
                                                        onClick={() =>
                                                            setSelected({ kind: "group", id: g.id })
                                                        }
                                                    >
                                                        {g.label || "Plot arc"}
                                                    </button>
                                                )}
                                            </th>
                                        );
                                    })}
                                </tr>
                            )}
                            <tr className="arc-obj-row">
                                <th className="arc-corner">Character</th>
                                {nodes.map((n) => (
                                    <th
                                        key={n.id}
                                        className={`arc-obj ${
                                            sel?.kind === "node" && sel.id === n.id ? "selected" : ""
                                        }`}
                                    >
                                        <button
                                            className="arc-obj-btn"
                                            onClick={() => setSelected({ kind: "node", id: n.id })}
                                        >
                                            <span className="arc-obj-glyph">{glyph(n)}</span>
                                            <span className="arc-obj-title">{nodeTitle(n)}</span>
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {charIds.map((cid) => (
                                <tr key={cid}>
                                    <th className="arc-char">{charName(chars, cid)}</th>
                                    {nodes.map((n) => (
                                        <td
                                            key={n.id}
                                            className={`arc-cell ${
                                                sel?.kind === "node" && sel.id === n.id
                                                    ? "selected"
                                                    : ""
                                            }`}
                                            onClick={() => setSelected({ kind: "node", id: n.id })}
                                        >
                                            {emotionCell(cid, n.emotions)}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {sel && selObject && (
                <div className="arc-editor">
                    <div className="arc-editor-head">
                        <span className="arc-editor-title">
                            {sel.kind === "group"
                                ? `Plot arc: ${(selObject as OutlineGroup).label || "Untitled"}`
                                : nodeTitle(selObject as OutlineNode)}
                        </span>
                        <button
                            className="arc-link"
                            title="Jump to this in the Outline"
                            onClick={() =>
                                onNavigate(
                                    "outline",
                                    sel.kind === "node"
                                        ? sel.id
                                        : (selObject as OutlineGroup).members[0] ?? null
                                )
                            }
                        >
                            open in outline →
                        </button>
                        <button className="arc-editor-close" onClick={() => setSelected(null)}>
                            ✕
                        </button>
                    </div>
                    <div className="arc-emotions">
                        {emotionsOf(sel).length === 0 && (
                            <p className="arc-empty-hint">No emotional states here yet.</p>
                        )}
                        {emotionsOf(sel).map((e) => (
                            <div className="arc-emotion-row" key={e.id}>
                                <select
                                    className="arc-em-char"
                                    value={e.characterId}
                                    onChange={(ev) =>
                                        patchEmotion(sel, e.id, { characterId: ev.target.value })
                                    }
                                >
                                    {chars.map((c) => (
                                        <option key={c.id} value={c.id}>
                                            {c.name || c.id.replace(/\.json$/, "")}
                                        </option>
                                    ))}
                                </select>
                                <input
                                    className="arc-em-text"
                                    value={e.text}
                                    placeholder="How they feel…"
                                    onChange={(ev) =>
                                        patchEmotion(sel, e.id, { text: ev.target.value })
                                    }
                                    spellCheck
                                />
                                <select
                                    className="arc-em-scale"
                                    value={e.scaleId}
                                    onChange={(ev) =>
                                        patchEmotion(sel, e.id, { scaleId: ev.target.value })
                                    }
                                >
                                    <option value="">no scale</option>
                                    {scales.map((s) => (
                                        <option key={s.id} value={s.id}>
                                            {s.label}
                                        </option>
                                    ))}
                                </select>
                                {e.scaleId && (
                                    <input
                                        type="number"
                                        className="arc-em-value"
                                        value={e.value}
                                        placeholder="—"
                                        onChange={(ev) =>
                                            patchEmotion(sel, e.id, { value: ev.target.value })
                                        }
                                    />
                                )}
                                <button
                                    className="arc-em-remove"
                                    title="Remove"
                                    onClick={() => removeEmotion(sel, e.id)}
                                >
                                    ✕
                                </button>
                            </div>
                        ))}
                        <button className="arc-add" onClick={() => addEmotion(sel)}>
                            + Add emotional state
                        </button>
                    </div>
                </div>
            )}

            <div className="arc-scales">
                <div className="arc-scales-head">Scales</div>
                <p className="arc-scales-hint">
                    Define numeric scales (e.g. Trust 1–10) to plot states as bars.
                </p>
                {scales.map((s) => (
                    <div className="arc-scale-row" key={s.id}>
                        <input
                            className="arc-scale-label"
                            value={s.label}
                            placeholder="Scale name"
                            onChange={(e) => patchScale(s.id, { label: e.target.value })}
                        />
                        <label>
                            min
                            <input
                                type="number"
                                value={s.min}
                                onChange={(e) => patchScale(s.id, { min: Number(e.target.value) })}
                            />
                        </label>
                        <label>
                            max
                            <input
                                type="number"
                                value={s.max}
                                onChange={(e) => patchScale(s.id, { max: Number(e.target.value) })}
                            />
                        </label>
                        <button
                            className="arc-em-remove"
                            title="Remove scale"
                            onClick={() => removeScale(s.id)}
                        >
                            ✕
                        </button>
                    </div>
                ))}
                <button className="arc-add" onClick={addScale}>
                    + Add scale
                </button>
            </div>
        </div>
    );
}
