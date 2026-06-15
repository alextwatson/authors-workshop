import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { main } from "../../wailsjs/go/models";
import { effectiveFocus, resolveFocusSettings } from "../focus";
import { blurOnEnter } from "../ui";

interface Props {
    read: () => Promise<string>;
    write: (content: string) => Promise<void>;
    onSaved?: (info: { title: string; wordCount: number }) => void;
    fallbackTitle: string;
    // When on, every sentence but the one under the caret is dimmed and the
    // current line is kept vertically centered (typewriter scrolling).
    focusMode?: boolean;
    // The user's focus-mode preferences (dim amount, typewriter, etc.). Omitted
    // outside the manuscript (e.g. the outline editor), where focus mode is off.
    focus?: main.FocusSettings;
}

type Segment = { start: number; end: number };

// Split text into sentence-ish spans whose ranges tile the whole string with no
// gaps, so joining the slices reproduces the original exactly. A span ends after
// terminal punctuation (with trailing quotes/brackets and whitespace) or at a
// line break, so each line and each sentence dims independently.
export function segmentSentences(text: string): Segment[] {
    const segs: Segment[] = [];
    let start = 0;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        const isTerminator = ch === "." || ch === "!" || ch === "?";
        if (!isTerminator && ch !== "\n") continue;
        let j = i + 1;
        if (isTerminator) {
            while (j < text.length && ".!?\"')]”’".includes(text[j])) j++;
        }
        while (j < text.length && /[^\S\n]/.test(text[j])) j++;
        if (isTerminator && text[j] === "\n") j++;
        segs.push({ start, end: j });
        start = j;
        i = j - 1;
    }
    if (start < text.length || segs.length === 0) segs.push({ start, end: text.length });
    return segs;
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
export default function DocEditor({ read, write, onSaved, fallbackTitle, focusMode, focus: focusProp }: Props) {
    const focus = resolveFocusSettings(focusProp);
    // Which effects are active right now, folding in the "always" overrides.
    const eff = effectiveFocus(focus, !!focusMode);
    const [loaded, setLoaded] = useState(false);
    const [title, setTitle] = useState("");
    const [body, setBody] = useState("");
    const [caret, setCaret] = useState(0);
    // Which field the caret is in, so the title can dim while editing the body.
    const [editingTitle, setEditingTitle] = useState(false);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const saveTimer = useRef<number | undefined>(undefined);
    const titleRef = useRef("");
    const bodyRef = useRef("");
    const dirtyRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const backdropRef = useRef<HTMLDivElement>(null);
    const markerRef = useRef<HTMLSpanElement>(null);

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

    // Drop the caret into the prose the moment focus mode opens.
    useEffect(() => {
        if (focusMode) textareaRef.current?.focus();
    }, [focusMode]);

    // Keep the dim overlay aligned with the textarea's own scroll position.
    function syncBackdropScroll() {
        const ta = textareaRef.current;
        const bd = backdropRef.current;
        if (ta && bd) {
            bd.scrollTop = ta.scrollTop;
            bd.scrollLeft = ta.scrollLeft;
        }
    }

    // Typewriter scrolling: keep the line under the caret near the vertical
    // centre. The hidden marker rendered inside the backdrop sits exactly at the
    // caret, so its offset gives us the target scroll position.
    useLayoutEffect(() => {
        if (!eff.typewriter) {
            syncBackdropScroll();
            return;
        }
        const ta = textareaRef.current;
        const mk = markerRef.current;
        if (!ta || !mk) return;
        const target = mk.offsetTop - ta.clientHeight / 2;
        const max = ta.scrollHeight - ta.clientHeight;
        ta.scrollTop = Math.max(0, Math.min(target, max));
        syncBackdropScroll();
    }, [caret, body, eff.typewriter, loaded]);

    if (error && !loaded) {
        return (
            <div className="view">
                <p className="subtitle">{error}</p>
            </div>
        );
    }
    if (!loaded) return <div className="editor-pane" />;

    // Dim the title while the writer is down in the body (and the setting is on).
    const titleDimmed = eff.dimTitle && !editingTitle;
    const showStatus = !eff.hideWordCount;

    return (
        <>
            <input
                className={`editor-title ${titleDimmed ? "dim" : ""}`}
                value={title}
                onChange={(e) => {
                    setTitle(e.target.value);
                    titleRef.current = e.target.value;
                    scheduleSave();
                }}
                onFocus={() => setEditingTitle(true)}
                onBlur={() => setEditingTitle(false)}
                onKeyDown={blurOnEnter}
                placeholder="Title"
                spellCheck
            />
            <div className={`editor-wrap ${eff.dimSentences ? "dimming" : ""}`}>
                <div className="editor-backdrop" ref={backdropRef} aria-hidden>
                    {renderBackdrop(body, caret, eff.dimSentences, eff.typewriter, markerRef)}
                </div>
                <textarea
                    ref={textareaRef}
                    className="editor"
                    value={body}
                    onChange={(e) => {
                        setBody(e.target.value);
                        bodyRef.current = e.target.value;
                        setCaret(e.target.selectionStart);
                        scheduleSave();
                    }}
                    onSelect={(e) => setCaret(e.currentTarget.selectionStart)}
                    onScroll={syncBackdropScroll}
                    onFocus={() => setEditingTitle(false)}
                    spellCheck
                    placeholder="Start writing…"
                />
            </div>
            {showStatus && <div className="editor-status">
                <span>{countWords(body).toLocaleString()} words</span>
                <span className={`save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${error}`}
                </span>
            </div>}
        </>
    );
}

// Render the visible text behind the transparent textarea. When `dim` is set,
// each sentence is its own span so all but the active one can be faded. When
// `marker` is set (typewriter scrolling), the active span is split at the caret
// around a zero-size marker whose offset drives the scroll position.
function renderBackdrop(
    body: string,
    caret: number,
    dim: boolean,
    marker: boolean,
    markerRef: React.RefObject<HTMLSpanElement>
) {
    // A trailing zero-width char keeps the backdrop's height in step with the
    // textarea when the body ends in a newline (an empty last line would
    // otherwise collapse in the div but not in the textarea).
    const trailer = (
        <span key="trail" className="seg">
            {"​"}
        </span>
    );
    if (!dim && !marker) {
        return (
            <>
                {body}
                {trailer}
            </>
        );
    }
    const segs = segmentSentences(body);
    const nodes = segs.map((s, idx) => {
        const text = body.slice(s.start, s.end);
        const last = idx === segs.length - 1;
        const active = (caret >= s.start && caret < s.end) || (last && caret >= s.end);
        const cls = dim ? (active ? "seg active" : "seg dim") : "seg";
        if (marker && active) {
            const local = Math.max(0, Math.min(caret - s.start, text.length));
            return (
                <span className={cls} key={idx}>
                    {text.slice(0, local)}
                    <span className="caret-marker" ref={markerRef} />
                    {text.slice(local)}
                </span>
            );
        }
        return (
            <span className={cls} key={idx}>
                {text}
            </span>
        );
    });
    nodes.push(trailer);
    return nodes;
}
