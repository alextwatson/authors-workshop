package main

import (
	"context"
	"encoding/base64"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the Wails-bound backend. All methods take the project path explicitly
// so the frontend remains the single source of truth for which project is open.
type App struct {
	ctx context.Context

	trashMu  sync.Mutex
	trashDir string
	trash    []TrashItem
	trashSeq int
}

func NewApp() *App {
	return &App{}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
}

// CreateProject asks the user where to create a new project, then scaffolds
// the full folder structure there. Returns nil (no error) if the user cancels.
func (a *App) CreateProject(name string) (*Project, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("project name cannot be empty")
	}
	parent, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Choose where to create your project",
		CanCreateDirectories: true,
	})
	if err != nil {
		return nil, err
	}
	if parent == "" {
		return nil, nil
	}
	dir := filepath.Join(parent, slugify(name))
	if _, err := os.Stat(dir); err == nil {
		return nil, fmt.Errorf("a folder named %q already exists there", filepath.Base(dir))
	}
	now := nowStamp()
	meta := ProjectMeta{
		Name:          name,
		WordCountGoal: 80000,
		DailyWordGoal: 500,
		CreatedAt:     now,
		UpdatedAt:     now,
		Focus:         defaultFocusSettings(),
	}
	if err := scaffoldProject(dir, meta); err != nil {
		return nil, fmt.Errorf("could not create project: %w", err)
	}
	return &Project{Path: dir, Meta: meta}, nil
}

// OpenProject asks the user to pick an existing project folder.
// Returns nil (no error) if the user cancels.
func (a *App) OpenProject() (*Project, error) {
	dir, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Open a project folder",
	})
	if err != nil {
		return nil, err
	}
	if dir == "" {
		return nil, nil
	}
	return a.LoadProject(dir)
}

// LoadProject reads a project from a known path (e.g. a recent-projects list).
func (a *App) LoadProject(projectPath string) (*Project, error) {
	meta, err := readProjectMeta(projectPath)
	if err != nil {
		return nil, err
	}
	return &Project{Path: projectPath, Meta: meta}, nil
}

// SaveProjectMeta writes project.json, stamping UpdatedAt. Returns the saved meta.
func (a *App) SaveProjectMeta(projectPath string, meta ProjectMeta) (*ProjectMeta, error) {
	meta.UpdatedAt = nowStamp()
	if meta.Focus == nil {
		meta.Focus = defaultFocusSettings()
	}
	if err := writeJSON(filepath.Join(projectPath, projectFile), meta); err != nil {
		return nil, fmt.Errorf("could not save project: %w", err)
	}
	return &meta, nil
}

// --- Manuscript ---

func listDocs(dir string) ([]ChapterInfo, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []ChapterInfo{}, nil
		}
		return nil, err
	}
	chapters := []ChapterInfo{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".md") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			return nil, err
		}
		title, body := splitChapter(string(data))
		if title == "" {
			title = strings.TrimSuffix(entry.Name(), ".md")
		}
		chapters = append(chapters, ChapterInfo{
			Filename:  entry.Name(),
			Title:     title,
			WordCount: countWords(body),
		})
	}
	sort.Slice(chapters, func(i, j int) bool { return chapters[i].Filename < chapters[j].Filename })
	return chapters, nil
}

func (a *App) ListChapters(projectPath string) ([]ChapterInfo, error) {
	docs, err := listDocs(filepath.Join(projectPath, manuscriptDir))
	if err != nil {
		return nil, err
	}
	sortDocsByOrder(docs, readManuscriptOrder(projectPath).Chapters)
	return docs, nil
}

// SetManuscriptOrder persists the user's drag-reordering of chapters or scenes.
func (a *App) SetManuscriptOrder(projectPath, kind string, files []string) error {
	o := readManuscriptOrder(projectPath)
	if kind == "scene" {
		o.Scenes = files
	} else {
		o.Chapters = files
	}
	return writeJSON(filepath.Join(projectPath, manuscriptDir, orderFile), o)
}

func (a *App) ListParts(projectPath string) ([]ManuscriptPart, error) {
	parts := readManuscriptOrder(projectPath).Parts
	if parts == nil {
		parts = []ManuscriptPart{}
	}
	return parts, nil
}

// SetParts persists the Part/Act dividers shown in the chapter list.
func (a *App) SetParts(projectPath string, parts []ManuscriptPart) error {
	o := readManuscriptOrder(projectPath)
	o.Parts = parts
	return writeJSON(filepath.Join(projectPath, manuscriptDir, orderFile), o)
}

func (a *App) ReadChapter(projectPath, filename string) (string, error) {
	name, err := safeName(filename)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(projectPath, manuscriptDir, name))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteChapter(projectPath, filename, content string) error {
	name, err := safeName(filename)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(projectPath, manuscriptDir, name), []byte(content))
}

// --- Scenes (manuscript/scenes/) ---

func (a *App) ListScenes(projectPath string) ([]ChapterInfo, error) {
	docs, err := listDocs(filepath.Join(projectPath, manuscriptDir, scenesSubdir))
	if err != nil {
		return nil, err
	}
	sortDocsByOrder(docs, readManuscriptOrder(projectPath).Scenes)
	return docs, nil
}

func (a *App) ReadScene(projectPath, filename string) (string, error) {
	name, err := safeName(filename)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(projectPath, manuscriptDir, scenesSubdir, name))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteScene(projectPath, filename, content string) error {
	name, err := safeName(filename)
	if err != nil {
		return err
	}
	dir := filepath.Join(projectPath, manuscriptDir, scenesSubdir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(dir, name), []byte(content))
}

