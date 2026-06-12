import { useEffect, useState } from "react";
import { ListChapters } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

interface Props {
    project: main.Project;
}

export default function ManuscriptView({ project }: Props) {
    const [chapters, setChapters] = useState<main.ChapterInfo[]>([]);
    const [error, setError] = useState("");

    useEffect(() => {
        ListChapters(project.path).then(setChapters).catch((err) => setError(String(err)));
    }, [project.path]);

    const totalWords = chapters.reduce((sum, c) => sum + c.wordCount, 0);

    return (
        <>
            <h2>Manuscript</h2>
            <p className="subtitle">
                {chapters.length} chapter{chapters.length === 1 ? "" : "s"} ·{" "}
                {totalWords.toLocaleString()} words
                {project.meta.wordCountGoal > 0 &&
                    ` of ${project.meta.wordCountGoal.toLocaleString()} goal`}
            </p>
            {error && <p className="placeholder">{error}</p>}
            {!error && chapters.length === 0 && (
                <div className="placeholder">No chapters yet.</div>
            )}
            {chapters.length > 0 && (
                <ul className="file-list">
                    {chapters.map((c) => (
                        <li key={c.filename}>
                            <span>{c.title}</span>
                            <span className="meta">
                                {c.filename} · {c.wordCount.toLocaleString()} words
                            </span>
                        </li>
                    ))}
                </ul>
            )}
            <p className="subtitle" style={{ marginTop: 32 }}>
                The writing editor will live here.
            </p>
        </>
    );
}
