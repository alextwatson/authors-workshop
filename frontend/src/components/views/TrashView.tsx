import { useEffect, useState } from "react";
import { EmptyTrash, ListTrash, RestoreTrashItem } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

export default function TrashView() {
    const [items, setItems] = useState<main.TrashItem[]>([]);
    const [confirming, setConfirming] = useState(false);
    const [error, setError] = useState("");

    function load() {
        ListTrash().then(setItems).catch((err) => setError(String(err)));
    }

    useEffect(load, []);

    async function restore(id: string) {
        setError("");
        try {
            await RestoreTrashItem(id);
            load();
        } catch (err) {
            setError(String(err));
        }
    }

    async function empty() {
        setError("");
        try {
            await EmptyTrash();
            setConfirming(false);
            load();
        } catch (err) {
            setError(String(err));
        }
    }

    return (
        <>
            <h2>Trash</h2>
            <p className="subtitle">
                Deleted scenes, chapters, characters, and world-building entries stay here,
                recoverable until you empty the trash or quit the app.
            </p>
            {error && <p className="subtitle save-status error">{error}</p>}
            {items.length === 0 ? (
                <div className="placeholder">The trash is empty.</div>
            ) : (
                <>
                    <ul className="file-list">
                        {items.map((item) => (
                            <li key={item.id}>
                                <span>
                                    <span className="doc-glyph">
                                        {item.kind === "scene"
                                            ? "◇ "
                                            : item.kind === "character"
                                            ? "☻ "
                                            : item.kind === "codex"
                                            ? "❡ "
                                            : "§ "}
                                    </span>
                                    {item.title}
                                </span>
                                <span className="trash-row-end">
                                    <span className="meta">
                                        {item.kind} · {item.filename}
                                    </span>
                                    <button onClick={() => restore(item.id)}>Restore</button>
                                </span>
                            </li>
                        ))}
                    </ul>
                    {confirming ? (
                        <div className="trash-confirm">
                            <span>
                                Permanently delete {items.length} item
                                {items.length === 1 ? "" : "s"}?
                            </span>
                            <button className="primary" onClick={empty}>
                                Empty Trash
                            </button>
                            <button onClick={() => setConfirming(false)}>Cancel</button>
                        </div>
                    ) : (
                        <button onClick={() => setConfirming(true)}>Empty Trash…</button>
                    )}
                </>
            )}
        </>
    );
}
