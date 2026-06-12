import { useEffect, useRef, useState } from "react";
import { ListChapters, ReadChapter, WriteChapter } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

interface Props {
    project: main.Project;
}

type SaveState = "idle" | "unsaved" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

function countWords(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Mirrors splitChapter in project.go: the first # heading is the title,
// everything after it is the body.
function parseChapter(content: string): { title: string; body: string } {
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        if (!trimmed) continue;
        if (trimmed.startsWith("#")) {
            return {
                title: trimmed.replace(/^#+\s*/, ""),
                body: lines.slice(i + 1).join("\n").replace(/^\n+/, ""),
            };
        }
        break;
    }
    return { title: "", body: content };
}

function serializeChapter(title: string, body: string): string {
    const t = title.trim();
    return t ? `# ${t}\n\n${body}` : body;
}

function nextChapterFilename(chapters: main.ChapterInfo[]): { filename: string; number: number } {
    let max = 0;
    for (const c of chapters) {
        const m = c.filename.match(/^chapter-(\d+)\.md$/);
        if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    const number = max + 1 || chapters.length + 1;
    return { filename: `chapter-${String(number).padStart(2, "0")}.md`, number };
}

export default function ManuscriptView({ project }: Props) {
    const [chapters, setChapters] = useState<main.ChapterInfo[]>([]);
    const [active, setActive] = useState<string | null>(null);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const saveTimer = useRef<number | undefined>(undefined);
    const titleRef = useRef("");
    const bodyRef = useRef("");
    const activeRef = useRef<string | null>(null);
    const dirtyRef = useRef(false);

    titleRef.current = title;
    bodyRef.current = body;
    activeRef.current = active;

    useEffect(() => {
        ListChapters(project.path)
            .then((list) => {
                setChapters(list);
                if (list.length > 0) openChapter(list[0].filename);
            })
            .catch((err) => setError(String(err)));
        // Flush any unsaved work when the view unmounts (e.g. switching sections).
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current && activeRef.current) {
                WriteChapter(
                    project.path,
                    activeRef.current,
                    serializeChapter(titleRef.current, bodyRef.current)
                ).catch(() => {});
            }
        };
    }, [project.path]);

    async function saveNow(filename: string) {
        window.clearTimeout(saveTimer.current);
        const chapterTitle = titleRef.current;
        const chapterBody = bodyRef.current;
        try {
            await WriteChapter(project.path, filename, serializeChapter(chapterTitle, chapterBody));
            dirtyRef.current = false;
            setSaveState("saved");
            setChapters((cs) =>
                cs.map((c) =>
                    c.filename === filename
                        ? main.ChapterInfo.createFrom({
                              filename,
                              title: chapterTitle.trim() || filename.replace(/\.md$/, ""),
                              wordCount: countWords(chapterBody),
                          })
                        : c
                )
            );
        } catch (err) {
            setSaveState("error");
            setError(String(err));
        }
    }

    function scheduleSave() {
        if (!activeRef.current) return;
        dirtyRef.current = true;
        setSaveState("unsaved");
        window.clearTimeout(saveTimer.current);
        const filename = activeRef.current;
        saveTimer.current = window.setTimeout(() => saveNow(filename), AUTOSAVE_DELAY_MS);
    }

    function handleTitleChange(value: string) {
        setTitle(value);
        titleRef.current = value;
        scheduleSave();
    }

    function handleBodyChange(value: string) {
        setBody(value);
        bodyRef.current = value;
        scheduleSave();
    }

    async function openChapter(filename: string) {
        if (dirtyRef.current && activeRef.current) {
            await saveNow(activeRef.current);
        }
        setError("");
        try {
            const content = await ReadChapter(project.path, filename);
            const parsed = parseChapter(content);
            setActive(filename);
            setTitle(parsed.title);
            setBody(parsed.body);
            setSaveState("idle");
        } catch (err) {
            setError(String(err));
        }
    }

    async function newChapter() {
        const { filename, number } = nextChapterFilename(chapters);
        try {
            await WriteChapter(project.path, filename, `# Chapter ${number}\n\n`);
            const list = await ListChapters(project.path);
            setChapters(list);
            await openChapter(filename);
        } catch (err) {
            setError(String(err));
        }
    }

    const words = countWords(body);

    return (
        <div className="manuscript">
            <div className="chapter-list">
                {chapters.map((c) => (
                    <button
                        key={c.filename}
                        className={active === c.filename ? "active" : ""}
                        onClick={() => openChapter(c.filename)}
                    >
                        <span className="chapter-title">{c.title}</span>
                        <span className="chapter-words">{c.wordCount.toLocaleString()}</span>
                    </button>
                ))}
                <button className="new-chapter" onClick={newChapter}>
                    + New Chapter
                </button>
            </div>
            <div className="editor-pane">
                {active ? (
                    <>
                        <input
                            className="editor-title"
                            value={title}
                            onChange={(e) => handleTitleChange(e.target.value)}
                            placeholder="Chapter title"
                            spellCheck
                        />
                        <textarea
                            className="editor"
                            value={body}
                            onChange={(e) => handleBodyChange(e.target.value)}
                            spellCheck
                            placeholder="Start writing…"
                        />
                        <div className="editor-status">
                            <span>{words.toLocaleString()} words</span>
                            <span className={`save-status ${saveState}`}>
                                {saveState === "unsaved" && "Saving…"}
                                {saveState === "saved" && "Saved"}
                                {saveState === "error" && `Could not save: ${error}`}
                            </span>
                        </div>
                    </>
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
