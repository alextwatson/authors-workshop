import { main } from "../../../wailsjs/go/models";

interface Props {
    project: main.Project;
}

export default function WorldBuildingView(_: Props) {
    return (
        <>
            <h2>World Building</h2>
            <p className="subtitle">Locations, lore, and everything in between.</p>
            <div className="placeholder">
                Locations and lore editors will live here, backed by
                worldbuilding/locations.json and worldbuilding/lore.json.
            </div>
        </>
    );
}
