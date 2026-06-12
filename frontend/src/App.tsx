import { useState } from "react";
import { main } from "../wailsjs/go/models";
import StartupScreen from "./components/StartupScreen";
import Sidebar, { Section } from "./components/Sidebar";
import ManuscriptView from "./components/views/ManuscriptView";
import OutlineView from "./components/views/OutlineView";
import CharactersView from "./components/views/CharactersView";
import WorldBuildingView from "./components/views/WorldBuildingView";
import ProjectSettingsView from "./components/views/ProjectSettingsView";

export default function App() {
    const [project, setProject] = useState<main.Project | null>(null);
    const [section, setSection] = useState<Section>("manuscript");

    if (!project) {
        return <StartupScreen onProjectReady={(p) => {
            setProject(p);
            setSection("manuscript");
        }} />;
    }

    return (
        <div className="workspace">
            <Sidebar
                projectName={project.meta.name}
                active={section}
                onNavigate={setSection}
                onCloseProject={() => setProject(null)}
            />
            <main className="main">
                {section === "manuscript" ? (
                    <ManuscriptView project={project} />
                ) : (
                    <div className="view">
                        {section === "outline" && <OutlineView project={project} />}
                        {section === "characters" && <CharactersView project={project} />}
                        {section === "worldbuilding" && <WorldBuildingView project={project} />}
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
