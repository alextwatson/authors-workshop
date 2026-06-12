# Author's Workshop

A distraction-free desktop writing tool for authors to write, outline, and build their story world. Built with [Wails v2](https://wails.io) (Go backend) and React + TypeScript.

## How it stores data

No database. Each project is a plain folder of flat files you can open, sync, and back up however you like:

```
my-novel/
  project.json          # project metadata, word count goals
  manuscript/           # one .md file per chapter
  outline.json          # hierarchical scene/chapter outline
  characters/           # one .json file per character
  worldbuilding/
    locations.json
    lore.json
```

## Development

Requires Go 1.21+, Node 18+, and the [Wails CLI](https://wails.io/docs/gettingstarted/installation):

```sh
go install github.com/wailsapp/wails/v2/cmd/wails@latest
```

Run in live-development mode:

```sh
wails dev
```

Build a production app bundle into `build/bin`:

```sh
wails build
```

## Layout

- `main.go`, `app.go`, `project.go` — Go backend: folder dialogs, project scaffolding, atomic file read/write, Wails bindings
- `frontend/src` — React UI: startup screen, sidebar navigation, section views
- `frontend/wailsjs` — generated bindings (regenerate with `wails generate module`)
