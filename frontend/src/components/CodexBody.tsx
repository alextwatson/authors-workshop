import { useLayoutEffect, useRef } from "react";

interface Props {
    value: string;
    onChange: (value: string) => void;
}

const INDENT = 4;
// Bullet marker cycles by nesting level: dot → square → star → dot …
const MARKERS = ["•", "▪", "★"];
const markerFor = (level: number) => MARKERS[((level % 3) + 3) % 3];
// A bullet line: leading indent spaces, a marker, then an optional space + text.
const bulletLineRe = new RegExp(`^( *)([${MARKERS.join("")}])(?: (.*))?$`);

// Bounds of the line containing `pos` (start = after the previous newline; end =
// the next newline or end of string).
const lineStart = (v: string, pos: number) => v.lastIndexOf("\n", pos - 1) + 1;
const lineEnd = (v: string, pos: number) => {
    const nl = v.indexOf("\n", pos);
    return nl === -1 ? v.length : nl;
};

// A plain-text body editor: one textarea so selection spans freely, with bullet
// list behavior (Enter continues, Tab nests + cycles the marker, Backspace
// outdents) and markdown-style **bold**. The read view (CodexEditor) renders the
// bullets' hanging indent and the bold.
export default function CodexBody({ value, onChange }: Props) {
    const ref = useRef<HTMLTextAreaElement | null>(null);
    // After a structural edit, where to restore the selection once React repaints.
    const pending = useRef<{ start: number; end: number } | null>(null);

    useLayoutEffect(() => {
        const ta = ref.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = `${ta.scrollHeight}px`;
        if (pending.current) {
            const { start, end } = pending.current;
            pending.current = null;
            ta.focus();
            ta.selectionStart = start;
            ta.selectionEnd = end;
        }
    });

    // Commit new text and place the selection afterwards (collapsed if end omitted).
    function commit(next: string, start: number, end = start) {
        pending.current = { start, end };
        onChange(next);
    }

    // Wrap/unwrap the [start, end) range in ** for bold. Collapsed: insert an
    // empty pair and drop the caret between them.
    function bold(start: number, end: number) {
        if (start === end) {
            commit(value.slice(0, start) + "****" + value.slice(end), start + 2);
            return;
        }
        const sel = value.slice(start, end);
        if (/^\*\*[\s\S]+\*\*$/.test(sel)) {
            const inner = sel.slice(2, -2);
            commit(value.slice(0, start) + inner + value.slice(end), start, start + inner.length);
        } else if (value.slice(start - 2, start) === "**" && value.slice(end, end + 2) === "**") {
            commit(value.slice(0, start - 2) + sel + value.slice(end + 2), start - 2, end - 2);
        } else {
            commit(value.slice(0, start) + "**" + sel + "**" + value.slice(end), start + 2, end + 2);
        }
    }

    function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
        const ta = e.currentTarget;
        const selStart = ta.selectionStart;
        const selEnd = ta.selectionEnd;

        if ((e.metaKey || e.ctrlKey) && (e.key === "b" || e.key === "B")) {
            e.preventDefault();
            bold(selStart, selEnd);
            return;
        }

        if (e.key === "Enter" && !e.shiftKey) {
            const ls = lineStart(value, selStart);
            const line = value.slice(ls, lineEnd(value, selStart));
            const m = line.match(bulletLineRe);
            if (m && (m[3] ?? "").trim() === "") {
                // Enter on an empty bullet ends the list (blank line).
                e.preventDefault();
                commit(value.slice(0, ls) + value.slice(lineEnd(value, selStart)), ls);
                return;
            }
            e.preventDefault();
            // Continue the bullet on the next line, or just carry a plain indent.
            const indent = line.match(/^( *)/)![1];
            const prefix = m ? indent + markerFor(indent.length / INDENT) + " " : indent;
            commit(
                value.slice(0, selStart) + "\n" + prefix + value.slice(selEnd),
                selStart + 1 + prefix.length,
            );
            return;
        }

        if (e.key === "Tab") {
            // Nest every bullet line the selection touches; the marker follows the
            // new depth (dot → square → star → …). Leave Tab alone with no bullets.
            const ls = lineStart(value, selStart);
            const le = lineEnd(value, selEnd);
            const lines = value.slice(ls, le).split("\n");
            if (!lines.some((l) => bulletLineRe.test(l))) return;
            e.preventDefault();
            const rebuilt = lines
                .map((l) => {
                    const m = l.match(bulletLineRe);
                    if (!m) return l;
                    const cur = m[1].length;
                    const indent = e.shiftKey ? Math.max(0, cur - INDENT) : cur + INDENT;
                    return " ".repeat(indent) + markerFor(indent / INDENT) + " " + (m[3] ?? "");
                })
                .join("\n");
            const next = value.slice(0, ls) + rebuilt + value.slice(le);
            if (selStart === selEnd) {
                // Keep the caret with the content it was on (shifted by the
                // single line's indent change), rather than selecting the line.
                const delta = rebuilt.length - (le - ls);
                commit(next, Math.max(ls, selStart + delta));
            } else {
                commit(next, ls, ls + rebuilt.length);
            }
            return;
        }

        if (e.key === "Backspace" && selStart === selEnd) {
            const ls = lineStart(value, selStart);
            const le = lineEnd(value, selStart);
            const line = value.slice(ls, le);
            const m = line.match(bulletLineRe);
            if (m) {
                const indent = m[1].length;
                // Head of the text: past the indent, marker, and its space.
                const head = indent + 1 + (line[indent + 1] === " " ? 1 : 0);
                if (selStart - ls <= head) {
                    e.preventDefault();
                    const content = m[3] ?? "";
                    if (indent >= INDENT) {
                        // Outdent one level, mirroring Tab (marker follows depth).
                        const ni = indent - INDENT;
                        const newLine = " ".repeat(ni) + markerFor(ni / INDENT) + " " + content;
                        commit(value.slice(0, ls) + newLine + value.slice(le), ls + ni + 2);
                    } else {
                        // Level 0: drop the bullet, keep the text as a plain line.
                        commit(value.slice(0, ls) + content + value.slice(le), ls);
                    }
                    return;
                }
            }
            // Otherwise fall through to the textarea's own backspace (which now
            // merges lines and deletes across a selection natively).
        }
    }

    // Toggle a bullet on the caret's current line.
    function toggleBullet() {
        const ta = ref.current;
        if (!ta) return;
        const ls = lineStart(value, ta.selectionStart);
        const le = lineEnd(value, ta.selectionStart);
        const line = value.slice(ls, le);
        const m = line.match(bulletLineRe);
        let newLine: string;
        if (m) {
            newLine = m[3] ?? ""; // strip marker + indent → plain text
        } else {
            const im = line.match(/^( *)(.*)$/)!;
            newLine = im[1] + markerFor(im[1].length / INDENT) + " " + im[2];
        }
        commit(value.slice(0, ls) + newLine + value.slice(le), ls + newLine.length);
    }

    return (
        <div className="field">
            <div className="codex-entry-head">
                <span className="field-label">Entry</span>
                <div className="codex-format-btns">
                    <button
                        type="button"
                        className="codex-format-btn"
                        title="Bold the selection (⌘B)"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                            const ta = ref.current;
                            if (ta) bold(ta.selectionStart, ta.selectionEnd);
                        }}
                    >
                        <strong>B</strong>
                    </button>
                    <button
                        type="button"
                        className="codex-format-btn"
                        title="Toggle a bullet on the current line"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={toggleBullet}
                    >
                        • Bullet
                    </button>
                </div>
            </div>
            <textarea
                ref={ref}
                className="codex-body-input"
                value={value}
                rows={1}
                placeholder="Write the lore — history, rules, who rules where, how the magic works…"
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={onKeyDown}
                spellCheck
            />
        </div>
    );
}
