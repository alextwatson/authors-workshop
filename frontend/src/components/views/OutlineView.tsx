import { useEffect, useRef, useState } from "react";
import {
    DeleteChapter,
    DeleteScene,
    ListChapters,
    ListScenes,
    ListTrash,
    PromoteSceneToChapter,
    ReadChapter,
    ReadOutline,
    ReadScene,
    RestoreTrashItem,
    WriteChapter,
    WriteOutline,
    WriteScene,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import DocEditor, { countWords, parseDoc } from "../DocEditor";
import { newId, nextNumberedFilename } from "../../docnames";
import {
    DocKind,
    OutlineNode,
    TagColor,
    parseOutline,
    serializeOutline,
} from "../../outline";

interface Props {
    project: main.Project;
}

type DocRef = { kind: DocKind; file: string };
type SaveState = "idle" | "unsaved" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;
const SWATCHES: TagColor[] = ["dark", "green", "orange"];
const NOTE_WORD_CAP = 40;

// Cut text off at the end of the nth word, preserving internal whitespace.
function limitWords(text: string, cap: number): string {
    if (countWords(text) <= cap) return text;
    const match = text.match(new RegExp(`^(?:\\s*\\S+){1,${cap}}`));
    return match ? match[0] : text;
}

function autoGrow(el: HTMLTextAreaElement | null) {
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
}

// The default drag image is a snapshot clipped by scroll containers, which
// cuts chips near the board edge in half. Snapshot an offscreen clone instead.
function setDragGhost(e: React.DragEvent, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const clone = el.cloneNode(true) as HTMLElement;
    clone.style.position = "fixed";
    clone.style.top = "-1000px";
    clone.style.left = "-1000px";
    clone.style.width = `${rect.width}px`;
    clone.style.margin = "0";
    document.body.appendChild(clone);
    e.dataTransfer.setDragImage(clone, e.clientX - rect.left, e.clientY - rect.top);
    window.setTimeout(() => clone.remove(), 0);
}

// Chapters hanging off a scene get folded into the spine right after it,
// so chapter order always reads top to bottom.
function normalizeNodes(ns: OutlineNode[]): OutlineNode[] {
    const out: OutlineNode[] = [];
    for (const n of ns) {
        const chapterArms = n.kind === "scene" ? n.arms.filter((a) => a.kind === "chapter") : [];
        if (chapterArms.length === 0) {
            out.push(n);
            continue;
        }
        out.push({ ...n, arms: n.arms.filter((a) => a.kind !== "chapter") });
        for (const a of chapterArms) {
            out.push({
                id: newId(),
                kind: "chapter",
                title: "",
                note: "",
                tag: "",
                tagLabel: "",
                file: a.file,
                arms: [],
            });
        }
    }
    return out;
}

export default function OutlineView({ project }: Props) {
    const [nodes, setNodes] = useState<OutlineNode[]>([]);
    const [scenes, setScenes] = useState<main.ChapterInfo[]>([]);
    const [chapters, setChapters] = useState<main.ChapterInfo[]>([]);
    const [trashItems, setTrashItems] = useState<main.TrashItem[]>([]);
    const [editing, setEditing] = useState<DocRef | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const nodesRef = useRef<OutlineNode[]>([]);
    const dirtyRef = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const dragData = useRef<
        { type: "node"; index: number } | { type: "arm"; nodeId: string; armId: string } | null
    >(null);
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);

    useEffect(() => {
        Promise.all([
            ReadOutline(project.path),
            ListScenes(project.path),
            ListChapters(project.path),
            ListTrash(),
        ])
            .then(([json, sceneList, chapterList, trashList]) => {
                const original = parseOutline(json);
                let parsed = original;
                const inList = (kind: DocKind, file: string) =>
                    (kind === "scene" ? sceneList : chapterList).some((d) => d.filename === file);
                // A doc converted from the Manuscript view keeps its filename
                // but switches folders — flip the outline ref's kind to match.
                const flipKind = (kind: DocKind, file: string): DocKind => {
                    const other: DocKind = kind === "scene" ? "chapter" : "scene";
                    return !inList(kind, file) && inList(other, file) ? other : kind;
                };
                parsed = parsed.map((n) => ({
                    ...n,
                    kind: n.kind === "point" ? n.kind : flipKind(n.kind as DocKind, n.file),
                    arms: n.arms.map((a) => ({ ...a, kind: flipKind(a.kind, a.file) })),
                }));
                // Files that are neither on disk nor in the trash are gone for
                // good (trash emptied or app restarted) — drop their outline
                // objects so the spine reconnects around them.
                const exists = (kind: DocKind, file: string) =>
                    inList(kind, file) ||
                    trashList.some(
                        (t) => t.kind === kind && t.filename === file && t.projectPath === project.path
                    );
                parsed = parsed
                    .filter((n) => n.kind === "point" || exists(n.kind as DocKind, n.file))
                    .map((n) => ({ ...n, arms: n.arms.filter((a) => exists(a.kind, a.file)) }));
                parsed = normalizeNodes(parsed);
                const changed =
                    serializeOutline(parsed) !== serializeOutline(original);
                nodesRef.current = parsed;
                setNodes(parsed);
                setScenes(sceneList);
                setChapters(chapterList);
                setTrashItems(trashList);
                setLoaded(true);
                if (changed) {
                    WriteOutline(project.path, serializeOutline(parsed)).catch(() => {});
                }
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                WriteOutline(project.path, serializeOutline(nodesRef.current)).catch(() => {});
            }
        };
    }, [project.path]);

    function mutate(update: (ns: OutlineNode[]) => OutlineNode[]) {
        const next = normalizeNodes(update(nodesRef.current));
        nodesRef.current = next;
        setNodes(next);
        dirtyRef.current = true;
        setSaveState("unsaved");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
            try {
                await WriteOutline(project.path, serializeOutline(nodesRef.current));
                dirtyRef.current = false;
                setSaveState("saved");
            } catch (err) {
                setSaveState("error");
                setError(String(err));
            }
        }, AUTOSAVE_DELAY_MS);
    }

    function patchNode(id: string, patch: Partial<OutlineNode>) {
        mutate((ns) => ns.map((n) => (n.id === id ? { ...n, ...patch } : n)));
    }

    function docInfo(ref: DocRef): main.ChapterInfo | undefined {
        const list = ref.kind === "scene" ? scenes : chapters;
        return list.find((d) => d.filename === ref.file);
    }

    function updateDocList(ref: DocRef, info: { title: string; wordCount: number }) {
        const apply = (list: main.ChapterInfo[]) => {
            const entry = main.ChapterInfo.createFrom({ filename: ref.file, ...info });
            return list.some((d) => d.filename === ref.file)
                ? list.map((d) => (d.filename === ref.file ? entry : d))
                : [...list, entry];
        };
        if (ref.kind === "scene") setScenes(apply);
        else setChapters(apply);
    }

    async function createDoc(kind: DocKind, title: string, body: string): Promise<string> {
        if (kind === "scene") {
            const { filename, number } = nextNumberedFilename(scenes, "scene");
            await WriteScene(project.path, filename, `# ${title || `Scene ${number}`}\n\n${body}`);
            setScenes(await ListScenes(project.path));
            return filename;
        }
        const { filename, number } = nextNumberedFilename(chapters, "chapter");
        await WriteChapter(project.path, filename, `# ${title || `Chapter ${number}`}\n\n${body}`);
        setChapters(await ListChapters(project.path));
        return filename;
    }

    function addPoint() {
        mutate((ns) => [
            ...ns,
            { id: newId(), kind: "point", title: "", note: "", tag: "", tagLabel: "", file: "", arms: [] },
        ]);
    }

    async function addDocNode(kind: DocKind) {
        try {
            const file = await createDoc(kind, "", "");
            mutate((ns) => [
                ...ns,
                { id: newId(), kind, title: "", note: "", tag: "", tagLabel: "", file, arms: [] },
            ]);
            setEditing({ kind, file });
        } catch (err) {
            setError(String(err));
        }
    }

    // Replace a story point with a scene document seeded from its title and note.
    async function convertToScene(node: OutlineNode) {
        try {
            const file = await createDoc("scene", node.title, node.note ? node.note + "\n" : "");
            patchNode(node.id, { kind: "scene", file, note: "" });
            setEditing({ kind: "scene", file });
        } catch (err) {
            setError(String(err));
        }
    }

    // Move the scene's file into the chapters folder and update its outline ref.
    async function makeChapter(n: OutlineNode) {
        try {
            const newName = await PromoteSceneToChapter(project.path, n.file);
            patchNode(n.id, { kind: "chapter", file: newName });
            await refreshLists();
        } catch (err) {
            setError(String(err));
        }
    }

    // Replace a short scene with a story point carrying its title and text.
    async function convertToPoint(node: OutlineNode) {
        try {
            const content = await ReadScene(project.path, node.file);
            const parsed = parseDoc(content);
            patchNode(node.id, {
                kind: "point",
                title: parsed.title || node.title,
                note: limitWords(parsed.body.trim(), NOTE_WORD_CAP),
                file: "",
            });
        } catch (err) {
            setError(String(err));
        }
    }

    async function addArm(nodeId: string, kind: DocKind) {
        try {
            const file = await createDoc(kind, "", "");
            mutate((ns) =>
                ns.map((n) =>
                    n.id === nodeId ? { ...n, arms: [...n.arms, { id: newId(), kind, file }] } : n
                )
            );
            setEditing({ kind, file });
        } catch (err) {
            setError(String(err));
        }
    }

    function removeArm(nodeId: string, armId: string) {
        mutate((ns) =>
            ns.map((n) =>
                n.id === nodeId ? { ...n, arms: n.arms.filter((a) => a.id !== armId) } : n
            )
        );
    }

    function deleteNode(id: string) {
        mutate((ns) => ns.filter((n) => n.id !== id));
    }

    async function refreshLists() {
        const [sceneList, chapterList, trashList] = await Promise.all([
            ListScenes(project.path),
            ListChapters(project.path),
            ListTrash(),
        ]);
        setScenes(sceneList);
        setChapters(chapterList);
        setTrashItems(trashList);
    }

    function findTrash(kind: DocKind, file: string): main.TrashItem | undefined {
        return trashItems.find(
            (t) => t.kind === kind && t.filename === file && t.projectPath === project.path
        );
    }

    function docState(kind: DocKind, file: string): "ok" | "trashed" {
        const list = kind === "scene" ? scenes : chapters;
        return list.some((d) => d.filename === file) ? "ok" : "trashed";
    }

    // Deleting from the outline trashes the file but keeps the outline object,
    // which then renders in its "deleted" state with restore/delete buttons.
    async function trashFile(kind: DocKind, file: string) {
        try {
            if (kind === "scene") await DeleteScene(project.path, file);
            else await DeleteChapter(project.path, file);
            await refreshLists();
        } catch (err) {
            setError(String(err));
        }
    }

    async function restoreDocNode(n: OutlineNode) {
        const item = findTrash(n.kind as DocKind, n.file);
        if (!item) return;
        try {
            const restoredName = await RestoreTrashItem(item.id);
            patchNode(n.id, { file: restoredName });
            await refreshLists();
        } catch (err) {
            setError(String(err));
        }
    }

    async function restoreArm(nodeId: string, armId: string, kind: DocKind, file: string) {
        const item = findTrash(kind, file);
        if (!item) return;
        try {
            const restoredName = await RestoreTrashItem(item.id);
            mutate((ns) =>
                ns.map((node) =>
                    node.id === nodeId
                        ? {
                              ...node,
                              arms: node.arms.map((a) =>
                                  a.id === armId ? { ...a, file: restoredName } : a
                              ),
                          }
                        : node
                )
            );
            await refreshLists();
        } catch (err) {
            setError(String(err));
        }
    }

    function canAttach(kind: DocKind, target: OutlineNode): boolean {
        if (target.kind === "point") return true;
        if (target.kind === "scene") return kind === "chapter";
        return false; // chapters take no arms
    }

    function endDrag() {
        dragData.current = null;
        setDragOverKey(null);
    }

    // Drop on a connector (or the end zone): insert at `index` in the spine.
    // Nodes reorder; arms detach from their point and join the main order.
    function dropInsert(index: number) {
        const d = dragData.current;
        endDrag();
        if (!d) return;
        if (d.type === "node") {
            if (d.index === index || d.index + 1 === index) return;
            mutate((ns) => {
                const next = [...ns];
                const [moved] = next.splice(d.index, 1);
                next.splice(d.index < index ? index - 1 : index, 0, moved);
                return next;
            });
            return;
        }
        const source = nodesRef.current.find((n) => n.id === d.nodeId);
        const arm = source?.arms.find((a) => a.id === d.armId);
        if (!arm) return;
        const spineNode: OutlineNode = {
            id: newId(),
            kind: arm.kind,
            title: "",
            note: "",
            tag: "",
            tagLabel: "",
            file: arm.file,
            arms: [],
        };
        mutate((ns) => {
            const next = ns.map((n) =>
                n.id === d.nodeId ? { ...n, arms: n.arms.filter((a) => a.id !== d.armId) } : n
            );
            next.splice(index, 0, spineNode);
            return next;
        });
    }

    // Drop on a card: an arm moves to that card; a spine scene/chapter
    // becomes an arm of it (its own arms come along, and the spine heals).
    // Story points just reorder in front of the target.
    function dropOnCard(index: number) {
        const d = dragData.current;
        const target = nodesRef.current[index];
        if (!d || !target) {
            endDrag();
            return;
        }
        if (d.type === "node") {
            const src = nodesRef.current[d.index];
            if (!src || src.id === target.id) {
                endDrag();
                return;
            }
            if (src.kind !== "point" && canAttach(src.kind as DocKind, target)) {
                endDrag();
                mutate((ns) =>
                    ns
                        .filter((n) => n.id !== src.id)
                        .map((n) =>
                            n.id === target.id
                                ? {
                                      ...n,
                                      arms: [
                                          ...n.arms,
                                          ...src.arms,
                                          { id: newId(), kind: src.kind as DocKind, file: src.file },
                                      ],
                                  }
                                : n
                        )
                );
                return;
            }
            dropInsert(index);
            return;
        }
        const source = nodesRef.current.find((n) => n.id === d.nodeId);
        const arm = source?.arms.find((a) => a.id === d.armId);
        endDrag();
        if (!arm || target.id === d.nodeId || !canAttach(arm.kind, target)) return;
        mutate((ns) =>
            ns.map((n) => {
                if (n.id === d.nodeId) return { ...n, arms: n.arms.filter((a) => a.id !== d.armId) };
                if (n.id === target.id) return { ...n, arms: [...n.arms, arm] };
                return n;
            })
        );
    }

    if (editing) {
        const path = editing.kind === "scene" ? `manuscript/scenes/${editing.file}` : `manuscript/${editing.file}`;
        return (
            <div className="outline">
                <div className="outline-editor-bar">
                    <button onClick={() => setEditing(null)}>← Outline</button>
                    <span className="editor-bar-label">
                        {editing.kind === "scene" ? "◇ Scene" : "§ Chapter"} · {path}
                    </span>
                    {editing.kind === "scene" && (
                        <span className="editor-bar-hint">
                            Keep it under {NOTE_WORD_CAP} words to be able to revert it to a story point
                        </span>
                    )}
                </div>
                <div className="editor-pane">
                    <DocEditor
                        key={`${editing.kind}:${editing.file}`}
                        read={() =>
                            editing.kind === "scene"
                                ? ReadScene(project.path, editing.file)
                                : ReadChapter(project.path, editing.file)
                        }
                        write={(content) =>
                            editing.kind === "scene"
                                ? WriteScene(project.path, editing.file, content)
                                : WriteChapter(project.path, editing.file, content)
                        }
                        onSaved={(info) => updateDocList(editing, info)}
                        fallbackTitle={editing.file.replace(/\.md$/, "")}
                    />
                </div>
            </div>
        );
    }

    function tagRow(n: OutlineNode) {
        return (
            <div className={`tag-row ${n.tag ? "has-tag" : ""}`}>
                {SWATCHES.map((c) => (
                    <button
                        key={c}
                        className={`swatch ${c} ${n.tag === c ? "on" : ""}`}
                        title={n.tag === c ? "Remove tag" : "Tag"}
                        onClick={() => patchNode(n.id, { tag: n.tag === c ? "" : c })}
                    />
                ))}
                {n.tag && (
                    <input
                        className={`tag-label ${n.tag}`}
                        value={n.tagLabel}
                        placeholder="tag"
                        onChange={(e) => patchNode(n.id, { tagLabel: e.target.value })}
                    />
                )}
            </div>
        );
    }

    return (
        <div className="outline">
            <div className="outline-board" onDragOver={(e) => e.preventDefault()}>
              <div className="outline-spine">
                {!loaded && !error && <p className="subtitle">Loading…</p>}
                {error && <p className="subtitle">{error}</p>}
                {loaded && nodes.length === 0 && (
                    <div className="placeholder outline-empty">
                        Your story's spine starts here. Add a story point or a scene below.
                    </div>
                )}
                {nodes.map((n, i) => (
                    <div key={n.id}>
                        {i > 0 && (
                            <div
                                className={`outline-connector ${
                                    dragOverKey === `conn-${i}` ? "drag-over" : ""
                                }`}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    setDragOverKey(`conn-${i}`);
                                }}
                                onDragLeave={() => setDragOverKey(null)}
                                onDrop={() => dropInsert(i)}
                            >
                                <span className="line" />
                                <span className="arrow">▼</span>
                            </div>
                        )}
                        <div
                            className="outline-node-wrap"
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverKey(`card-${n.id}`);
                            }}
                            onDragLeave={() => setDragOverKey(null)}
                            onDrop={() => dropOnCard(i)}
                        >
                            <div
                                className={`outline-card ${n.kind} ${
                                    dragOverKey === `card-${n.id}` ? "drag-over" : ""
                                }`}
                                draggable
                                onDragStart={(e) => {
                                    // Let text selection inside fields work normally.
                                    const t = e.target as HTMLElement;
                                    if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") {
                                        e.preventDefault();
                                        return;
                                    }
                                    e.stopPropagation();
                                    setDragGhost(e, e.currentTarget as HTMLElement);
                                    dragData.current = { type: "node", index: i };
                                }}
                                onDragEnd={endDrag}
                            >
                                {n.kind === "point" ? (
                                    <>
                                        <input
                                            className="op-title"
                                            value={n.title}
                                            placeholder="Story point"
                                            onChange={(e) => patchNode(n.id, { title: e.target.value })}
                                        />
                                        <textarea
                                            ref={autoGrow}
                                            className="op-note"
                                            value={n.note}
                                            placeholder="Notes…"
                                            rows={1}
                                            onChange={(e) => {
                                                patchNode(n.id, {
                                                    note: limitWords(e.target.value, NOTE_WORD_CAP),
                                                });
                                                autoGrow(e.target);
                                            }}
                                        />
                                        <div
                                            className={`op-count ${
                                                countWords(n.note) >= NOTE_WORD_CAP ? "at-cap" : ""
                                            }`}
                                        >
                                            {countWords(n.note)}/{NOTE_WORD_CAP} words
                                        </div>
                                        {tagRow(n)}
                                        <div className="card-actions">
                                            <button
                                                onClick={() => convertToScene(n)}
                                                title={`Scenes under ${NOTE_WORD_CAP} words can be turned back into story points`}
                                            >
                                                make scene
                                            </button>
                                            <button onClick={() => addArm(n.id, "scene")}>+ scene arm</button>
                                            <button onClick={() => addArm(n.id, "chapter")}>+ chapter arm</button>
                                            <button className="danger" onClick={() => deleteNode(n.id)}>
                                                delete
                                            </button>
                                        </div>
                                    </>
                                ) : docState(n.kind as DocKind, n.file) === "trashed" ? (
                                    <>
                                        <div className="doc-open trashed-doc">
                                            <span className="doc-glyph">{n.kind === "scene" ? "◇" : "§"}</span>
                                            <span className="doc-title">
                                                {findTrash(n.kind as DocKind, n.file)?.title ??
                                                    n.title ??
                                                    n.file}
                                            </span>
                                            <span className="deleted-label">deleted</span>
                                        </div>
                                        <div className="card-actions always">
                                            <button onClick={() => restoreDocNode(n)}>restore</button>
                                            <button
                                                className="danger"
                                                title="Remove from outline (file stays in Trash)"
                                                onClick={() => deleteNode(n.id)}
                                            >
                                                delete
                                            </button>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            className="doc-open"
                                            onClick={() => setEditing({ kind: n.kind as DocKind, file: n.file })}
                                        >
                                            <span className="doc-glyph">{n.kind === "scene" ? "◇" : "§"}</span>
                                            <span className="doc-title">
                                                {docInfo({ kind: n.kind as DocKind, file: n.file })?.title ??
                                                    n.title ??
                                                    n.file}
                                            </span>
                                            <span className="doc-words">
                                                {(docInfo({ kind: n.kind as DocKind, file: n.file })?.wordCount ?? 0).toLocaleString()}{" "}
                                                words
                                            </span>
                                        </button>
                                        {tagRow(n)}
                                        <div className="card-actions">
                                            {n.kind === "scene" &&
                                                (docInfo({ kind: "scene", file: n.file })?.wordCount ?? 0) <
                                                    NOTE_WORD_CAP && (
                                                    <button onClick={() => convertToPoint(n)}>
                                                        make story point
                                                    </button>
                                                )}
                                            {n.kind === "scene" && (
                                                <button
                                                    title="Move the file to chapters"
                                                    onClick={() => makeChapter(n)}
                                                >
                                                    make chapter
                                                </button>
                                            )}
                                            {n.kind === "scene" && (
                                                <button
                                                    title="Chapters slot into the spine after this scene"
                                                    onClick={() => addArm(n.id, "chapter")}
                                                >
                                                    + chapter after
                                                </button>
                                            )}
                                            <button
                                                className="danger"
                                                title="Move file to Trash"
                                                onClick={() => trashFile(n.kind as DocKind, n.file)}
                                            >
                                                delete
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                            {n.arms.length > 0 && (
                                <div className="outline-arms">
                                    {n.arms.map((arm) =>
                                        docState(arm.kind, arm.file) === "trashed" ? (
                                            <div className="arm-chip" key={arm.id}>
                                                <span className="arm-connector">
                                                    <span className="line" />
                                                    <span className="arrow">▶</span>
                                                </span>
                                                <span className="arm-open trashed-doc">
                                                    {arm.kind === "scene" ? "◇" : "§"}{" "}
                                                    {findTrash(arm.kind, arm.file)?.title ?? arm.file}
                                                    <span className="deleted-label"> deleted</span>
                                                </span>
                                                <button
                                                    className="arm-restore"
                                                    title="Restore from Trash"
                                                    onClick={() =>
                                                        restoreArm(n.id, arm.id, arm.kind, arm.file)
                                                    }
                                                >
                                                    restore
                                                </button>
                                                <button
                                                    className="arm-remove"
                                                    title="Remove from outline (file stays in Trash)"
                                                    onClick={() => removeArm(n.id, arm.id)}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ) : (
                                            <div
                                                className="arm-chip"
                                                key={arm.id}
                                                draggable
                                                onDragStart={(e) => {
                                                    e.stopPropagation();
                                                    setDragGhost(e, e.currentTarget as HTMLElement);
                                                    dragData.current = {
                                                        type: "arm",
                                                        nodeId: n.id,
                                                        armId: arm.id,
                                                    };
                                                }}
                                                onDragEnd={endDrag}
                                            >
                                                <span className="arm-connector">
                                                    <span className="line" />
                                                    <span className="arrow">▶</span>
                                                </span>
                                                <button
                                                    className="arm-open"
                                                    onClick={() => setEditing({ kind: arm.kind, file: arm.file })}
                                                >
                                                    {arm.kind === "scene" ? "◇" : "§"}{" "}
                                                    {docInfo(arm)?.title ?? arm.file}
                                                </button>
                                                <button
                                                    className="arm-remove"
                                                    title="Move to Trash"
                                                    onClick={() => trashFile(arm.kind, arm.file)}
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        )
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                ))}
                {/* Drop zone after the last card */}
                {nodes.length > 0 && (
                    <div
                        className={`outline-drop-end ${dragOverKey === "end" ? "drag-over" : ""}`}
                        onDragOver={(e) => {
                            e.preventDefault();
                            setDragOverKey("end");
                        }}
                        onDragLeave={() => setDragOverKey(null)}
                        onDrop={() => dropInsert(nodes.length)}
                    />
                )}
              </div>
            </div>
            <div className="outline-toolbar">
                <button onClick={addPoint}>+ Story Point</button>
                <button onClick={() => addDocNode("scene")}>+ Scene</button>
                <button onClick={() => addDocNode("chapter")}>+ Chapter</button>
                <span className={`save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${error}`}
                </span>
            </div>
        </div>
    );
}
