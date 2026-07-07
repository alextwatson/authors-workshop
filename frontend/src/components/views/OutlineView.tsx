import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
import DocEditor, { serializeDoc } from "../DocEditor";
import { newId, nextNumberedFilename } from "../../docnames";
import { blurOnEnter } from "../../ui";
import {
    DocKind,
    Outline,
    OutlineGroup,
    OutlineNode,
    TagColor,
    parseOutlines,
    serializeOutlines,
} from "../../outline";

interface Props {
    project: main.Project;
    // When navigated from a character's emotional arc, the outline-object id to
    // scroll to and briefly highlight.
    focusId?: string | null;
}

type DocRef = { kind: DocKind; file: string };
type SaveState = "idle" | "unsaved" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;
const SWATCHES: TagColor[] = ["dark", "green", "orange"];

// Stable fallbacks for the pre-load render: effects depend on `nodes`/`groups`
// identity, so a fresh [] each render would loop them forever.
const NO_NODES: OutlineNode[] = [];
const NO_GROUPS: OutlineGroup[] = [];

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

export default function OutlineView({ project, focusId }: Props) {
    const [outlines, setOutlines] = useState<Outline[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [listOpen, setListOpen] = useState(true);
    const [scenes, setScenes] = useState<main.ChapterInfo[]>([]);
    const [chapters, setChapters] = useState<main.ChapterInfo[]>([]);
    const [trashItems, setTrashItems] = useState<main.TrashItem[]>([]);
    const [editing, setEditing] = useState<DocRef | null>(null);
    const [loaded, setLoaded] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");
    const [assigningId, setAssigningId] = useState<string | null>(null);
    const [highlightId, setHighlightId] = useState<string | null>(null);
    const [renamingId, setRenamingId] = useState<string | null>(null);

    const outlinesRef = useRef<Outline[]>([]);
    const activeIdRef = useRef<string | null>(null);
    const assignSnapshot = useRef<OutlineGroup[] | null>(null);
    const dirtyRef = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const dragData = useRef<
        { type: "node"; index: number } | { type: "arm"; nodeId: string; armId: string } | null
    >(null);
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);

    const format = project.meta.manuscriptFormat || "md";
    const ext = format === "txt" ? ".txt" : ".md";

    // The outline currently on the board; falls back to the first, and
    // parseOutlines guarantees at least one, so `active` is only null pre-load.
    const active: Outline | null =
        outlines.find((o) => o.id === activeId) ?? outlines[0] ?? null;
    const nodes = active?.nodes ?? NO_NODES;
    const groups = active?.groups ?? NO_GROUPS;

    function currentActive(): Outline | null {
        const os = outlinesRef.current;
        return os.find((o) => o.id === activeIdRef.current) ?? os[0] ?? null;
    }

    function selectOutline(id: string) {
        activeIdRef.current = id;
        setActiveId(id);
        setAssigningId(null);
        assignSnapshot.current = null;
        setDragOverKey(null);
    }

    function applyOutlines(update: (os: Outline[]) => Outline[]) {
        const next = update(outlinesRef.current);
        outlinesRef.current = next;
        setOutlines(next);
        scheduleSave();
    }

    // Measured vertical spans for each group's curly brace, keyed by group id.
    const spineRef = useRef<HTMLDivElement>(null);
    const nodeEls = useRef<Map<string, HTMLDivElement>>(new Map());
    const [braces, setBraces] = useState<Record<string, { top: number; height: number }>>({});

    useEffect(() => {
        Promise.all([
            ReadOutline(project.path),
            ListScenes(project.path),
            ListChapters(project.path),
            ListTrash(),
        ])
            .then(([json, sceneList, chapterList, trashList]) => {
                const original = parseOutlines(json);
                const inList = (kind: DocKind, file: string) =>
                    (kind === "scene" ? sceneList : chapterList).some((d) => d.filename === file);
                // A doc converted from the Manuscript view keeps its filename
                // but switches folders — flip the outline ref's kind to match.
                const flipKind = (kind: DocKind, file: string): DocKind => {
                    const other: DocKind = kind === "scene" ? "chapter" : "scene";
                    return !inList(kind, file) && inList(other, file) ? other : kind;
                };
                // Files that are neither on disk nor in the trash are gone for
                // good (trash emptied or app restarted) — drop their outline
                // objects so the spine reconnects around them.
                const exists = (kind: DocKind, file: string) =>
                    inList(kind, file) ||
                    trashList.some(
                        (t) => t.kind === kind && t.filename === file && t.projectPath === project.path
                    );
                const cleaned = original.map((o) => {
                    let parsed = o.nodes.map((n) => ({
                        ...n,
                        kind: n.kind === "point" ? n.kind : flipKind(n.kind as DocKind, n.file),
                        arms: n.arms.map((a) => ({ ...a, kind: flipKind(a.kind, a.file) })),
                    }));
                    parsed = parsed
                        .filter((n) => n.kind === "point" || exists(n.kind as DocKind, n.file))
                        .map((n) => ({ ...n, arms: n.arms.filter((a) => exists(a.kind, a.file)) }));
                    parsed = normalizeNodes(parsed);
                    // Drop group members whose nodes are gone, then drop empty groups.
                    const liveIds = new Set(parsed.map((n) => n.id));
                    const liveGroups = o.groups
                        .map((g) => ({ ...g, members: g.members.filter((m) => liveIds.has(m)) }))
                        .filter((g) => g.members.length > 0);
                    return { ...o, nodes: parsed, groups: liveGroups };
                });
                const changed = serializeOutlines(cleaned) !== serializeOutlines(original);
                outlinesRef.current = cleaned;
                setOutlines(cleaned);
                if (!cleaned.some((o) => o.id === activeIdRef.current)) {
                    // Arriving from a character's emotional arc opens the
                    // outline holding that node; otherwise the first one.
                    const owner = focusId
                        ? cleaned.find((o) => o.nodes.some((n) => n.id === focusId))
                        : undefined;
                    const id = (owner ?? cleaned[0]).id;
                    activeIdRef.current = id;
                    setActiveId(id);
                }
                setScenes(sceneList);
                setChapters(chapterList);
                setTrashItems(trashList);
                setLoaded(true);
                if (changed) {
                    WriteOutline(project.path, serializeOutlines(cleaned)).catch(() => {});
                }
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                WriteOutline(project.path, serializeOutlines(outlinesRef.current)).catch(() => {});
            }
        };
    }, [project.path, format]);

    function scheduleSave() {
        dirtyRef.current = true;
        setSaveState("unsaved");
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(async () => {
            try {
                await WriteOutline(project.path, serializeOutlines(outlinesRef.current));
                dirtyRef.current = false;
                setSaveState("saved");
            } catch (err) {
                setSaveState("error");
                setError(String(err));
            }
        }, AUTOSAVE_DELAY_MS);
    }

    function mutate(update: (ns: OutlineNode[]) => OutlineNode[]) {
        const act = currentActive();
        if (!act) return;
        const next = normalizeNodes(update(act.nodes));
        // A removed node must also leave any group it belonged to.
        const liveIds = new Set(next.map((n) => n.id));
        const prunedGroups = act.groups
            .map((g) => ({ ...g, members: g.members.filter((m) => liveIds.has(m)) }))
            .filter((g) => g.members.length > 0);
        applyOutlines((os) =>
            os.map((o) => (o.id === act.id ? { ...o, nodes: next, groups: prunedGroups } : o))
        );
    }

    function mutateGroups(update: (gs: OutlineGroup[]) => OutlineGroup[]) {
        const act = currentActive();
        if (!act) return;
        const next = update(act.groups);
        applyOutlines((os) => os.map((o) => (o.id === act.id ? { ...o, groups: next } : o)));
    }

    function addGroup() {
        const id = newId();
        // Snapshot the pre-add state so Cancel removes the new arc entirely.
        assignSnapshot.current = currentActive()?.groups ?? [];
        mutateGroups((gs) => [...gs, { id, label: "Plot arc", note: "", color: "green", members: [] }]);
        setAssigningId(id);
    }

    function startRegroup(id: string) {
        assignSnapshot.current = currentActive()?.groups ?? [];
        setAssigningId(id);
    }

    function doneGrouping() {
        // An arc with no members has nothing to show — discard it.
        const g = currentActive()?.groups.find((x) => x.id === assigningId);
        if (g && g.members.length === 0) {
            mutateGroups((gs) => gs.filter((x) => x.id !== assigningId));
        }
        assignSnapshot.current = null;
        setAssigningId(null);
    }

    function cancelGrouping() {
        if (assignSnapshot.current) {
            const snap = assignSnapshot.current;
            mutateGroups(() => snap);
        }
        assignSnapshot.current = null;
        setAssigningId(null);
    }

    function toggleMember(groupId: string, nodeId: string) {
        mutateGroups((gs) =>
            gs.map((g) =>
                g.id === groupId
                    ? {
                          ...g,
                          members: g.members.includes(nodeId)
                              ? g.members.filter((m) => m !== nodeId)
                              : [...g.members, nodeId],
                      }
                    : g
            )
        );
    }

    function deleteGroup(id: string) {
        if (assigningId === id) setAssigningId(null);
        mutateGroups((gs) => gs.filter((g) => g.id !== id));
    }

    // --- outlines (parallel plots) ---

    function addOutline() {
        const count = outlinesRef.current.length;
        const id = newId();
        applyOutlines((os) => [
            ...os,
            { id, name: `Outline ${count + 1}`, nodes: [], groups: [] },
        ]);
        selectOutline(id);
    }

    // Removes the outline's story points and references; manuscript files
    // are untouched (same semantics as deleting a node from the spine).
    function deleteOutline(id: string) {
        if (outlinesRef.current.length <= 1) return;
        applyOutlines((os) => os.filter((o) => o.id !== id));
        if (activeIdRef.current === id || active?.id === id) {
            selectOutline(outlinesRef.current[0].id);
        }
    }

    function renameOutline(id: string, name: string) {
        applyOutlines((os) => os.map((o) => (o.id === id ? { ...o, name } : o)));
    }

    // Measure each group's vertical span from its members' card positions.
    // Recomputes when nodes/groups change and whenever a card resizes (e.g.
    // a note auto-grows), so braces stay aligned.
    useLayoutEffect(() => {
        function measure() {
            const spine = spineRef.current;
            if (!spine) return;
            const base = spine.getBoundingClientRect().top;
            const next: Record<string, { top: number; height: number }> = {};
            for (const g of groups) {
                let top = Infinity;
                let bottom = -Infinity;
                for (const id of g.members) {
                    const el = nodeEls.current.get(id);
                    if (!el) continue;
                    const r = el.getBoundingClientRect();
                    top = Math.min(top, r.top - base);
                    bottom = Math.max(bottom, r.bottom - base);
                }
                if (top !== Infinity) next[g.id] = { top, height: bottom - top };
            }
            setBraces(next);
        }
        measure();
        const ro = new ResizeObserver(measure);
        if (spineRef.current) ro.observe(spineRef.current);
        for (const el of nodeEls.current.values()) ro.observe(el);
        return () => ro.disconnect();
    }, [nodes, groups, editing]);

    // Arriving from a character's emotional arc: switch to the outline holding
    // the linked card, then scroll it into view and flash it. Runs once the
    // board has rendered so the element exists.
    useEffect(() => {
        if (!loaded || !focusId) return;
        const owner = outlinesRef.current.find((o) => o.nodes.some((n) => n.id === focusId));
        if (owner && owner.id !== active?.id) {
            selectOutline(owner.id);
            return; // re-runs once the right board has rendered
        }
        const el = nodeEls.current.get(focusId);
        if (!el) return;
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setHighlightId(focusId);
        const t = window.setTimeout(() => setHighlightId(null), 2000);
        return () => window.clearTimeout(t);
    }, [loaded, focusId, activeId]);

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
            const { filename, number } = nextNumberedFilename(scenes, "scene", ext);
            await WriteScene(project.path, filename, serializeDoc(title || `Scene ${number}`, body, format));
            setScenes(await ListScenes(project.path));
            return filename;
        }
        const { filename, number } = nextNumberedFilename(chapters, "chapter", ext);
        await WriteChapter(project.path, filename, serializeDoc(title || `Chapter ${number}`, body, format));
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
        const source = currentActive()?.nodes.find((n) => n.id === d.nodeId);
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
        const boardNodes = currentActive()?.nodes ?? [];
        const target = boardNodes[index];
        if (!d || !target) {
            endDrag();
            return;
        }
        if (d.type === "node") {
            const src = boardNodes[d.index];
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
        const source = boardNodes.find((n) => n.id === d.nodeId);
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
                </div>
                <div className="editor-pane">
                    <DocEditor
                        key={`${editing.kind}:${editing.file}`}
                        format={format}
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
                        fallbackTitle={editing.file.replace(/\.(md|txt)$/, "")}
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
                        onKeyDown={blurOnEnter}
                    />
                )}
            </div>
        );
    }

    const multipleOutlines = outlines.length > 1;

    return (
        <div className="outline-wrap">
            {multipleOutlines && listOpen && (
                <div className="chapter-list">
                    <div className="list-top">
                        <span className="list-heading">Outlines</span>
                        <button
                            className="collapse-btn"
                            title="Hide outlines"
                            onClick={() => setListOpen(false)}
                        >
                            «
                        </button>
                    </div>
                    {outlines.map((o) => (
                        <div className="doc-row" key={o.id}>
                            {renamingId === o.id ? (
                                <input
                                    className="outline-rename field-input"
                                    autoFocus
                                    value={o.name}
                                    placeholder="Outline name"
                                    onFocus={(e) => e.target.select()}
                                    onChange={(e) => renameOutline(o.id, e.target.value)}
                                    onBlur={() => setRenamingId(null)}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" || e.key === "Escape") {
                                            setRenamingId(null);
                                        }
                                    }}
                                />
                            ) : (
                                <button
                                    className={`doc-select ${active?.id === o.id ? "active" : ""}`}
                                    title="Double-click to rename"
                                    onClick={() => selectOutline(o.id)}
                                    onDoubleClick={() => setRenamingId(o.id)}
                                    onContextMenu={(e) => {
                                        e.preventDefault();
                                        setRenamingId(o.id);
                                    }}
                                >
                                    <span className="chapter-title">
                                        {o.name.trim() || "Untitled outline"}
                                    </span>
                                </button>
                            )}
                            <button
                                className="doc-trash"
                                title="Delete outline (manuscript files are kept)"
                                onClick={() => deleteOutline(o.id)}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    <button className="new-chapter" onClick={addOutline}>
                        + New Outline
                    </button>
                </div>
            )}
            <div className="outline">
            <div className="outline-board" onDragOver={(e) => e.preventDefault()}>
              <div className="outline-spine" ref={spineRef}>
                {groups.map((g) => {
                    const pos = braces[g.id];
                    if (!pos) return null;
                    return (
                        <div
                            key={g.id}
                            className={`plot-arc ${assigningId === g.id ? "assigning" : ""}`}
                            style={{ top: pos.top, height: pos.height }}
                        >
                            <div className={`arc-side ${assigningId === g.id ? "active" : ""}`}>
                                <input
                                    className={`arc-title ${g.color}`}
                                    value={g.label}
                                    placeholder="Plot arc"
                                    onChange={(e) =>
                                        mutateGroups((gs) =>
                                            gs.map((x) =>
                                                x.id === g.id ? { ...x, label: e.target.value } : x
                                            )
                                        )
                                    }
                                    onKeyDown={blurOnEnter}
                                />
                                <textarea
                                    ref={autoGrow}
                                    className="arc-note"
                                    value={g.note}
                                    placeholder="Description…"
                                    rows={1}
                                    onChange={(e) => {
                                        mutateGroups((gs) =>
                                            gs.map((x) =>
                                                x.id === g.id ? { ...x, note: e.target.value } : x
                                            )
                                        );
                                        autoGrow(e.target);
                                    }}
                                />
                                {!assigningId && (
                                    <div className="arc-actions">
                                        {SWATCHES.map((c) => (
                                            <button
                                                key={c}
                                                className={`swatch ${c} ${g.color === c ? "on" : ""}`}
                                                title="Color"
                                                onClick={() =>
                                                    mutateGroups((gs) =>
                                                        gs.map((x) =>
                                                            x.id === g.id ? { ...x, color: c } : x
                                                        )
                                                    )
                                                }
                                            />
                                        ))}
                                        <button className="arc-edit" onClick={() => startRegroup(g.id)}>
                                            regroup
                                        </button>
                                        <button
                                            className="arc-edit danger"
                                            onClick={() => deleteGroup(g.id)}
                                        >
                                            delete
                                        </button>
                                    </div>
                                )}
                            </div>
                            <span className={`arc-brace ${g.color}`} />
                        </div>
                    );
                })}
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
                            className={`outline-node-wrap ${
                                highlightId === n.id ? "highlight" : ""
                            }`}
                            ref={(el) => {
                                if (el) nodeEls.current.set(n.id, el);
                                else nodeEls.current.delete(n.id);
                            }}
                            onDragOver={(e) => {
                                e.preventDefault();
                                setDragOverKey(`card-${n.id}`);
                            }}
                            onDragLeave={() => setDragOverKey(null)}
                            onDrop={() => dropOnCard(i)}
                        >
                            {assigningId && (
                                <button
                                    className={`assign-overlay ${
                                        groups.find((g) => g.id === assigningId)?.members.includes(n.id)
                                            ? "member"
                                            : ""
                                    }`}
                                    onClick={() => toggleMember(assigningId, n.id)}
                                >
                                    <span className="assign-check">
                                        {groups
                                            .find((g) => g.id === assigningId)
                                            ?.members.includes(n.id)
                                            ? "✓ in arc"
                                            : "+ add to arc"}
                                    </span>
                                </button>
                            )}
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
                                            onKeyDown={blurOnEnter}
                                        />
                                        <textarea
                                            ref={autoGrow}
                                            className="op-note"
                                            value={n.note}
                                            placeholder="Notes…"
                                            rows={1}
                                            onChange={(e) => {
                                                patchNode(n.id, { note: e.target.value });
                                                autoGrow(e.target);
                                            }}
                                        />
                                        {tagRow(n)}
                                        <div className="card-actions">
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
                {assigningId ? (
                    <>
                        <span className="grouping-hint">
                            Click cards to add or remove them from this arc
                        </span>
                        <button className="primary" onClick={doneGrouping}>
                            Done grouping
                        </button>
                        <button onClick={cancelGrouping}>Cancel</button>
                    </>
                ) : (
                    <>
                        {multipleOutlines && !listOpen && (
                            <button title="Show outlines" onClick={() => setListOpen(true)}>
                                ☰
                            </button>
                        )}
                        <button onClick={addPoint}>+ Story Point</button>
                        <button onClick={() => addDocNode("scene")}>+ Scene</button>
                        <button onClick={() => addDocNode("chapter")}>+ Chapter</button>
                        <button onClick={addGroup}>+ Plot Arc</button>
                        {!multipleOutlines && (
                            <button title="Add a parallel outline" onClick={addOutline}>
                                + Outline
                            </button>
                        )}
                    </>
                )}
                <span className={`save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${error}`}
                </span>
            </div>
            </div>
        </div>
    );
}
