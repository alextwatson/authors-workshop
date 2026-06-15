import { main } from "../wailsjs/go/models";

// Defaults mirror defaultFocusSettings() in project.go. Used whenever a project
// (or a single field) predates the focus settings, so the UI always has a value.
export const DEFAULT_FOCUS: main.FocusSettings = {
    dimSentences: true,
    typewriter: true,
    dimTitle: true,
    hideWordCount: true,
    dimSentencesAlways: false,
    typewriterAlways: false,
    dimTitleAlways: false,
    hideWordCountAlways: false,
};

// Fill any missing field on a project's stored focus settings with the default.
export function resolveFocusSettings(focus?: main.FocusSettings): main.FocusSettings {
    return {
        dimSentences: focus?.dimSentences ?? DEFAULT_FOCUS.dimSentences,
        typewriter: focus?.typewriter ?? DEFAULT_FOCUS.typewriter,
        dimTitle: focus?.dimTitle ?? DEFAULT_FOCUS.dimTitle,
        hideWordCount: focus?.hideWordCount ?? DEFAULT_FOCUS.hideWordCount,
        dimSentencesAlways: focus?.dimSentencesAlways ?? DEFAULT_FOCUS.dimSentencesAlways,
        typewriterAlways: focus?.typewriterAlways ?? DEFAULT_FOCUS.typewriterAlways,
        dimTitleAlways: focus?.dimTitleAlways ?? DEFAULT_FOCUS.dimTitleAlways,
        hideWordCountAlways: focus?.hideWordCountAlways ?? DEFAULT_FOCUS.hideWordCountAlways,
    };
}

// Resolve each effect to whether it should be active right now: an effect runs
// in focus mode when its base flag is set, and runs everywhere when "always".
export function effectiveFocus(focus: main.FocusSettings, focusMode: boolean) {
    const on = (base: boolean, always: boolean) => always || (focusMode && base);
    return {
        dimSentences: on(focus.dimSentences, focus.dimSentencesAlways),
        typewriter: on(focus.typewriter, focus.typewriterAlways),
        dimTitle: on(focus.dimTitle, focus.dimTitleAlways),
        hideWordCount: on(focus.hideWordCount, focus.hideWordCountAlways),
    };
}
