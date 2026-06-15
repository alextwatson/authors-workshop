import { PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import {
    ImportMapImage,
    ReadAtlas,
    ReadMapImage,
    WriteAtlas,
} from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";
import {
    Atlas,
    AtlasMap,
    ATLAS_COLORS,
    centroid,
    emptyAtlas,
    parseAtlas,
    PIN_GLYPH,
    PIN_TYPES,
    PinType,
    serializeAtlas,
} from "../atlas";
import { newId } from "../docnames";
import { blurOnEnter } from "../ui";

interface Props {
    project: main.Project;
    // Codex entries, for linking a pin/region to its article.
    entries: { filename: string; title: string }[];
    onOpenEntry: (filename: string) => void;
}

type SaveState = "idle" | "unsaved" | "saved" | "error";
type Tool = "pan" | "pin" | "region";
type Selected = { kind: "pin" | "region"; id: string } | null;
type View = { zoom: number; x: number; y: number };

const AUTOSAVE_DELAY_MS = 800;
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 20;
// Lower = gentler wheel/trackpad zoom. Tuned so a casual two-finger swipe
// nudges the zoom rather than lurching it.
const ZOOM_SPEED = 0.0015;

function clamp01(n: number): number {
    return Math.min(1, Math.max(0, n));
}

// An uploaded world map with zoom/pan, location pins, and click-to-draw dotted
// territory outlines. A project can hold several maps. Markers store normalized
// 0..1 coordinates so they stay put across zoom; pins and labels counter-scale
// to keep a constant screen size.
export default function AtlasView({ project, entries, onOpenEntry }: Props) {
    const [loaded, setLoaded] = useState(false);
    const [atlas, setAtlas] = useState<Atlas>(emptyAtlas);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [imageUrl, setImageUrl] = useState("");
    const [imgSize, setImgSize] = useState({ w: 0, h: 0 });
    const [view, setView] = useState<View>({ zoom: 1, x: 0, y: 0 });
    const [tool, setTool] = useState<Tool>("pan");
    const [draft, setDraft] = useState<{ x: number; y: number }[]>([]);
    const [selected, setSelected] = useState<Selected>(null);
    const [showPins, setShowPins] = useState(true);
    const [showRegions, setShowRegions] = useState(true);
    // Specific markers the user has hidden via the filter panel.
    const [hidden, setHidden] = useState<Set<string>>(new Set());
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterSearch, setFilterSearch] = useState("");
    const [mapListOpen, setMapListOpen] = useState(true);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [error, setError] = useState("");

    const atlasRef = useRef<Atlas>(emptyAtlas());
    const dirtyRef = useRef(false);
    const saveTimer = useRef<number | undefined>(undefined);
    const viewportRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef(view);
    viewRef.current = view;
    const panRef = useRef<{ id: number; sx: number; sy: number; ox: number; oy: number } | null>(
        null
    );
    const draggedRef = useRef(false);

    const activeMap: AtlasMap | null =
        atlas.maps.find((m) => m.id === activeId) ?? atlas.maps[0] ?? null;

    useEffect(() => {
        ReadAtlas(project.path)
            .then((json) => {
                const a = parseAtlas(json);
                atlasRef.current = a;
                setAtlas(a);
                setActiveId(a.maps[0]?.id ?? null);
                setLoaded(true);
            })
            .catch((err) => setError(String(err)));
        return () => {
            window.clearTimeout(saveTimer.current);
            if (dirtyRef.current) {
                WriteAtlas(project.path, serializeAtlas(atlasRef.current)).catch(() => {});
            }
        };
    }, []);

    // Load the active map's image whenever the selection or its image changes.
    const activeMapId = activeMap?.id;
    const activeMapImage = activeMap?.mapImage;
    useEffect(() => {
        if (!activeMapImage) {
            setImageUrl("");
            return;
        }
        let cancelled = false;
        setImageUrl("");
        setImgSize({ w: 0, h: 0 });
        ReadMapImage(project.path, activeMapImage)
            .then((url) => {
                if (!cancelled) setImageUrl(url);
            })
            .catch(() => {
                if (!cancelled) setError("Could not load the map image.");
            });
        return () => {
            cancelled = true;
        };
    }, [activeMapId, activeMapImage]);

    // Reset transient UI when switching maps.
    useEffect(() => {
        setSelected(null);
        setDraft([]);
        setTool("pan");
    }, [activeMapId]);

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
    }, [loaded, imageUrl]);

    async function saveNow() {
        window.clearTimeout(saveTimer.current);
        try {
            await WriteAtlas(project.path, serializeAtlas(atlasRef.current));
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

    function mutate(updater: (a: Atlas) => Atlas) {
        const next = updater(atlasRef.current);
        atlasRef.current = next;
        setAtlas(next);
        scheduleSave();
    }

    // Apply a change to the active map only.
    function mutateMap(updater: (m: AtlasMap) => AtlasMap) {
        if (!activeMap) return;
        const id = activeMap.id;
        mutate((a) => ({ ...a, maps: a.maps.map((m) => (m.id === id ? updater(m) : m)) }));
    }

    function fitView(w = imgSize.w, h = imgSize.h) {
        const vp = viewportRef.current;
        if (!vp || !w || !h) return;
        const r = vp.getBoundingClientRect();
        const pad = 24;
        const zoom = Math.max(
            MIN_ZOOM,
            Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h)
        );
        setView({ zoom, x: (r.width - w * zoom) / 2, y: (r.height - h * zoom) / 2 });
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

    function screenToNorm(clientX: number, clientY: number) {
        const rect = viewportRef.current!.getBoundingClientRect();
        const ix = (clientX - rect.left - view.x) / view.zoom;
        const iy = (clientY - rect.top - view.y) / view.zoom;
        return { x: clamp01(ix / imgSize.w), y: clamp01(iy / imgSize.h) };
    }

    function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
        const img = e.currentTarget;
        const w = img.naturalWidth || 0;
        const h = img.naturalHeight || 0;
        setImgSize({ w, h });
        fitView(w, h);
    }

    // --- maps ---

    async function addMap() {
        try {
            const filename = await ImportMapImage(project.path);
            if (!filename) return; // cancelled
            const id = newId();
            const name = `Map ${atlasRef.current.maps.length + 1}`;
            mutate((a) => ({
                ...a,
                maps: [...a.maps, { id, name, mapImage: filename, pins: [], regions: [] }],
            }));
            setActiveId(id);
        } catch (err) {
            setError(String(err));
        }
    }

    function deleteMap(id: string) {
        const remaining = atlasRef.current.maps.filter((m) => m.id !== id);
        mutate((a) => ({ ...a, maps: remaining }));
        if (id === activeMap?.id) setActiveId(remaining[0]?.id ?? null);
    }

    function toggleHidden(id: string) {
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    }

    // --- pointer / click ---

    function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
        if (tool !== "pan") return;
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

    function onViewportClick(e: React.MouseEvent<HTMLDivElement>) {
        if (draggedRef.current) {
            draggedRef.current = false;
            return;
        }
        if (!imgSize.w) return;
        const n = screenToNorm(e.clientX, e.clientY);
        if (tool === "pin") {
            const id = newId();
            mutateMap((m) => ({
                ...m,
                pins: [...m.pins, { id, x: n.x, y: n.y, type: "city" as PinType, label: "", entryId: "" }],
            }));
            setSelected({ kind: "pin", id });
        } else if (tool === "region") {
            setDraft((d) => [...d, n]);
        } else {
            setSelected(null);
        }
    }

    function finishRegion() {
        if (draft.length < 3) return;
        const id = newId();
        const points = draft.map((p) => ({ x: p.x, y: p.y }));
        mutateMap((m) => ({
            ...m,
            regions: [...m.regions, { id, points, label: "", color: ATLAS_COLORS[0], entryId: "" }],
        }));
        setDraft([]);
        setSelected({ kind: "region", id });
        setTool("pan");
    }

    function updatePin(id: string, patch: Partial<AtlasMap["pins"][number]>) {
        mutateMap((m) => ({ ...m, pins: m.pins.map((p) => (p.id === id ? { ...p, ...patch } : p)) }));
    }
    function updateRegion(id: string, patch: Partial<AtlasMap["regions"][number]>) {
        mutateMap((m) => ({
            ...m,
            regions: m.regions.map((r) => (r.id === id ? { ...r, ...patch } : r)),
        }));
    }
    function deletePin(id: string) {
        mutateMap((m) => ({ ...m, pins: m.pins.filter((p) => p.id !== id) }));
        setSelected(null);
    }
    function deleteRegion(id: string) {
        mutateMap((m) => ({ ...m, regions: m.regions.filter((r) => r.id !== id) }));
        setSelected(null);
    }

    if (error && !loaded) {
        return (
            <div className="view">
                <p className="subtitle">{error}</p>
            </div>
        );
    }
    if (!loaded) return <div className="atlas" />;

    if (!activeMap) {
        return (
            <div className="atlas">
                <div className="atlas-empty">
                    <p className="subtitle">
                        Add a map — a drawing or an image — then zoom in to pin cities and
                        landmarks, and trace dotted outlines around countries.
                    </p>
                    <button className="primary" onClick={addMap}>
                        Add map
                    </button>
                </div>
            </div>
        );
    }

    const markersInteractive = tool !== "region";
    const selPin =
        selected?.kind === "pin" ? activeMap.pins.find((p) => p.id === selected.id) : undefined;
    const selRegion =
        selected?.kind === "region"
            ? activeMap.regions.find((r) => r.id === selected.id)
            : undefined;

    const pinVisible = (p: AtlasMap["pins"][number]) => showPins && !hidden.has(p.id);
    const regionVisible = (r: AtlasMap["regions"][number]) => showRegions && !hidden.has(r.id);
    const multipleMaps = atlas.maps.length > 1;

    // Filter-panel rows, narrowed by the search box.
    const q = filterSearch.trim().toLowerCase();
    const pinRows = activeMap.pins.filter(
        (p) => !q || p.label.toLowerCase().includes(q) || p.type.includes(q)
    );
    const regionRows = activeMap.regions.filter(
        (r) => !q || r.label.toLowerCase().includes(q)
    );
    const pinRowName = (p: AtlasMap["pins"][number]) => p.label.trim() || `(unlabeled ${p.type})`;
    const regionRowName = (r: AtlasMap["regions"][number]) => r.label.trim() || "(unlabeled territory)";

    const entryOptions = (current: string) => (
        <>
            <option value="">(link an entry)</option>
            {entries.map((en) => (
                <option key={en.filename} value={en.filename}>
                    {en.title.trim() || en.filename.replace(/\.json$/, "")}
                </option>
            ))}
            {current && !entries.some((en) => en.filename === current) && (
                <option value={current}>(missing entry)</option>
            )}
        </>
    );

    const stop = (e: React.SyntheticEvent) => e.stopPropagation();

    return (
        <div className="atlas">
            {multipleMaps && mapListOpen && (
                <div className="chapter-list atlas-maplist">
                    <div className="list-top">
                        <span className="list-heading">Maps</span>
                        <button
                            className="collapse-btn"
                            title="Hide maps"
                            onClick={() => setMapListOpen(false)}
                        >
                            «
                        </button>
                    </div>
                    {atlas.maps.map((m) => (
                        <div className="doc-row" key={m.id}>
                            <button
                                className={`doc-select ${activeMap.id === m.id ? "active" : ""}`}
                                onClick={() => setActiveId(m.id)}
                            >
                                <span className="chapter-title">
                                    {m.name.trim() || "Untitled map"}
                                </span>
                            </button>
                            <button
                                className="doc-trash"
                                title="Delete map"
                                onClick={() => deleteMap(m.id)}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    <button className="new-chapter" onClick={addMap}>
                        + New Map
                    </button>
                </div>
            )}

            <div className="atlas-main">
                <div className="atlas-toolbar">
                    {multipleMaps && !mapListOpen && (
                        <button
                            className="atlas-tool"
                            title="Show maps"
                            onClick={() => setMapListOpen(true)}
                        >
                            ☰
                        </button>
                    )}
                    <input
                        className="atlas-mapname field-input"
                        value={activeMap.name}
                        placeholder="Map name"
                        onChange={(e) => mutateMap((m) => ({ ...m, name: e.target.value }))}
                        onKeyDown={blurOnEnter}
                    />
                    {!multipleMaps && (
                        <button className="atlas-tool" title="Add another map" onClick={addMap}>
                            + Map
                        </button>
                    )}
                    <span className="atlas-sep" />
                    <button
                        className={`atlas-tool ${tool === "pan" ? "active" : ""}`}
                        title="Move around & select"
                        onClick={() => {
                            setTool("pan");
                            setDraft([]);
                        }}
                    >
                        Move
                    </button>
                    <button
                        className={`atlas-tool ${tool === "pin" ? "active" : ""}`}
                        title="Click the map to drop location pins"
                        onClick={() => {
                            setTool("pin");
                            setDraft([]);
                            setSelected(null);
                        }}
                    >
                        Pin
                    </button>
                    <button
                        className={`atlas-tool ${tool === "region" ? "active" : ""}`}
                        title="Click around a border to outline a territory"
                        onClick={() => {
                            setTool("region");
                            setSelected(null);
                        }}
                    >
                        Territory
                    </button>
                    <span className="atlas-sep" />
                    <button className="atlas-tool" title="Zoom in" onClick={() => zoomBy(1.2)}>
                        +
                    </button>
                    <button className="atlas-tool" title="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
                        −
                    </button>
                    <button className="atlas-tool" title="Fit to view" onClick={() => fitView()}>
                        Fit
                    </button>
                    <span className="atlas-sep" />
                    <button
                        className={`atlas-tool ${filterOpen ? "active" : ""}`}
                        title="Show or hide markers"
                        onClick={() => setFilterOpen((v) => !v)}
                    >
                        Filter
                    </button>
                    <span className={`atlas-save save-status ${saveState}`}>
                        {saveState === "unsaved" && "Saving…"}
                        {saveState === "saved" && "Saved"}
                        {saveState === "error" && "Save failed"}
                    </span>
                </div>

                {filterOpen && (
                    <div className="atlas-filter" onClick={stop} onPointerDown={stop}>
                        <input
                            className="field-input"
                            value={filterSearch}
                            placeholder="Search markers…"
                            onChange={(e) => setFilterSearch(e.target.value)}
                        />
                        <div className="atlas-filter-group">
                            <label className="atlas-filter-head">
                                <input
                                    type="checkbox"
                                    checked={showPins}
                                    onChange={() => setShowPins((v) => !v)}
                                />
                                Pins ({activeMap.pins.length})
                            </label>
                            {pinRows.map((p) => (
                                <label className="atlas-filter-row" key={p.id}>
                                    <input
                                        type="checkbox"
                                        checked={showPins && !hidden.has(p.id)}
                                        disabled={!showPins}
                                        onChange={() => toggleHidden(p.id)}
                                    />
                                    <span className="atlas-pin-glyph">{PIN_GLYPH[p.type]}</span>
                                    {pinRowName(p)}
                                </label>
                            ))}
                        </div>
                        <div className="atlas-filter-group">
                            <label className="atlas-filter-head">
                                <input
                                    type="checkbox"
                                    checked={showRegions}
                                    onChange={() => setShowRegions((v) => !v)}
                                />
                                Territories ({activeMap.regions.length})
                            </label>
                            {regionRows.map((r) => (
                                <label className="atlas-filter-row" key={r.id}>
                                    <input
                                        type="checkbox"
                                        checked={showRegions && !hidden.has(r.id)}
                                        disabled={!showRegions}
                                        onChange={() => toggleHidden(r.id)}
                                    />
                                    <span
                                        className="atlas-filter-swatch"
                                        style={{ background: r.color }}
                                    />
                                    {regionRowName(r)}
                                </label>
                            ))}
                        </div>
                    </div>
                )}

                <div
                    className="atlas-viewport"
                    ref={viewportRef}
                    data-tool={tool}
                    onPointerDown={onPointerDown}
                    onPointerMove={onPointerMove}
                    onPointerUp={onPointerUp}
                    onClick={onViewportClick}
                >
                {imageUrl ? (
                    <div
                        className="atlas-canvas"
                        style={{
                            width: imgSize.w || undefined,
                            height: imgSize.h || undefined,
                            transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
                            transformOrigin: "0 0",
                        }}
                    >
                        <img
                            className="atlas-image"
                            src={imageUrl}
                            onLoad={onImageLoad}
                            draggable={false}
                            style={{
                                width: imgSize.w || undefined,
                                height: imgSize.h || undefined,
                            }}
                        />
                        {imgSize.w > 0 && (
                            <svg
                                className="atlas-overlay"
                                viewBox="0 0 1 1"
                                preserveAspectRatio="none"
                                style={{ width: imgSize.w, height: imgSize.h }}
                            >
                                {activeMap.regions.filter(regionVisible).map((r) => (
                                        <polygon
                                            key={r.id}
                                            points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                                            fill={r.color}
                                            fillOpacity={selRegion?.id === r.id ? 0.3 : 0.14}
                                            stroke={r.color}
                                            strokeWidth={selRegion?.id === r.id ? 3 : 2}
                                            strokeDasharray="6 4"
                                            strokeLinejoin="round"
                                            vectorEffect="non-scaling-stroke"
                                            style={{
                                                // Territory bodies are only clickable in Move; in
                                                // Pin mode a click on a territory drops a pin.
                                                pointerEvents: tool === "pan" ? "auto" : "none",
                                                cursor: "pointer",
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelected({ kind: "region", id: r.id });
                                            }}
                                        />
                                    ))}
                                {draft.length > 0 && (
                                    <polyline
                                        points={draft.map((p) => `${p.x},${p.y}`).join(" ")}
                                        fill="none"
                                        stroke="var(--accent)"
                                        strokeWidth={2}
                                        strokeDasharray="5 4"
                                        vectorEffect="non-scaling-stroke"
                                        style={{ pointerEvents: "none" }}
                                    />
                                )}
                            </svg>
                        )}

                        {/* Territory labels — pin-style dark pill, no glyph */}
                        {activeMap.regions
                                .filter((r) => regionVisible(r) && r.label.trim())
                                .map((r) => {
                                    const c = centroid(r.points);
                                    return (
                                        <div
                                            key={r.id}
                                            className={`atlas-region-label ${
                                                selRegion?.id === r.id ? "selected" : ""
                                            }`}
                                            style={{
                                                left: `${c.x * 100}%`,
                                                top: `${c.y * 100}%`,
                                                transform: `translate(-50%, -50%) scale(${1 / view.zoom})`,
                                                color: r.color,
                                                pointerEvents: markersInteractive ? "auto" : "none",
                                            }}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setSelected({ kind: "region", id: r.id });
                                            }}
                                        >
                                            {r.label}
                                        </div>
                                    );
                                })}

                        {/* Draft vertices, counter-scaled */}
                        {draft.map((p, i) => (
                            <div
                                key={i}
                                className="atlas-draft-dot"
                                style={{
                                    left: `${p.x * 100}%`,
                                    top: `${p.y * 100}%`,
                                    transform: `translate(-50%, -50%) scale(${1 / view.zoom})`,
                                }}
                            />
                        ))}

                        {/* Pins */}
                        {activeMap.pins.filter(pinVisible).map((p) => (
                                <div
                                    key={p.id}
                                    className="atlas-pin-anchor"
                                    style={{
                                        left: `${p.x * 100}%`,
                                        top: `${p.y * 100}%`,
                                        pointerEvents: markersInteractive ? "auto" : "none",
                                    }}
                                >
                                    <button
                                        className={`atlas-pin ${
                                            selPin?.id === p.id ? "selected" : ""
                                        }`}
                                        style={{
                                            transform: `translate(-50%, -100%) scale(${1 / view.zoom})`,
                                        }}
                                        title={p.label || p.type}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setSelected({ kind: "pin", id: p.id });
                                        }}
                                    >
                                        <span className="atlas-pin-glyph">{PIN_GLYPH[p.type]}</span>
                                        {p.label && (
                                            <span className="atlas-pin-label">{p.label}</span>
                                        )}
                                    </button>
                                </div>
                            ))}
                    </div>
                ) : (
                    <div className="atlas-loading">Loading map…</div>
                )}

                {tool === "region" && (
                    <div className="atlas-draft-bar" onClick={stop} onPointerDown={stop}>
                        <span>
                            {draft.length} point{draft.length === 1 ? "" : "s"} — click the map to
                            trace a border{draft.length >= 3 ? ", then Finish" : ""}
                        </span>
                        <button disabled={draft.length < 3} onClick={finishRegion}>
                            Finish
                        </button>
                        <button disabled={draft.length === 0} onClick={() => setDraft([])}>
                            Clear
                        </button>
                    </div>
                )}

                {selPin && (
                    <div className="atlas-edit" onClick={stop} onPointerDown={stop}>
                        <div className="atlas-edit-title">Pin</div>
                        <input
                            className="field-input"
                            value={selPin.label}
                            placeholder="Label"
                            onChange={(e) => updatePin(selPin.id, { label: e.target.value })}
                            onKeyDown={blurOnEnter}
                            spellCheck
                        />
                        <select
                            className="field-input"
                            value={selPin.type}
                            onChange={(e) => updatePin(selPin.id, { type: e.target.value as PinType })}
                        >
                            {PIN_TYPES.map((t) => (
                                <option key={t} value={t}>
                                    {PIN_GLYPH[t]} {t[0].toUpperCase() + t.slice(1)}
                                </option>
                            ))}
                        </select>
                        <select
                            className="field-input"
                            value={selPin.entryId}
                            onChange={(e) => updatePin(selPin.id, { entryId: e.target.value })}
                        >
                            {entryOptions(selPin.entryId)}
                        </select>
                        <div className="atlas-edit-actions">
                            {selPin.entryId && (
                                <button onClick={() => onOpenEntry(selPin.entryId)}>
                                    Open entry →
                                </button>
                            )}
                            <button className="atlas-edit-del" onClick={() => deletePin(selPin.id)}>
                                Delete
                            </button>
                            <button onClick={() => setSelected(null)}>Done</button>
                        </div>
                    </div>
                )}

                {selRegion && (
                    <div className="atlas-edit" onClick={stop} onPointerDown={stop}>
                        <div className="atlas-edit-title">Territory</div>
                        <input
                            className="field-input"
                            value={selRegion.label}
                            placeholder="Label"
                            onChange={(e) => updateRegion(selRegion.id, { label: e.target.value })}
                            onKeyDown={blurOnEnter}
                            spellCheck
                        />
                        <div className="atlas-swatches">
                            {ATLAS_COLORS.map((c) => (
                                <button
                                    key={c}
                                    className={`atlas-swatch ${
                                        selRegion.color === c ? "active" : ""
                                    }`}
                                    style={{ background: c }}
                                    title="Outline color"
                                    onClick={() => updateRegion(selRegion.id, { color: c })}
                                />
                            ))}
                        </div>
                        <select
                            className="field-input"
                            value={selRegion.entryId}
                            onChange={(e) => updateRegion(selRegion.id, { entryId: e.target.value })}
                        >
                            {entryOptions(selRegion.entryId)}
                        </select>
                        <div className="atlas-edit-actions">
                            {selRegion.entryId && (
                                <button onClick={() => onOpenEntry(selRegion.entryId)}>
                                    Open entry →
                                </button>
                            )}
                            <button
                                className="atlas-edit-del"
                                onClick={() => deleteRegion(selRegion.id)}
                            >
                                Delete
                            </button>
                            <button onClick={() => setSelected(null)}>Done</button>
                        </div>
                    </div>
                )}
                </div>
            </div>
        </div>
    );
}
