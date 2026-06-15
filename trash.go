package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

// TrashItem is a scene, chapter, or character file moved to the session trash.
// The trash lives in a temp dir and is wiped when the app shuts down,
// so items are only recoverable until the trash is emptied or the
// application closes.
type TrashItem struct {
	ID          string `json:"id"`
	Kind        string `json:"kind"` // "chapter" | "scene" | "character" | "codex"
	Filename    string `json:"filename"`
	Title       string `json:"title"`
	ProjectPath string `json:"projectPath"`
	trashPath   string
}

func docDir(projectPath, kind string) string {
	switch kind {
	case "scene":
		return filepath.Join(projectPath, manuscriptDir, scenesSubdir)
	case "character":
		return filepath.Join(projectPath, charactersDir)
	case "codex":
		return filepath.Join(projectPath, worldDir, codexDir)
	default:
		return filepath.Join(projectPath, manuscriptDir)
	}
}

// moveFile renames, falling back to copy+delete for cross-device moves
// (the trash temp dir may be on a different volume than the project).
func moveFile(src, dst string) error {
	if err := os.Rename(src, dst); err == nil {
		return nil
	}
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	if _, err := io.Copy(out, in); err != nil {
		out.Close()
		os.Remove(dst)
		return err
	}
	if err := out.Close(); err != nil {
		return err
	}
	return os.Remove(src)
}

func availableName(dir, name string) string {
	if _, err := os.Stat(filepath.Join(dir, name)); os.IsNotExist(err) {
		return name
	}
	ext := filepath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 1; ; i++ {
		candidate := fmt.Sprintf("%s-restored-%d%s", base, i, ext)
		if i == 1 {
			candidate = base + "-restored" + ext
		}
		if _, err := os.Stat(filepath.Join(dir, candidate)); os.IsNotExist(err) {
			return candidate
		}
	}
}

func (a *App) trashDoc(projectPath, kind, filename string) error {
	name, err := safeName(filename)
	if err != nil {
		return err
	}
	a.trashMu.Lock()
	defer a.trashMu.Unlock()
	if a.trashDir == "" {
		dir, err := os.MkdirTemp("", "authors-workshop-trash-")
		if err != nil {
			return err
		}
		a.trashDir = dir
	}
	src := filepath.Join(docDir(projectPath, kind), name)
	title := strings.TrimSuffix(name, filepath.Ext(name))
	if data, err := os.ReadFile(src); err == nil {
		if kind == "character" {
			var c struct {
				Name string `json:"name"`
			}
			if json.Unmarshal(data, &c) == nil && c.Name != "" {
				title = c.Name
			}
		} else if kind == "codex" {
			var c struct {
				Title string `json:"title"`
			}
			if json.Unmarshal(data, &c) == nil && c.Title != "" {
				title = c.Title
			}
		} else if t, _ := splitChapter(string(data)); t != "" {
			title = t
		}
	}
	a.trashSeq++
	id := fmt.Sprintf("trash-%d", a.trashSeq)
	dst := filepath.Join(a.trashDir, id+"-"+name)
	if err := moveFile(src, dst); err != nil {
		return err
	}
	a.trash = append(a.trash, TrashItem{
		ID:          id,
		Kind:        kind,
		Filename:    name,
		Title:       title,
		ProjectPath: projectPath,
		trashPath:   dst,
	})
	return nil
}

func (a *App) DeleteChapter(projectPath, filename string) error {
	return a.trashDoc(projectPath, "chapter", filename)
}

func (a *App) DeleteScene(projectPath, filename string) error {
	return a.trashDoc(projectPath, "scene", filename)
}

func (a *App) DeleteCharacter(projectPath, filename string) error {
	return a.trashDoc(projectPath, "character", filename)
}

func (a *App) DeleteCodexEntry(projectPath, filename string) error {
	return a.trashDoc(projectPath, "codex", filename)
}

func (a *App) ListTrash() []TrashItem {
	a.trashMu.Lock()
	defer a.trashMu.Unlock()
	items := make([]TrashItem, len(a.trash))
	copy(items, a.trash)
	return items
}

// RestoreTrashItem moves a file back where it came from, picking a
// "-restored" name if the original name has been taken since.
// Returns the filename it was restored under.
func (a *App) RestoreTrashItem(id string) (string, error) {
	a.trashMu.Lock()
	defer a.trashMu.Unlock()
	for i, item := range a.trash {
		if item.ID != id {
			continue
		}
		dir := docDir(item.ProjectPath, item.Kind)
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return "", err
		}
		name := availableName(dir, item.Filename)
		if err := moveFile(item.trashPath, filepath.Join(dir, name)); err != nil {
			return "", err
		}
		a.trash = append(a.trash[:i], a.trash[i+1:]...)
		return name, nil
	}
	return "", fmt.Errorf("trash item not found (the trash is cleared when the app closes)")
}

func (a *App) EmptyTrash() error {
	a.trashMu.Lock()
	defer a.trashMu.Unlock()
	for _, item := range a.trash {
		os.Remove(item.trashPath)
	}
	a.trash = nil
	return nil
}

func (a *App) shutdown(_ context.Context) {
	if a.trashDir != "" {
		os.RemoveAll(a.trashDir)
	}
}
