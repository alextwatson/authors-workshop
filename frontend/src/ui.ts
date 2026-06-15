import { KeyboardEvent } from "react";

// Commit a single-line text field by blurring it when the user presses Enter.
// Only attach to <input> elements — textareas rely on Enter for newlines.
export function blurOnEnter(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
        e.preventDefault();
        e.currentTarget.blur();
    }
}
