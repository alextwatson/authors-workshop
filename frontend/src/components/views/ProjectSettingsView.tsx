import { useEffect, useRef, useState } from "react";
import { SaveProjectMeta } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import { blurOnEnter } from "../../ui";
import { resolveFocusSettings } from "../../focus";

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
    // Which focus setting's "apply always" popover is open (by base key).
    const [openInfo, setOpenInfo] = useState<string | null>(null);
    const dirty = useRef(false);

    function update(patch: Partial<main.ProjectMeta>) {
        dirty.current = true;
        setMeta(main.ProjectMeta.createFrom({ ...meta, ...patch }));
    }

    const focus = resolveFocusSettings(meta.focus);
    function updateFocus(patch: Partial<main.FocusSettings>) {
        update({ focus: main.FocusSettings.createFrom({ ...focus, ...patch }) });
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
                        onKeyDown={blurOnEnter}
                    />
                </label>
                <label>
                    Author
                    <input
                        value={meta.author}
                        onChange={(e) => update({ author: e.target.value })}
                        onKeyDown={blurOnEnter}
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
                        onKeyDown={blurOnEnter}
                    />
                </label>
                <label>
                    Daily word goal
                    <input
                        type="number"
                        min={0}
                        value={meta.dailyWordGoal}
                        onChange={(e) => update({ dailyWordGoal: Number(e.target.value) || 0 })}
                        onKeyDown={blurOnEnter}
                    />
                </label>
                <div className={`save-status ${saveState}`}>
                    {saveState === "saving" && "Saving…"}
                    {saveState === "saved" && "Saved"}
                    {saveState === "error" && `Could not save: ${saveError}`}
                </div>
            </div>

            <h3 className="settings-section">Focus mode</h3>
            <p className="subtitle">
                What focus mode does. Use the ⓘ on any setting to keep it on all the time,
                even when you're not in focus mode.
            </p>
            <div className="settings-form">
                {FOCUS_ROWS.map((row) => (
                    <div className="focus-row" key={row.base}>
                        <label className="settings-check">
                            <input
                                type="checkbox"
                                checked={Boolean(focus[row.base])}
                                onChange={(e) =>
                                    updateFocus({ [row.base]: e.target.checked } as Partial<main.FocusSettings>)
                                }
                            />
                            {row.label}
                        </label>
                        <button
                            type="button"
                            className="info-btn"
                            title="When should this apply?"
                            onClick={() => setOpenInfo(openInfo === row.base ? null : row.base)}
                        >
                            i
                        </button>
                        {openInfo === row.base && (
                            <div className="info-pop">
                                <label className="settings-check">
                                    <input
                                        type="checkbox"
                                        checked={Boolean(focus[row.always])}
                                        onChange={(e) =>
                                            updateFocus({
                                                [row.always]: e.target.checked,
                                            } as Partial<main.FocusSettings>)
                                        }
                                    />
                                    Apply this all the time, even when not in focus mode
                                </label>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </>
    );
}

type FocusRow = {
    base: keyof main.FocusSettings;
    always: keyof main.FocusSettings;
    label: string;
};

const FOCUS_ROWS: FocusRow[] = [
    {
        base: "dimSentences",
        always: "dimSentencesAlways",
        label: "Dim other sentences (fade everything but the one you're writing)",
    },
    {
        base: "typewriter",
        always: "typewriterAlways",
        label: "Typewriter scrolling (keep the current line centered)",
    },
    {
        base: "dimTitle",
        always: "dimTitleAlways",
        label: "Dim the chapter title while writing the body",
    },
    {
        base: "hideWordCount",
        always: "hideWordCountAlways",
        label: "Hide the word-count bar",
    },
];
