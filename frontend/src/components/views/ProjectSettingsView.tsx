import { useEffect, useRef, useState } from "react";
import { SaveProjectMeta } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

interface Props {
    project: main.Project;
    onMetaSaved: (meta: main.ProjectMeta) => void;
}

type SaveState = "idle" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 800;

export default function ProjectSettingsView({ project, onMetaSaved }: Props) {
    const [meta, setMeta] = useState<main.ProjectMeta>(project.meta);
    const [saveState, setSaveState] = useState<SaveState>("idle");
    const [saveError, setSaveError] = useState("");
    const dirty = useRef(false);

    function update(patch: Partial<main.ProjectMeta>) {
        dirty.current = true;
        setMeta(main.ProjectMeta.createFrom({ ...meta, ...patch }));
    }

    useEffect(() => {
        if (!dirty.current) return;
        setSaveState("saving");
        const timer = setTimeout(async () => {
            try {
                const saved = await SaveProjectMeta(project.path, meta);
                dirty.current = false;
                setSaveState("saved");
                onMetaSaved(saved);
            } catch (err) {
                setSaveState("error");
                setSaveError(String(err));
            }
        }, AUTOSAVE_DELAY_MS);
        return () => clearTimeout(timer);
    }, [meta]);

    return (
        <>
            <h2>Project Settings</h2>
            <p className="subtitle">Stored in project.json — changes save automatically.</p>
            <div className="settings-form">
                <label>
                    Title
                    <input
                        value={meta.name}
                        onChange={(e) => update({ name: e.target.value })}
                    />
                </label>
                <label>
                    Author
                    <input
                        value={meta.author}
                        onChange={(e) => update({ author: e.target.value })}
                    />
                </label>
                <label>
                    Description
                    <textarea
                        value={meta.description}
                        onChange={(e) => update({ description: e.target.value })}
                    />
                </label>
                <label>
                    Word count goal
                    <input
                        type="number"
                        min={0}
                        value={meta.wordCountGoal}
                        onChange={(e) => update({ wordCountGoal: Number(e.target.value) || 0 })}
                    />
                </label>
                <label>
                    Daily word goal
                    <input
                        type="number"
                        min={0}
                        value={meta.dailyWordGoal}
                        onChange={(e) => update({ dailyWordGoal: Number(e.target.value) || 0 })}
                    />
                </label>
                <div className={`save-status ${saveState}`}>
                    {saveState === "saving" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${saveError}`}
                </div>
            </div>
        </>
    );
}
