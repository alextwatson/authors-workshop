import { useState } from "react";
import { main } from "../wailsjs/go/models";
import StartupScreen from "./components/StartupScreen";
import Sidebar, { Section } from "./components/Sidebar";
import ManuscriptView from "./components/views/ManuscriptView";
import OutlineView from "./components/views/OutlineView";
import CharactersView from "./components/views/CharactersView";
import WorldBuildingView from "./components/views/WorldBuildingView";
import ProjectSettingsView from "./components/views/ProjectSettingsView";
import TrashView from "./components/views/TrashView";

export default function App() {
    const [project, setProject] = useState<main.Project | null>(null);
    const [section, setSection] = useState<Section>("manuscript");
    // An optional outline-object id to focus when arriving in a section, used
    // for the bidirectional Outline <-> Emotional Arc hyperlinks.
    const [focusId, setFocusId] = useState<string | null>(null);
    const [sidebarOpen, setSidebarOpen] = useState(true);

    function navigate(to: Section, focus: string | null = null) {
        setSection(to);
        setFocusId(focus);
    }

    if (!project) {
        return <StartupScreen onProjectReady={(p) => {
            setProject(p);
            navigate("manuscript");
        }} />;
    }

    return (
        <div className="workspace">
            {sidebarOpen ? (
                <Sidebar
                    projectName={project.meta.name}
                    active={section}
                    onNavigate={(s) => navigate(s)}
                    onCloseProject={() => setProject(null)}
                    onCollapse={() => setSidebarOpen(false)}
                />
            ) : (
                <div className="sidebar-rail">
                    <button
                        className="sidebar-reopen"
                        title="Show menu"
                        onClick={() => setSidebarOpen(true)}
                    >
                        ☰
                    </button>
                </div>
            )}
            <main className="main">
                {section === "manuscript" ? (
                    <ManuscriptView project={project} chromeVisible={sidebarOpen} />
                ) : section === "outline" ? (
                    <OutlineView project={project} focusId={focusId} />
                ) : section === "characters" ? (
                    <CharactersView project={project} onNavigate={navigate} />
                ) : section === "worldbuilding" ? (
                    <WorldBuildingView project={project} />
                ) : (
                    <div className="view">
                        {section === "trash" && <TrashView />}
                        {section === "settings" && (
                            <ProjectSettingsView project={project} onMetaSaved={(meta) => {
                                setProject(main.Project.createFrom({ ...project, meta }));
                            }} />
                        )}
                    </div>
                )}
            </main>
        </div>
    );
}
