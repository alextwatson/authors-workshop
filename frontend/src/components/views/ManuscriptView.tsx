import { Fragment, useEffect, useRef, useState } from "react";
import {
    DeleteChapter,
    DeleteScene,
    ListChapters,
    ListParts,
    ListScenes,
    PromoteSceneToChapter,
    ReadChapter,
    ReadScene,
    SetManuscriptOrder,
    SetParts,
    WriteChapter,
    WriteScene,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import DocEditor from "../DocEditor";
import { newId, nextNumberedFilename } from "../../docnames";
import { blurOnEnter } from "../../ui";

interface Props {
    project: main.Project;
    // The chapter list is nested inside the sidebar menu: its reopen button
    // only shows once the menu itself is open.
    chromeVisible: boolean;
    // Focus mode hides the chapter list and dims everything but the sentence
    // being written. Owned by App so it can also hide the app sidebar.
    focusMode: boolean;
    focus: main.FocusSettings;
    onToggleFocus: () => void;
}

type DocRef = { kind: "chapter" | "scene"; filename: string };

export default function ManuscriptView({
    project,
    chromeVisible,
    focusMode,
    focus,
    onToggleFocus,
}: Props) {
    const [chapters, setChapters] = useState<main.ChapterInfo[]>([]);
    const [scenes, setScenes] = useState<main.ChapterInfo[]>([]);
    const [parts, setParts] = useState<main.ManuscriptPart[]>([]);
    const [active, setActive] = useState<DocRef | null>(null);
    const [listOpen, setListOpen] = useState(true);
    const [error, setError] = useState("");
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const dragRef = useRef<{ kind: DocRef["kind"]; index: number } | null>(null);

    useEffect(() => {
        Promise.all([ListChapters(project.path), ListScenes(project.path), ListParts(project.path)])
            .then(([chapterList, sceneList, partList]) => {
                setChapters(chapterList);
                setScenes(sceneList);
                // Drop dividers whose anchor chapter is gone, so they never orphan.
                const names = new Set(chapterList.map((c) => c.filename));
                const live = partList.filter((p) => names.has(p.before));
                setParts(live);
                if (live.length !== partList.length) {
                    SetParts(project.path, live).catch(() => {});
                }
                if (chapterList.length > 0) {
                    setActive({ kind: "chapter", filename: chapterList[0].filename });
                }
            })
            .catch((err) => setError(String(err)));
    }, [project.path]);

    function persistParts(next: main.ManuscriptPart[]) {
        setParts(next);
        SetParts(project.path, next).catch((err) => setError(String(err)));
    }

    function addPartBefore(filename: string) {
        if (parts.some((p) => p.before === filename)) return;
        persistParts([
            ...parts,
            main.ManuscriptPart.createFrom({ id: newId(), label: "New Part", before: filename }),
        ]);
    }

    function renamePart(id: string, label: string) {
        setParts((ps) => ps.map((p) => (p.id === id ? main.ManuscriptPart.createFrom({ ...p, label }) : p)));
    }

    function commitParts() {
        SetParts(project.path, parts).catch((err) => setError(String(err)));
    }

    function deletePart(id: string) {
        persistParts(parts.filter((p) => p.id !== id));
    }

    function updateListEntry(ref: DocRef, info: { title: string; wordCount: number }) {
        const apply = (list: main.ChapterInfo[]) =>
            list.map((c) =>
                c.filename === ref.filename
                    ? main.ChapterInfo.createFrom({ filename: ref.filename, ...info })
                    : c
            );
        if (ref.kind === "chapter") setChapters(apply);
        else setScenes(apply);
    }

    async function newChapter() {
        const { filename, number } = nextNumberedFilename(chapters, "chapter");
        try {
            await WriteChapter(project.path, filename, `# Chapter ${number}\n\n`);
            setChapters(await ListChapters(project.path));
            setActive({ kind: "chapter", filename });
        } catch (err) {
            setError(String(err));
        }
    }

    async function trashDoc(ref: DocRef) {
        setError("");
        try {
            if (ref.kind === "chapter") await DeleteChapter(project.path, ref.filename);
            else await DeleteScene(project.path, ref.filename);
            const [chapterList, sceneList] = await Promise.all([
                ListChapters(project.path),
                ListScenes(project.path),
            ]);
            setChapters(chapterList);
            setScenes(sceneList);
            if (active?.kind === ref.kind && active.filename === ref.filename) {
                setActive(
                    chapterList.length > 0
                        ? { kind: "chapter", filename: chapterList[0].filename }
                        : null
                );
            }
        } catch (err) {
            setError(String(err));
        }
    }

    async function makeChapter(filename: string) {
        setError("");
        try {
            const newName = await PromoteSceneToChapter(project.path, filename);
            const [chapterList, sceneList] = await Promise.all([
                ListChapters(project.path),
                ListScenes(project.path),
            ]);
            setChapters(chapterList);
            setScenes(sceneList);
            if (active?.kind === "scene" && active.filename === filename) {
                setActive({ kind: "chapter", filename: newName });
            }
        } catch (err) {
            setError(String(err));
        }
    }

    // Drop before `index`; index === list.length appends to the end.
    function reorder(kind: DocRef["kind"], index: number) {
        const d = dragRef.current;
        dragRef.current = null;
        setDragOverKey(null);
        if (!d || d.kind !== kind) return;
        if (d.index === index || d.index + 1 === index) return;
        const list = kind === "chapter" ? chapters : scenes;
        const next = [...list];
        const [moved] = next.splice(d.index, 1);
        next.splice(d.index < index ? index - 1 : index, 0, moved);
        if (kind === "chapter") setChapters(next);
        else setScenes(next);
        SetManuscriptOrder(project.path, kind, next.map((c) => c.filename)).catch((err) =>
            setError(String(err))
        );
    }

    const docButton = (kind: DocRef["kind"]) => (c: main.ChapterInfo, index: number) => (
        <div
            className={`doc-row ${dragOverKey === `${kind}-${index}` ? "drag-over" : ""}`}
            key={c.filename}
            draggable
            onDragStart={() => (dragRef.current = { kind, index })}
            onDragEnd={() => {
                dragRef.current = null;
                setDragOverKey(null);
            }}
            onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(`${kind}-${index}`);
            }}
            onDragLeave={() => setDragOverKey(null)}
            onDrop={() => reorder(kind, index)}
        >
            <button
                className={`doc-select ${
                    active?.kind === kind && active.filename === c.filename ? "active" : ""
                }`}
                onClick={() => setActive({ kind, filename: c.filename })}
            >
                <span className="chapter-title">{c.title}</span>
                <span className="chapter-words">{c.wordCount.toLocaleString()}</span>
            </button>
            {kind === "chapter" && (
                <button
                    className="doc-trash"
                    title="Add a Part break above"
                    onClick={() => addPartBefore(c.filename)}
                >
                    ¶
                </button>
            )}
            {kind === "scene" && (
                <button
                    className="doc-trash"
                    title="Make chapter"
                    onClick={() => makeChapter(c.filename)}
                >
                    §
                </button>
            )}
            <button
                className="doc-trash"
                title="Move to Trash"
                onClick={() => trashDoc({ kind, filename: c.filename })}
            >
                ✕
            </button>
        </div>
    );

    const partRows = (filename: string) =>
        parts
            .filter((p) => p.before === filename)
            .map((p) => (
                <div className="part-row" key={p.id}>
                    <input
                        className="part-label"
                        value={p.label}
                        placeholder="Part title"
                        onChange={(e) => renamePart(p.id, e.target.value)}
                        onKeyDown={blurOnEnter}
                        onBlur={commitParts}
                    />
                    <button
                        className="part-delete"
                        title="Remove Part break"
                        onClick={() => deletePart(p.id)}
                    >
                        ✕
                    </button>
                </div>
            ));

    const listDropEnd = (kind: DocRef["kind"], length: number) => (
        <div
            className={`list-drop-end ${dragOverKey === `${kind}-end` ? "drag-over" : ""}`}
            onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(`${kind}-end`);
            }}
            onDragLeave={() => setDragOverKey(null)}
            onDrop={() => reorder(kind, length)}
        />
    );

    return (
        <div className="manuscript">
            {listOpen && !focusMode && (
                <div className="chapter-list">
                    <div className="list-top">
                        <span className="list-heading">Chapters</span>
                        <button
                            className="collapse-btn"
                            title="Hide chapters"
                            onClick={() => setListOpen(false)}
                        >
                            «
                        </button>
                    </div>
                    {chapters.map((c, index) => (
                        <Fragment key={c.filename}>
                            {partRows(c.filename)}
                            {docButton("chapter")(c, index)}
                        </Fragment>
                    ))}
                    {listDropEnd("chapter", chapters.length)}
                    <button className="new-chapter" onClick={newChapter}>
                        + New Chapter
                    </button>
                    {scenes.length > 0 && (
                        <>
                            <div className="list-heading">Scenes</div>
                            <div className="list-hint">From the outline · manuscript/scenes/</div>
                            {scenes.map(docButton("scene"))}
                            {listDropEnd("scene", scenes.length)}
                        </>
                    )}
                </div>
            )}
            <div className="editor-pane">
                {!listOpen && chromeVisible && !focusMode && (
                    <button
                        className="list-reopen"
                        title="Show chapters"
                        onClick={() => setListOpen(true)}
                    >
                        ☰
                    </button>
                )}
                {active && (
                    <button
                        className={`focus-toggle ${focusMode ? "on" : ""}`}
                        title={focusMode ? "Exit focus mode (Esc)" : "Focus mode"}
                        onClick={onToggleFocus}
                    >
                        <span className="focus-toggle-icon">◐</span>
                        Focus mode
                    </button>
                )}
                {active ? (
                    <DocEditor
                        key={`${active.kind}:${active.filename}`}
                        focusMode={focusMode}
                        focus={focus}
                        read={() =>
                            active.kind === "chapter"
                                ? ReadChapter(project.path, active.filename)
                                : ReadScene(project.path, active.filename)
                        }
                        write={(content) =>
                            active.kind === "chapter"
                                ? WriteChapter(project.path, active.filename, content)
                                : WriteScene(project.path, active.filename, content)
                        }
                        onSaved={(info) => updateListEntry(active, info)}
                        fallbackTitle={active.filename.replace(/\.md$/, "")}
                    />
                ) : (
                    <div className="view">
                        <h2>Manuscript</h2>
                        <p className="subtitle">
                            {error || "No chapters yet — create one to start writing."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
