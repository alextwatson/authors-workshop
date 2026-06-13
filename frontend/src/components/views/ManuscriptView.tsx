import { useEffect, useRef, useState } from "react";
import {
    DeleteChapter,
    DeleteScene,
    ListChapters,
    ListScenes,
    PromoteSceneToChapter,
    ReadChapter,
    ReadScene,
    SetManuscriptOrder,
    WriteChapter,
    WriteScene,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import DocEditor from "../DocEditor";
import { nextNumberedFilename } from "../../docnames";

interface Props {
    project: main.Project;
}

type DocRef = { kind: "chapter" | "scene"; filename: string };

export default function ManuscriptView({ project }: Props) {
    const [chapters, setChapters] = useState<main.ChapterInfo[]>([]);
    const [scenes, setScenes] = useState<main.ChapterInfo[]>([]);
    const [active, setActive] = useState<DocRef | null>(null);
    const [error, setError] = useState("");
    const [dragOverKey, setDragOverKey] = useState<string | null>(null);
    const dragRef = useRef<{ kind: DocRef["kind"]; index: number } | null>(null);

    useEffect(() => {
        Promise.all([ListChapters(project.path), ListScenes(project.path)])
            .then(([chapterList, sceneList]) => {
                setChapters(chapterList);
                setScenes(sceneList);
                if (chapterList.length > 0) {
                    setActive({ kind: "chapter", filename: chapterList[0].filename });
                }
            })
            .catch((err) => setError(String(err)));
    }, [project.path]);

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
            <div className="chapter-list">
                <div className="list-heading">Chapters</div>
                {chapters.map(docButton("chapter"))}
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
            <div className="editor-pane">
                {active ? (
                    <DocEditor
                        key={`${active.kind}:${active.filename}`}
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
