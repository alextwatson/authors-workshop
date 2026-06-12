import { FormEvent, useState } from "react";
import { CreateProject, OpenProject } from "../../wailsjs/go/main/App";
import { main } from "../../wailsjs/go/models";

interface Props {
    onProjectReady: (project: main.Project) => void;
}

export default function StartupScreen({ onProjectReady }: Props) {
    const [naming, setNaming] = useState(false);
    const [name, setName] = useState("");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);

    async function handleOpen() {
        setError("");
        setBusy(true);
        try {
            const project = await OpenProject();
            if (project) onProjectReady(project);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    }

    async function handleCreate(e: FormEvent) {
        e.preventDefault();
        setError("");
        setBusy(true);
        try {
            const project = await CreateProject(name);
            if (project) onProjectReady(project);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    }

    return (
        <div className="startup">
            <h1>Author's Workshop</h1>
            <p className="tagline">Write, outline, and build your story world.</p>
            {naming ? (
                <form onSubmit={handleCreate}>
                    <input
                        autoFocus
                        placeholder="Project name, e.g. My Novel"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        disabled={busy}
                    />
                    <button type="submit" className="primary" disabled={busy || !name.trim()}>
                        Create
                    </button>
                    <button type="button" onClick={() => setNaming(false)} disabled={busy}>
                        Cancel
                    </button>
                </form>
            ) : (
                <div className="actions">
                    <button className="primary" onClick={() => setNaming(true)} disabled={busy}>
                        New Project
                    </button>
                    <button onClick={handleOpen} disabled={busy}>
                        Open Project
                    </button>
                </div>
            )}
            {error && <p className="error">{error}</p>}
        </div>
    );
}
