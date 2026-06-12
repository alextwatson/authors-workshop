import { main } from "../../../wailsjs/go/models";

interface Props {
    project: main.Project;
}

export default function OutlineView(_: Props) {
    return (
        <>
            <h2>Outline</h2>
            <p className="subtitle">Plan your chapters and scenes.</p>
            <div className="placeholder">
                The hierarchical outline editor will live here, backed by outline.json.
            </div>
        </>
    );
}
