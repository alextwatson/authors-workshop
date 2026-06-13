export type Section =
    | "manuscript"
    | "outline"
    | "arc"
    | "characters"
    | "worldbuilding"
    | "settings"
    | "trash";

const NAV_ITEMS: { key: Section; label: string }[] = [
    { key: "manuscript", label: "Manuscript" },
    { key: "outline", label: "Outline" },
    { key: "arc", label: "Emotional Arc" },
    { key: "characters", label: "Characters" },
    { key: "worldbuilding", label: "World Building" },
];

interface Props {
    projectName: string;
    active: Section;
    onNavigate: (section: Section) => void;
    onCloseProject: () => void;
    onCollapse: () => void;
}

export default function Sidebar({
    projectName,
    active,
    onNavigate,
    onCloseProject,
    onCollapse,
}: Props) {
    return (
        <aside className="sidebar">
            <div className="sidebar-header">
                <div className="project-name" title={projectName}>
                    {projectName}
                </div>
                <button className="collapse-btn" title="Hide menu" onClick={onCollapse}>
                    «
                </button>
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
