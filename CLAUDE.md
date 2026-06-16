# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Author's Workshop — a distraction-free desktop writing app (manuscript, outline, characters, world-building) built with [Wails v2](https://wails.io): a Go backend bound into a React + TypeScript frontend, packaged as a native desktop app.

## Design philosophy

This app is deliberately **clean and simple** — a distraction-free tool for writers. Keep this in mind for every design and implementation choice:

- Favor the minimal solution. Prefer fewer features, fewer options, and fewer dependencies over more. The current stack (plain React 18 + Vite, no router or state library, flat files instead of a database) is intentional — don't reach for heavier tooling unless there's a clear need.
- Default to calm, uncluttered UI. New surfaces should feel like they belong in a focused writing environment; resist adding chrome, settings, or visual noise.
- When a change could be done simply or elaborately, choose simply. If a feature genuinely needs complexity, flag the trade-off rather than quietly adding it.

## Commands

- `./dev.sh` — the normal way to run during development. Runs `go vet`, `go build`, and a frontend `tsc --noEmit` type-check, then launches `wails dev` (hot-reload). Use this rather than `wails dev` directly so type/compile errors surface first.
- `wails build` — production app bundle into `build/bin`.
- `cd frontend && npx tsc --noEmit` — type-check the frontend alone.
- `go vet ./...` / `go build ./...` — check the Go backend alone.
- `wails generate module` — regenerate the `frontend/wailsjs` bindings after changing any exported `App` method signature (see below).

There is no test suite.

### Running the app for testing

**The user runs and tests the app themselves and gives feedback — don't launch it.** This is a native macOS desktop app; there's no automated way to drive its window, and full-screen screenshots are intrusive. Verify your changes with the build/type-check commands above (or `./dev.sh`), then hand off to the user to try it. To launch it yourself only if explicitly asked: `wails dev` (hot-reload) or `open build/bin/authors-workshop.app` after a `wails build`.

Requires Go 1.23+, Node 18+, and the Wails CLI (`go install github.com/wailsapp/wails/v2/cmd/wails@latest`).

## Architecture

### The Go ⇄ frontend boundary

Every backend capability is an exported method on the `App` struct (`app.go`, `trash.go`). Wails generates TypeScript stubs for these into `frontend/wailsjs/go/main/App.*` and Go struct types into `frontend/wailsjs/go/models.ts`. The frontend imports and calls them like async functions. **After changing an `App` method's signature or any bound struct, run `wails generate module` or the frontend bindings go stale.** `dev.sh` regenerates as part of `wails dev`.

Key design rule: **the frontend is the single source of truth for which project is open.** Backend methods are stateless w.r.t. the current project — they take `projectPath` as their first argument every time. The backend holds almost no state; the one exception is the session trash (`App.trash*` fields, guarded by `trashMu`).

### Data model: flat files, no database

Each project is a plain folder the user can sync/back up. The layout (constants in `project.go`):

```
my-novel/
  project.json            # ProjectMeta: name, goals, focus + manuscriptFormat ("md" | "txt")
  manuscript/
    chapter-NN.md/.txt    # one file per chapter; md title is a "# heading", txt the first line
    scenes/scene-NN.*     # loose scenes (same format as chapters), can be promoted to chapters
    order.json            # user's drag-order for chapters/scenes + Part dividers
  outline.json            # hierarchical outline (opaque JSON owned by frontend)
  characters/char-NN.json # one file per character
  worldbuilding/
    locations.json, lore.json
    codex/entry-NN.json   # wiki entries, one file each
    atlas.json            # map config (pins, regions, which image)
    maps/                 # imported map image files
```

Conventions that recur across the backend:
- **Numbered filenames** (`chapter-NN.md`, `char-NN.json`) are allocated by the frontend (`frontend/src/docnames.ts`), not the backend.
- **Atomic writes**: all saves go through `writeFileAtomic` / `writeJSON` (temp file + rename) so an interrupted auto-save never truncates a file.
- **Path-traversal guard**: any filename arriving from the frontend is passed through `safeName` before being joined to a path. World-building files use the stricter `worldFile` allowlist.
- **Missing files return defaults, not errors**: e.g. `ReadOutline` returns `defaultOutline` if the file doesn't exist yet. Reads should generally treat `os.IsNotExist` as "empty/default".
- **JSON blobs are opaque to Go**: outline, character, codex, and atlas contents are read/written as raw strings; their schema lives entirely in the frontend (`outline.ts`, `characters.ts`, `codex.ts`, `atlas.ts`). Go only parses enough to extract a display title when trashing.
- **Manuscript format is md or txt**: `splitDoc`/`serializeDoc` (mirrored by `parseDoc`/`serializeDoc` in `DocEditor.tsx`) handle both — markdown uses a `# ` title heading, plain text the first line. `SetManuscriptFormat` converts the whole manuscript at once: it rewrites + renames every chapter/scene file and remaps the filename references stored in `order.json` (Go struct) and `outline.json` (opaque — patched by quoted-string replace). `ExportManuscript` stitches chapters into one file in either format, independent of how they're stored.

### Trash (`trash.go`)

Deletes don't unlink — they move the file into a per-session temp dir and record a `TrashItem`. Trash is wiped on app shutdown (`App.shutdown`), so it's recover-until-you-quit, not a persistent recycle bin. `moveFile` falls back to copy+delete for cross-device moves (temp dir may be on another volume).

### Frontend structure

- `App.tsx` — top-level state: which `project` is open, which `section` is active, sidebar/focus-mode toggles. Renders `StartupScreen` until a project loads, then a sidebar + the active section view.
- `components/views/*` — one component per sidebar section (Manuscript, Outline, Characters, WorldBuilding, ProjectSettings, Trash).
- `components/*` — shared editors (`DocEditor`, `CharacterEditor`, `CodexEditor`, `AtlasView`).
- `src/*.ts` (non-component) — pure-ish domain helpers: filename allocation (`docnames`), outline/character/codex/atlas data shapes, focus-mode resolution (`focus`).
- Plain React 18 + Vite, no router or state library; navigation is the `section` enum in `App.tsx`. Recent-projects list and similar UI prefs live in browser `localStorage`, not on disk.

### Focus mode

A per-project writing mode (dim non-active sentences, typewriter scrolling, hide chrome). Settings persist in `project.json` as `FocusSettings`. Note the custom `FocusSettings.UnmarshalJSON` in `project.go`: it starts from defaults so a config written by an older build (missing newer keys) keeps each absent flag at its *default*, not Go's zero value. A nil `Focus` on load is backfilled with `defaultFocusSettings()`.

### macOS specifics

`main.go` builds a native menu bar only on darwin (for the standard Edit shortcuts and the AppKit-provided "Enter Full Screen"), and sets an empty `mac.Options{}` so Wails keeps the green zoom traffic-light enabled.
