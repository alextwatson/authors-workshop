import { useEffect, useRef, useState } from "react";
import {
    ExportManuscript,
    SaveProjectMeta,
    SetManuscriptFormat,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import { blurOnEnter } from "../../ui";
import { resolveFocusSettings } from "../../focus";
import VersionControlSettings from "./VersionControlSettings";

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

    // Manuscript-format conversion and export status (run on demand, not autosaved).
    const [formatBusy, setFormatBusy] = useState(false);
    const [formatError, setFormatError] = useState("");
    const [exportMsg, setExportMsg] = useState("");

    const format = meta.manuscriptFormat || "md";

    async function changeFormat(next: string) {
        if (next === format || formatBusy) return;
        const ok = window.confirm(
            next === "txt"
                ? "Convert the whole manuscript to plain text (.txt)? Every chapter and scene file is renamed and its “# ” title marker removed."
                : "Convert the whole manuscript to Markdown (.md)? Every chapter and scene file is renamed and its title written as a “# ” heading."
        );
        if (!ok) return;
        setFormatBusy(true);
        setFormatError("");
        try {
            const saved = await SetManuscriptFormat(project.path, next);
            setMeta(saved);
            onMetaSaved(saved);
        } catch (err) {
            setFormatError(String(err));
        } finally {
            setFormatBusy(false);
        }
    }

    async function exportAs(fmt: string) {
        setExportMsg("Exporting…");
        try {
            const path = await ExportManuscript(project.path, fmt);
            setExportMsg(path ? `Exported to ${path}` : "");
        } catch (err) {
            setExportMsg(`Export failed: ${err}`);
        }
    }

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

            <h3 className="settings-section">Manuscript format</h3>
            <p className="subtitle">
                How chapter and scene files are stored on disk. Switching converts every
                existing file.
            </p>
            <div className="settings-form">
                <label className="settings-check">
                    <input
                        type="radio"
                        name="manuscript-format"
                        checked={format === "md"}
                        disabled={formatBusy}
                        onChange={() => changeFormat("md")}
                    />
                    Markdown (.md) — title as a “# ” heading
                </label>
                <label className="settings-check">
                    <input
                        type="radio"
                        name="manuscript-format"
                        checked={format === "txt"}
                        disabled={formatBusy}
                        onChange={() => changeFormat("txt")}
                    />
                    Plain text (.txt) — title on the first line
                </label>
                {formatBusy && <div className="save-status saving">Converting…</div>}
                {formatError && <div className="save-status error">{formatError}</div>}
            </div>

            <h3 className="settings-section">Export manuscript</h3>
            <p className="subtitle">
                Stitch every chapter, in order, into a single file — independent of how it’s
                stored.
            </p>
            <div className="settings-form">
                <div className="export-buttons">
                    <button type="button" onClick={() => exportAs("md")}>
                        Export as Markdown (.md)
                    </button>
                    <button type="button" onClick={() => exportAs("txt")}>
                        Export as Plain text (.txt)
                    </button>
                </div>
                {exportMsg && <div className="save-status">{exportMsg}</div>}
            </div>

            <VersionControlSettings projectPath={project.path} />
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