// PromoteSceneToChapter moves a scene file up into the chapters folder.
// Returns the filename it ended up with (renamed only on collision).
func (a *App) PromoteSceneToChapter(projectPath, filename string) (string, error) {
	name, err := safeName(filename)
	if err != nil {
		return "", err
	}
	src := filepath.Join(projectPath, manuscriptDir, scenesSubdir, name)
	destDir := filepath.Join(projectPath, manuscriptDir)
	newName := availableName(destDir, name)
	if err := moveFile(src, filepath.Join(destDir, newName)); err != nil {
		return "", err
	}
	return newName, nil
}

// --- Outline ---

func (a *App) ReadOutline(projectPath string) (string, error) {
	data, err := os.ReadFile(filepath.Join(projectPath, outlineFile))
	if err != nil {
		if os.IsNotExist(err) {
			return defaultOutline, nil
		}
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteOutline(projectPath, content string) error {
	return writeFileAtomic(filepath.Join(projectPath, outlineFile), []byte(content))
}

// --- Characters ---

func (a *App) ListCharacters(projectPath string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(projectPath, charactersDir))
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	names := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func (a *App) ReadCharacter(projectPath, filename string) (string, error) {
	name, err := safeName(filename)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(projectPath, charactersDir, name))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteCharacter(projectPath, filename, content string) error {
	name, err := safeName(filename)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(projectPath, charactersDir, name), []byte(content))
}

// --- World building ---

func worldFile(filename string) (string, error) {
	if filename != "locations.json" && filename != "lore.json" {
		return "", fmt.Errorf("unknown worldbuilding file: %q", filename)
	}
	return filename, nil
}

func (a *App) ReadWorldFile(projectPath, filename string) (string, error) {
	name, err := worldFile(filename)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(projectPath, worldDir, name))
	if err != nil {
		if os.IsNotExist(err) {
			if name == "locations.json" {
				return defaultLocation, nil
			}
			return defaultLore, nil
		}
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteWorldFile(projectPath, filename, content string) error {
	name, err := worldFile(filename)
	if err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(projectPath, worldDir, name), []byte(content))
}

// --- Codex (world-building wiki entries) ---
//
// One JSON file per entry under worldbuilding/codex/, mirroring how characters
// are stored. The frontend owns ids/filenames; we validate and write.

func (a *App) ListCodexEntries(projectPath string) ([]string, error) {
	entries, err := os.ReadDir(filepath.Join(projectPath, worldDir, codexDir))
	if err != nil {
		if os.IsNotExist(err) {
			return []string{}, nil
		}
		return nil, err
	}
	names := []string{}
	for _, entry := range entries {
		if !entry.IsDir() && strings.HasSuffix(entry.Name(), ".json") {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names, nil
}

func (a *App) ReadCodexEntry(projectPath, filename string) (string, error) {
	name, err := safeName(filename)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(projectPath, worldDir, codexDir, name))
	if err != nil {
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteCodexEntry(projectPath, filename, content string) error {
	name, err := safeName(filename)
	if err != nil {
		return err
	}
	dir := filepath.Join(projectPath, worldDir, codexDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(dir, name), []byte(content))
}

// --- Atlas (the world map) ---
//
// atlas.json holds the map config (which image, plus pins and territory
// regions); the image itself lives as a real file under worldbuilding/maps/.

func (a *App) ReadAtlas(projectPath string) (string, error) {
	data, err := os.ReadFile(filepath.Join(projectPath, worldDir, atlasFile))
	if err != nil {
		if os.IsNotExist(err) {
			return defaultAtlas, nil
		}
		return "", err
	}
	return string(data), nil
}

func (a *App) WriteAtlas(projectPath, content string) error {
	dir := filepath.Join(projectPath, worldDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return err
	}
	return writeFileAtomic(filepath.Join(dir, atlasFile), []byte(content))
}

func mapImageMime(ext string) string {
	switch strings.ToLower(ext) {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	case ".svg":
		return "image/svg+xml"
	default:
		return "application/octet-stream"
	}
}

// ImportMapImage opens a native file picker, copies the chosen image into
// worldbuilding/maps/, and returns the stored filename (empty if cancelled).
func (a *App) ImportMapImage(projectPath string) (string, error) {
	selected, err := runtime.OpenFileDialog(a.ctx, runtime.OpenDialogOptions{
		Title: "Choose a map image",
		Filters: []runtime.FileFilter{{
			DisplayName: "Images (*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg)",
			Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg",
		}},
	})
	if err != nil {
		return "", err
	}
	if selected == "" {
		return "", nil // user cancelled
	}
	data, err := os.ReadFile(selected)
	if err != nil {
		return "", err
	}
	dir := filepath.Join(projectPath, worldDir, mapsDir)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	base := filepath.Base(selected)
	ext := filepath.Ext(base)
	stored := availableName(dir, "map-"+slugify(strings.TrimSuffix(base, ext))+strings.ToLower(ext))
	if err := writeFileAtomic(filepath.Join(dir, stored), data); err != nil {
		return "", err
	}
	return stored, nil
}

// ReadMapImage returns the stored map image as a data: URL the frontend can
// drop straight into an <img src>.
func (a *App) ReadMapImage(projectPath, filename string) (string, error) {
	name, err := safeName(filename)
	if err != nil {
		return "", err
	}
	data, err := os.ReadFile(filepath.Join(projectPath, worldDir, mapsDir, name))
	if err != nil {
		return "", err
	}
	mime := mapImageMime(filepath.Ext(name))
	return "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data), nil
}
