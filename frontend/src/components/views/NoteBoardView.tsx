import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { ImportNotesText, ReadNoteBoard, WriteNoteBoard } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import {
    BOARD_H,
    BOARD_W,
    emptyBoard,
    GRID_SIZE,
    MIN_NOTE_H,
    MIN_NOTE_W,
    NOTE_COLORS,
    NOTE_H,
    NOTE_W,
    NoteBoard,
    parseNoteBoard,
    serializeNoteBoard,
    StickyNote,
} from "../../noteboard";
import { newId } from "../../docnames";

interface Props {
    project: main.Project;
}

type SaveState = "idle" | "unsaved" | "saved" | "error";
type View = { zoom: number; x: number; y: number };

// A drag in progress. Canvas panning is tracked separately (panRef); this
// covers the per-note gestures and thread-drawing.
type Drag =
    | { kind: "move"; pid: number; noteId: string; sx: number; sy: number; ox: number; oy: number }
    | { kind: "resize"; pid: number; noteId: string; sx: number; sy: number; ow: number; oh: number }
    | { kind: "thread"; pid: number; fromId: string }
    | null;

const AUTOSAVE_DELAY_MS = 800;
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 4;
const ZOOM_SPEED = 0.0015;

// A free-form pinboard of sticky notes connected by thread lines. Notes store
// plain board-space pixel coordinates (there's no background image to normalize
// against); the whole canvas pans and zooms via a single CSS transform, so the
// notes and threads inherit it without per-element conversion. Mirrors the
// AtlasView interaction + autosave model.
export default function NoteBoardView({ project }: Props) {
    const [loaded, setLoaded] = useState(false);
    const [board, setBoard] = useState<NoteBoard>(emptyBoard);
    const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
    // While drawing a thread, the live cursor position in board coords.
    const [threadCursor, setThreadCursor] = useState<{ x: number; y: number } | null>(null);
    // The currently selected thread (for deletion) and the open colour palette.
    const [selThread, setSelThread] = useState<string | null>(null);
    const [palette, setPalette] = useState<string | null>(null);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const boardRef = useRef<NoteBoard>(emptyBoard());
    const dirtyRef = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const viewportRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef(view);
    viewRef.current = view;
    const panRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(
        null
    );
    const draggedRef = useRef(false);
    const dragRef = useRef<Drag>(null);

    useEffect(() => {
        ReadNoteBoard(project.path)
            .then((json) => {
                const b = parseNoteBoard(json);
                boardRef.current = b;
                setBoard(b);
                setLoaded(true);
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                WriteNoteBoard(project.path, serializeNoteBoard(boardRef.current)).catch(() => {});
            }
        };
    }, []);

    // Wheel zoom needs a non-passive listener to call preventDefault.
    useEffect(() => {
        const vp = viewportRef.current;
        if (!vp) return;
        function onWheel(e: WheelEvent) {
            e.preventDefault();
            const rect = vp!.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            const v = viewRef.current;
            const zoom = Math.min(
                MAX_ZOOM,
                Math.max(MIN_ZOOM, v.zoom * Math.exp(-e.deltaY * ZOOM_SPEED))
            );
            const k = zoom / v.zoom;
            setView({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
        }
        vp.addEventListener("wheel", onWheel, { passive: false });
        return () => vp.removeEventListener("wheel", onWheel);
    }, [loaded]);

    // Delete the selected thread with the keyboard.
    useEffect(() => {
        if (!selThread) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Delete" || e.key === "Backspace") {
                e.preventDefault();
                deleteThread(selThread);
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [selThread]);

    async function saveNow() {
        window.clearTimeout(saveTimer.current);
        try {
            await WriteNoteBoard(project.path, serializeNoteBoard(boardRef.current));
            dirtyRef.current = false;
            setSaveState("saved");
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

    function mutate(updater: (b: NoteBoard) => NoteBoard) {
        const next = updater(boardRef.current);
        boardRef.current = next;
        setBoard(next);
        scheduleSave();
    }

    function updateNote(id: string, patch: Partial<StickyNote>) {
        mutate((b) => ({ ...b, notes: b.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
    }

    // --- view helpers ---

    // Keep a note's top-left inside the finite board given its size.
    function clampXY(x: number, y: number, w: number, h: number) {
        return {
            x: Math.round(Math.max(0, Math.min(BOARD_W - w, x))),
            y: Math.round(Math.max(0, Math.min(BOARD_H - h, y))),
        };
    }

    function screenToBoard(clientX: number, clientY: number) {
        const rect = viewportRef.current!.getBoundingClientRect();
        const v = viewRef.current;
        return { x: (clientX - rect.left - v.x) / v.zoom, y: (clientY - rect.top - v.y) / v.zoom };
    }

    function zoomBy(factor: number) {
        const vp = viewportRef.current;
        if (!vp) return;
        const r = vp.getBoundingClientRect();
        const cx = r.width / 2;
        const cy = r.height / 2;
        const v = viewRef.current;
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
        const k = zoom / v.zoom;
        setView({ zoom, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
    }

    function noteAt(bx: number, by: number): StickyNote | null {
        // Topmost (last rendered) wins.
        for (let i = boardRef.current.notes.length - 1; i >= 0; i--) {
            const n = boardRef.current.notes[i];
            if (bx >= n.x && bx <= n.x + n.w && by >= n.y && by <= n.y + n.h) return n;
        }
        return null;
    }

    // --- notes / threads ---

    function addNote() {
        const vp = viewportRef.current;
        const r = vp?.getBoundingClientRect();
        const center = r
            ? screenToBoard(r.left + r.width / 2, r.top + r.height / 2)
            : { x: 0, y: 0 };
        const id = newId();
        const pos = clampXY(center.x - NOTE_W / 2, center.y - NOTE_H / 2, NOTE_W, NOTE_H);
        mutate((b) => ({
            ...b,
            notes: [
                ...b.notes,
                {
                    id,
                    x: pos.x,
                    y: pos.y,
                    w: NOTE_W,
                    h: NOTE_H,
                    color: b.defaultColor,
                    text: "",
                },
            ],
        }));
    }

    // Pull in a plain-text file and turn each non-empty line into a sticky
    // note, laid out in a grid so they don't all stack on one spot.
    async function importNotes() {
        let text: string;
        try {
            text = await ImportNotesText();
        } catch (err) {
            setError(String(err));
            setSaveState("error");
            return;
        }
        const lines = text
            .split(/\r?\n/)
            .map((l) => l.trim())
            .filter((l) => l.length > 0);
        if (lines.length === 0) return;

        const vp = viewportRef.current;
        const r = vp?.getBoundingClientRect();
        const origin = r
            ? screenToBoard(r.left + 40, r.top + 40)
            : { x: 0, y: 0 };
        const gapX = NOTE_W + 24;
        const gapY = NOTE_H + 24;
        const cols = Math.max(1, Math.ceil(Math.sqrt(lines.length)));
        mutate((b) => ({
            ...b,
            notes: [
                ...b.notes,
                ...lines.map((text, i) => {
                    const pos = clampXY(
                        origin.x + (i % cols) * gapX,
                        origin.y + Math.floor(i / cols) * gapY,
                        NOTE_W,
                        NOTE_H
                    );
                    return {
                        id: newId(),
                        x: pos.x,
                        y: pos.y,
                        w: NOTE_W,
                        h: NOTE_H,
                        color: b.defaultColor,
                        text,
                    };
                }),
            ],
        }));
    }

    function deleteNote(id: string) {
        mutate((b) => ({
            ...b,
            notes: b.notes.filter((n) => n.id !== id),
            threads: b.threads.filter((t) => t.from !== id && t.to !== id),
        }));
        setPalette(null);
    }

    function deleteThread(id: string) {
        mutate((b) => ({ ...b, threads: b.threads.filter((t) => t.id !== id) }));
        setSelThread(null);
    }

    // --- canvas pan ---

    function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        // Only pan from empty canvas; note gestures stopPropagation.
        viewportRef.current?.setPointerCapture?.(e.pointerId);
        panRef.current = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y };
        draggedRef.current = false;
    }

    function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
        const p = panRef.current;
        if (!p || p.id !== e.pointerId) return;
        const dx = e.clientX - p.sx;
        const dy = e.clientY - p.sy;
        if (Math.abs(dx) + Math.abs(dy) > 3) draggedRef.current = true;
        setView((v) => ({ ...v, x: p.ox + dx, y: p.oy + dy }));
    }

    function onPointerUp(e: ReactPointerEvent<HTMLDivElement>) {
        if (panRef.current && panRef.current.id === e.pointerId) {
            viewportRef.current?.releasePointerCapture?.(e.pointerId);
            panRef.current = null;
        }
    }

    function onViewportClick() {
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }
        setSelThread(null);
        setPalette(null);
    }

    // --- note move ---

    function startMove(e: ReactPointerEvent<HTMLDivElement>, n: StickyNote) {
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragRef.current = {
            kind: "move",
            pid: e.pointerId,
            noteId: n.id,
            sx: e.clientX,
            sy: e.clientY,
            ox: n.x,
            oy: n.y,
        };
    }

    function onMoveMove(e: ReactPointerEvent<HTMLDivElement>) {
        const d = dragRef.current;
        if (d?.kind !== "move" || d.pid !== e.pointerId) return;
        const z = viewRef.current.zoom;
        const n = boardRef.current.notes.find((x) => x.id === d.noteId);
        if (!n) return;
        updateNote(d.noteId, clampXY(d.ox + (e.clientX - d.sx) / z, d.oy + (e.clientY - d.sy) / z, n.w, n.h));
    }

    // --- note resize ---

    function startResize(e: ReactPointerEvent<HTMLDivElement>, n: StickyNote) {
        e.stopPropagation();
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragRef.current = {
            kind: "resize",
            pid: e.pointerId,
            noteId: n.id,
            sx: e.clientX,
            sy: e.clientY,
            ow: n.w,
            oh: n.h,
        };
    }

    function onResizeMove(e: ReactPointerEvent<HTMLDivElement>) {
        const d = dragRef.current;
        if (d?.kind !== "resize" || d.pid !== e.pointerId) return;
        const z = viewRef.current.zoom;
        const n = boardRef.current.notes.find((x) => x.id === d.noteId);
        if (!n) return;
        updateNote(d.noteId, {
            w: Math.round(
                Math.min(BOARD_W - n.x, Math.max(MIN_NOTE_W, d.ow + (e.clientX - d.sx) / z))
            ),
            h: Math.round(
                Math.min(BOARD_H - n.y, Math.max(MIN_NOTE_H, d.oh + (e.clientY - d.sy) / z))
            ),
        });
    }

    // --- thread drawing ---

    function startThread(e: ReactPointerEvent<HTMLDivElement>, n: StickyNote) {
        e.stopPropagation();
        e.preventDefault(); // don't start a text selection from the drag
        e.currentTarget.setPointerCapture?.(e.pointerId);
        dragRef.current = { kind: "thread", pid: e.pointerId, fromId: n.id };
        const p = screenToBoard(e.clientX, e.clientY);
        setThreadCursor(p);
    }

    function onThreadMove(e: ReactPointerEvent<HTMLDivElement>) {
        const d = dragRef.current;
        if (d?.kind !== "thread" || d.pid !== e.pointerId) return;
        setThreadCursor(screenToBoard(e.clientX, e.clientY));
    }

    function endThread(e: ReactPointerEvent<HTMLDivElement>) {
        const d = dragRef.current;
        if (d?.kind === "thread" && d.pid === e.pointerId) {
            const p = screenToBoard(e.clientX, e.clientY);
            const target = noteAt(p.x, p.y);
            if (target && target.id !== d.fromId) {
                const exists = boardRef.current.threads.some(
                    (t) =>
                        (t.from === d.fromId && t.to === target.id) ||
                        (t.from === target.id && t.to === d.fromId)
                );
                if (!exists) {
                    mutate((b) => ({
                        ...b,
                        threads: [...b.threads, { id: newId(), from: d.fromId, to: target.id }],
                    }));
                }
            }
        }
        endDrag(e);
        setThreadCursor(null);
    }

    function endDrag(e: ReactPointerEvent<HTMLDivElement>) {
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        dragRef.current = null;
    }

    if (error && !loaded) {
        return (
            <div className="view">
                <p className="subtitle">{error}</p>
            </div>
        );
    }
    if (!loaded) return <div className="noteboard" />;

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    const center = (n: StickyNote) => ({ x: n.x + n.w / 2, y: n.y + n.h / 2 });
    const noteById = (id: string) => board.notes.find((n) => n.id === id);
    const threadFrom = threadCursor && dragRef.current?.kind === "thread"
        ? noteById(dragRef.current.fromId)
        : null;

    return (
        <div className={`noteboard ${threadCursor ? "drawing-thread" : ""}`}>
            <div className="noteboard-toolbar">
                <button className="atlas-tool" onClick={addNote}>
                    + Sticky note
                </button>
                <span className="atlas-sep" />
                <span className="noteboard-deflabel">New note color</span>
                <div className="atlas-swatches">
                    {NOTE_COLORS.map((c) => (
                        <button
                            key={c}
                            className={`atlas-swatch ${board.defaultColor === c ? "active" : ""}`}
                            style={{ background: c }}
                            title="Default color for new notes"
                            onClick={() => mutate((b) => ({ ...b, defaultColor: c }))}
                        />
                    ))}
                </div>
                <span className="atlas-sep" />
                <button className="atlas-tool" title="Zoom in" onClick={() => zoomBy(1.2)}>
                    +
                </button>
                <button className="atlas-tool" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
                    −
                </button>
                <button
                    className="atlas-tool"
                    title="Reset view"
                    onClick={() => setView({ zoom: 1, x: 0, y: 0 })}
                >
                    Reset
                </button>
                <span className="atlas-sep" />
                <button
                    className="atlas-tool"
                    title="Import a text file — each line becomes a note"
                    onClick={importNotes}
                >
                    Import notes
                </button>
                <span className={`atlas-save save-status ${saveState}`}>
                    {saveState === "unsaved" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && "Save failed"}
                </span>
            </div>

            <div
                className="noteboard-viewport"
                ref={viewportRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onClick={onViewportClick}
            >
                {board.notes.length === 0 && (
                    <div className="noteboard-hint">
                        Add a sticky note to start pinning ideas, then drag the squiggle in a
                        note’s bottom-left corner to another note to connect them.
                    </div>
                )}
                <div
                    className="noteboard-canvas"
                    style={{
                        width: BOARD_W,
                        height: BOARD_H,
                        backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
                        transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                        transformOrigin: "0 0",
                    }}
                >
                    {/* Thread lines, drawn in board coordinates. overflow:visible lets
                        the 0-sized svg paint across the whole board. */}
                    <svg className="noteboard-threads" width={1} height={1}>
                        {board.threads.map((t) => {
                            const a = noteById(t.from);
                            const b = noteById(t.to);
                            if (!a || !b) return null;
                            const ca = center(a);
                            const cb = center(b);
                            const select = (e: React.MouseEvent) => {
                                e.stopPropagation();
                                setSelThread(t.id);
                            };
                            // Stop the pointer-down from reaching the viewport,
                            // which would capture the pointer for panning and
                            // steal the click that selects this thread.
                            const grab = (e: React.PointerEvent) => e.stopPropagation();
                            return (
                                <g key={t.id}>
                                    {/* Wide, invisible line so the thin thread is
                                        easy to click. */}
                                    <line
                                        className="noteboard-thread-hit"
                                        x1={ca.x}
                                        y1={ca.y}
                                        x2={cb.x}
                                        y2={cb.y}
                                        onPointerDown={grab}
                                        onClick={select}
                                    />
                                    <line
                                        className={`noteboard-thread ${selThread === t.id ? "selected" : ""}`}
                                        x1={ca.x}
                                        y1={ca.y}
                                        x2={cb.x}
                                        y2={cb.y}
                                        vectorEffect="non-scaling-stroke"
                                        onPointerDown={grab}
                                        onClick={select}
                                    />
                                </g>
                            );
                        })}
                        {threadFrom && threadCursor && (
                            <line
                                className="noteboard-thread draft"
                                x1={center(threadFrom).x}
                                y1={center(threadFrom).y}
                                x2={threadCursor.x}
                                y2={threadCursor.y}
                                vectorEffect="non-scaling-stroke"
                            />
                        )}
                    </svg>

                    {/* Delete button for the selected thread, parked at its
                        midpoint. Counter-scaled so it stays a constant size. */}
                    {(() => {
                        if (!selThread) return null;
                        const t = board.threads.find((x) => x.id === selThread);
                        if (!t) return null;
                        const a = noteById(t.from);
                        const b = noteById(t.to);
                        if (!a || !b) return null;
                        const mx = (center(a).x + center(b).x) / 2;
                        const my = (center(a).y + center(b).y) / 2;
                        return (
                            <button
                                className="noteboard-thread-del"
                                title="Delete thread"
                                style={{
                                    left: mx,
                                    top: my,
                                    transform: `translate(-50%, -50%) scale(${1 / view.zoom})`,
                                }}
                                onPointerDown={stop}
                                onClick={(e) => {
                                    stop(e);
                                    deleteThread(selThread);
                                }}
                            >
                                ✕
                            </button>
                        );
                    })()}

                    {board.notes.map((n) => (
                        <div
                            key={n.id}
                            className="sticky-note"
                            style={{
                                left: n.x,
                                top: n.y,
                                width: n.w,
                                height: n.h,
                                background: n.color,
                            }}
                            onClick={stop}
                        >
                            <div
                                className="sticky-head"
                                onPointerDown={(e) => startMove(e, n)}
                                onPointerMove={onMoveMove}
                                onPointerUp={endDrag}
                            >
                                <button
                                    className="sticky-swatch"
                                    title="Change color"
                                    onPointerDown={stop}
                                    onClick={(e) => {
                                        stop(e);
                                        setPalette((p) => (p === n.id ? null : n.id));
                                    }}
                                />
                                <button
                                    className="sticky-del"
                                    title="Delete note"
                                    onPointerDown={stop}
                                    onClick={(e) => {
                                        stop(e);
                                        deleteNote(n.id);
                                    }}
                                >
                                    ✕
                                </button>
                            </div>
                            <textarea
                                className="sticky-text"
                                value={n.text}
                                placeholder="Note…"
                                spellCheck
                                onChange={(e) => updateNote(n.id, { text: e.target.value })}
                            />
                            <div
                                className="sticky-resize"
                                title="Drag to resize"
                                onPointerDown={(e) => startResize(e, n)}
                                onPointerMove={onResizeMove}
                                onPointerUp={endDrag}
                            />
                            {palette === n.id && (
                                <div className="sticky-palette" onPointerDown={stop} onClick={stop}>
                                    {NOTE_COLORS.map((c) => (
                                        <button
                                            key={c}
                                            className={`atlas-swatch ${n.color === c ? "active" : ""}`}
                                            style={{ background: c }}
                                            onClick={() => {
                                                updateNote(n.id, { color: c });
                                                setPalette(null);
                                            }}
                                        />
                                    ))}
                                </div>
                            )}
                            <div
                                className="sticky-thread-handle"
                                title="Drag to another note to connect"
                                onPointerDown={(e) => startThread(e, n)}
                                onPointerMove={onThreadMove}
                                onPointerUp={endThread}
                            >
                                <svg viewBox="0 0 26 12" aria-hidden="true">
                                    <path
                                        d="M2 6 q3 -5 6 0 t6 0 t6 0 t6 0"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                    />
                                </svg>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}
