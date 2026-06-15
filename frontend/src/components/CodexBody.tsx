import { useLayoutEffect, useRef } from "react";

interface Props {
    value: string;
    onChange: (value: string) => void;
}

// One logical line of the entry: an indent (leading spaces, 4 per nest level)
// and its text. Keeping indent separate from text lets each line render in its
// own single-line textarea where a CSS hanging indent actually works, so a
// wrapped bullet's overhang lines up under its text instead of the left edge.
type Row = { indent: number; text: string };

const INDENT = 4;
const isBullet = (text: string) => /^•\s/.test(text);

function parse(value: string): Row[] {
    const lines = value.length ? value.split("\n") : [""];
    return lines.map((line) => {
        const m = line.match(/^( *)(.*)$/)!;
        return { indent: m[1].length, text: m[2] };
    });
}

function serialize(rows: Row[]): string {
    return rows.map((r) => " ".repeat(r.indent) + r.text).join("\n");
}

// A plain-text body editor with bullet support and per-line hanging indents.
export default function CodexBody({ value, onChange }: Props) {
    const rows = parse(value);
    const refs = useRef<(HTMLTextAreaElement | null)[]>([]);
    const focused = useRef(0);
    const pending = useRef<{ line: number; caret: number } | null>(null);

    useLayoutEffect(() => {
        // Auto-grow every line, then restore focus/caret after a structural edit.
        refs.current.forEach((ta) => {
            if (!ta) return;
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
        });
        if (pending.current) {
            const { line, caret } = pending.current;
            pending.current = null;
            const ta = refs.current[line];
            if (ta) {
                ta.focus();
                ta.selectionStart = ta.selectionEnd = caret;
            }
        }
    });

    // Commit new rows; optionally place the caret on a given line afterwards.
    function commit(next: Row[], line?: number, caret?: number) {
        if (line != null) pending.current = { line, caret: caret ?? 0 };
        onChange(serialize(next));
    }

    function onLineChange(i: number, v: string) {
        if (v.includes("\n")) {
            // A multi-line paste splits into rows.
            const parts = v.split("\n");
            const inserted: Row[] = parts.map((t, k) => ({
                indent: k === 0 ? rows[i].indent : 0,
                text: t,
            }));
            const next = [...rows.slice(0, i), ...inserted, ...rows.slice(i + 1)];
            commit(next, i + parts.length - 1, parts[parts.length - 1].length);
            return;
        }
        const next = [...rows];
        next[i] = { ...rows[i], text: v };
        onChange(serialize(next)); // typing: caret stays put, no restore needed
    }

    function onLineKeyDown(i: number, e: React.KeyboardEvent<HTMLTextAreaElement>) {
        const ta = e.currentTarget;
        const caret = ta.selectionStart;
        const row = rows[i];

        if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (isBullet(row.text) && row.text.trim() === "•") {
                // Enter on an empty bullet ends the list.
                const next = [...rows];
                next[i] = { indent: 0, text: "" };
                commit(next, i, 0);
                return;
            }
            const before = row.text.slice(0, caret);
            const after = row.text.slice(caret);
            const bullet = isBullet(row.text);
            const newText = bullet ? "• " + after : after;
            const next = [
                ...rows.slice(0, i),
                { indent: row.indent, text: before },
                { indent: row.indent, text: newText },
                ...rows.slice(i + 1),
            ];
            commit(next, i + 1, bullet ? 2 : 0);
            return;
        }

        if (e.key === "Backspace" && caret === 0 && i > 0) {
            e.preventDefault();
            const prev = rows[i - 1];
            const merged: Row = { indent: prev.indent, text: prev.text + row.text };
            const next = [...rows.slice(0, i - 1), merged, ...rows.slice(i + 1)];
            commit(next, i - 1, prev.text.length);
            return;
        }

        if (e.key === "Tab") {
            if (!isBullet(row.text)) return; // leave Tab alone outside bullets
            e.preventDefault();
            const next = [...rows];
            next[i] = {
                ...row,
                indent: e.shiftKey ? Math.max(0, row.indent - INDENT) : row.indent + INDENT,
            };
            commit(next, i, caret);
            return;
        }

        if (e.key === "ArrowUp" && caret === 0 && i > 0) {
            refs.current[i - 1]?.focus();
        }
        if (e.key === "ArrowDown" && caret === row.text.length && i < rows.length - 1) {
            refs.current[i + 1]?.focus();
        }
    }

    function toggleBullet() {
        const i = Math.min(focused.current, rows.length - 1);
        const row = rows[i];
        const next = [...rows];
        next[i] = isBullet(row.text)
            ? { ...row, text: row.text.replace(/^•\s/, "") }
            : { ...row, text: "• " + row.text };
        commit(next, i, next[i].text.length);
    }

    return (
        <div className="field">
            <div className="codex-entry-head">
                <span className="field-label">Entry</span>
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
            <div className="codex-lines">
                {rows.map((row, i) => {
                    const bullet = isBullet(row.text);
                    const level = Math.floor(row.indent / INDENT);
                    return (
                        <textarea
                            key={i}
                            ref={(el) => (refs.current[i] = el)}
                            className={`codex-line-input ${bullet ? "is-bullet" : ""}`}
                            style={bullet ? { marginLeft: `${level * 1.4}em` } : undefined}
                            value={row.text}
                            rows={1}
                            placeholder={
                                rows.length === 1 && row.text === ""
                                    ? "Write the lore — history, rules, who rules where, how the magic works…"
                                    : undefined
                            }
                            onFocus={() => (focused.current = i)}
                            onChange={(e) => onLineChange(i, e.target.value)}
                            onKeyDown={(e) => onLineKeyDown(i, e)}
                            spellCheck
                        />
                    );
                })}
            </div>
        </div>
    );
}
