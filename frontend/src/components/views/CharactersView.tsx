import { useEffect, useState } from "react";
import {
    DeleteCharacter,
    ListChapters,
    ListCharacters,
    ListScenes,
    ReadCharacter,
    ReadOutline,
    WriteCharacter,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import { emptyCharacter, parseCharacter, serializeCharacter } from "../../characters";
import { nextNumberedJson } from "../../docnames";
import { parseOutline } from "../../outline";
import { Section } from "../Sidebar";
import CharacterEditor, { OutlineMoment } from "../CharacterEditor";

interface Props {
    project: main.Project;
    onNavigate: (section: Section, focusId?: string | null) => void;
}

type CharRef = { filename: string; name: string };

function displayName(name: string, filename: string): string {
    return name.trim() || filename.replace(/\.json$/, "");
}

export default function CharactersView({ project, onNavigate }: Props) {
    const [chars, setChars] = useState<CharRef[]>([]);
    const [moments, setMoments] = useState<OutlineMoment[]>([]);
    const [active, setActive] = useState<string | null>(null);
    const [listOpen, setListOpen] = useState(true);
    const [error, setError] = useState("");

    // Load the outline's objects so arc beats can connect to them. Doc nodes
    // borrow their title from the manuscript file lists.
    useEffect(() => {
        Promise.all([
            ReadOutline(project.path),
            ListScenes(project.path),
            ListChapters(project.path),
        ])
            .then(([json, sceneList, chapterList]) => {
                const titles: Record<string, string> = {};
                for (const d of [...sceneList, ...chapterList]) titles[d.filename] = d.title;
                const list = parseOutline(json).map((n) => {
                    const glyph = n.kind === "scene" ? "◇" : n.kind === "chapter" ? "§" : "•";
                    const label =
                        n.kind === "point"
                            ? n.title || "Story point"
                            : titles[n.file] || n.title || n.file;
                    return { id: n.id, label: `${glyph} ${label}` };
                });
                setMoments(list);
            })
            .catch(() => setMoments([]));
    }, [project.path]);

    useEffect(() => {
        ListCharacters(project.path)
            .then(async (names) => {
                const refs = await Promise.all(
                    names.map(async (filename) => {
                        const content = await ReadCharacter(project.path, filename).catch(() => "");
                        return { filename, name: parseCharacter(content).name };
                    })
                );
                setChars(refs);
                if (refs.length > 0) setActive(refs[0].filename);
            })
            .catch((err) => setError(String(err)));
    }, [project.path]);

    async function newCharacter() {
        setError("");
        const { filename } = nextNumberedJson(
            chars.map((c) => c.filename),
            "character"
        );
        try {
            await WriteCharacter(project.path, filename, serializeCharacter(emptyCharacter()));
            setChars((cs) => [...cs, { filename, name: "" }]);
            setActive(filename);
        } catch (err) {
            setError(String(err));
        }
    }

    async function deleteCharacter(filename: string) {
        setError("");
        try {
            await DeleteCharacter(project.path, filename);
            const next = chars.filter((c) => c.filename !== filename);
            setChars(next);
            if (active === filename) {
                setActive(next.length > 0 ? next[0].filename : null);
            }
        } catch (err) {
            setError(String(err));
        }
    }

    function onSaved(filename: string, name: string) {
        setChars((cs) => cs.map((c) => (c.filename === filename ? { ...c, name } : c)));
    }

    return (
        <div className="manuscript">
            {listOpen && (
                <div className="chapter-list">
                    <div className="list-top">
                        <span className="list-heading">Characters</span>
                        <button
                            className="collapse-btn"
                            title="Hide characters"
                            onClick={() => setListOpen(false)}
                        >
                            «
                        </button>
                    </div>
                    {chars.map((c) => (
                        <div className="doc-row" key={c.filename}>
                            <button
                                className={`doc-select ${active === c.filename ? "active" : ""}`}
                                onClick={() => setActive(c.filename)}
                            >
                                <span className="chapter-title">
                                    {displayName(c.name, c.filename)}
                                </span>
                            </button>
                            <button
                                className="doc-trash"
                                title="Move to Trash"
                                onClick={() => deleteCharacter(c.filename)}
                            >
                                ✕
                            </button>
                        </div>
                    ))}
                    <button className="new-chapter" onClick={newCharacter}>
                        + New Character
                    </button>
                </div>
            )}
            <div className="editor-pane">
                {!listOpen && (
                    <button
                        className="list-reopen"
                        title="Show characters"
                        onClick={() => setListOpen(true)}
                    >
                        ☰
                    </button>
                )}
                {active ? (
                    <CharacterEditor
                        key={active}
                        read={() => ReadCharacter(project.path, active)}
                        write={(content) => WriteCharacter(project.path, active, content)}
                        onSaved={(info) => onSaved(active, info.name)}
                        fallbackName={active.replace(/\.json$/, "")}
                        outlineMoments={moments}
                        onJumpToOutline={(id) => onNavigate("outline", id)}
                    />
                ) : (
                    <div className="view">
                        <h2>Characters</h2>
                        <p className="subtitle">
                            {error || "No characters yet — create one to start building your cast."}
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}
