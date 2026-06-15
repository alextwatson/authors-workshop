import { useEffect, useRef, useState } from "react";
import { blurOnEnter } from "../ui";

interface Props {
    read: () => Promise<string>;
    write: (content: string) => Promise<void>;
    onSaved?: (info: { title: string; wordCount: number }) => void;
    fallbackTitle: string;
}

type SaveState = "idle" | "unsaved" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

export function countWords(text: string): number {
    const trimmed = text.trim();
    return trimmed ? trimmed.split(/\s+/).length : 0;
}

// Mirrors splitChapter in project.go: the first # heading is the title,
// everything after it is the body.
export function parseDoc(content: string): { title: string; body: string } {
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

export function serializeDoc(title: string, body: string): string {
    const t = title.trim();
    return t ? `# ${t}\n\n${body}` : body;
}

// A markdown document editor with a separate title field and debounced,
// flush-on-unmount auto-save. Remount (via key) to switch documents.
export default function DocEditor({ read, write, onSaved, fallbackTitle }: Props) {
    const [loaded, setLoaded] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const saveTimer = useRef<number | undefined>(undefined);
    const titleRef = useRef("");
    const bodyRef = useRef("");
    const dirtyRef = useRef(false);

    useEffect(() => {
        read()
            .then((content) => {
                const parsed = parseDoc(content);
                titleRef.current = parsed.title;
                bodyRef.current = parsed.body;
                setTitle(parsed.title);
                setBody(parsed.body);
                setLoaded(true);
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                write(serializeDoc(titleRef.current, bodyRef.current)).catch(() => {});
            }
        };
    }, []);

    async function saveNow() {
        window.clearTimeout(saveTimer.current);
        const t = titleRef.current;
        const b = bodyRef.current;
        try {
            await write(serializeDoc(t, b));
            dirtyRef.current = false;
            setSaveState("saved");
            onSaved?.({ title: t.trim() || fallbackTitle, wordCount: countWords(b) });
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

    if (error && !loaded) {
        return (
            <div className="view">
                <p className="subtitle">{error}</p>
            </div>
        );
    }
    if (!loaded) return <div className="editor-pane" />;

    return (
        <>
            <input
                className="editor-title"
                value={title}
                onChange={(e) => {
                    setTitle(e.target.value);
                    titleRef.current = e.target.value;
                    scheduleSave();
                }}
                onKeyDown={blurOnEnter}
                placeholder="Title"
                spellCheck
            />
            <textarea
                className="editor"
                value={body}
                onChange={(e) => {
                    setBody(e.target.value);
                    bodyRef.current = e.target.value;
                    scheduleSave();
                }}
                spellCheck
                placeholder="Start writing…"
            />
            <div className="editor-status">
                <span>{countWords(body).toLocaleString()} words</span>
                <span className={`save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${error}`}
                </span>
            </div>
        </>
    );
}
