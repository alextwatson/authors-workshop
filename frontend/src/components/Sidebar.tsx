export type Section =
    | "manuscript"
    | "outline"
    | "characters"
    | "worldbuilding"
    | "settings"
    | "trash";

const NAV_ITEMS: { key: Section; label: string }[] = [
    { key: "manuscript", label: "Manuscript" },
    { key: "outline", label: "Outline" },
    { key: "characters", label: "Characters" },
    { key: "worldbuilding", label: "World Building" },
];

interface Props {
    projectName: string;
    active: Section;
    onNavigate: (section: Section) => void;
    onCloseProject: () => void;
}

export default function Sidebar({ projectName, active, onNavigate, onCloseProject }: Props) {
    return (
        <aside className="sidebar">
            <div className="project-name" title={projectName}>
                {projectName}
            </div>
            <nav>
                {NAV_ITEMS.map((item) => (
                    <button
                        key={item.key}
                        className={active === item.key ? "active" : ""}
                        onClick={() => onNavigate(item.key)}
                    >
                        {item.label}
                    </button>
                ))}
            </nav>
            <div className="footer">
                <button
                    className={active === "trash" ? "active" : ""}
                    onClick={() => onNavigate("trash")}
                >
                    Trash
                </button>
                <button
                    className={active === "settings" ? "active" : ""}
                    onClick={() => onNavigate("settings")}
                >
                    Project Settings
                </button>
                <button onClick={onCloseProject}>Close Project</button>
            </div>
        </aside>
    );
}
