# Author's Workshop

A distraction-free desktop writing tool for authors to write, outline, and build their story world. Built with [Wails v2](https://wails.io) (Go backend) and React + TypeScript.

## Download (macOS)

**[⬇ Download the latest Mac version](https://github.com/alextwatson/authors-workshop/releases/latest/download/authors-workshop-mac.zip)** — a universal build that runs on both Apple Silicon and Intel Macs.

1. Unzip and drag **Author's Workshop** into your **Applications** folder.
2. The first time you open it, macOS will warn that the app is from an unidentified developer (it isn't notarized by Apple). To get past this, **right-click the app → Open**, then click **Open** in the dialog. You only need to do this once.

> If you instead see *"Author's Workshop is damaged and can't be opened,"* run this once in Terminal to clear the quarantine flag, then open it normally:
>
> ```sh
> xattr -cr /Applications/authors-workshop.app
> ```

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
