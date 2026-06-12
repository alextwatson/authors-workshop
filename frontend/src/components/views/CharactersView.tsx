import { useEffect, useState } from "react";
import { ListCharacters } from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";

interface Props {
    project: main.Project;
}

export default function CharactersView({ project }: Props) {
    const [characters, setCharacters] = useState<string[]>([]);
    const [error, setError] = useState("");

    useEffect(() => {
        ListCharacters(project.path).then(setCharacters).catch((err) => setError(String(err)));
    }, [project.path]);

    return (
        <>
            <h2>Characters</h2>
            <p className="subtitle">The people of your story.</p>
            {error && <p className="placeholder">{error}</p>}
            {!error && characters.length === 0 && (
                <div className="placeholder">
                    No characters yet. Character sheets will live here, one JSON file each.
                </div>
            )}
            {characters.length > 0 && (
                <ul className="file-list">
                    {characters.map((name) => (
                        <li key={name}>
                            <span>{name.replace(/\.json$/, "")}</span>
                            <span className="meta">{name}</span>
                        </li>
                    ))}
                </ul>
            )}
        </>
    );
}
