package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

// ProjectMeta is the content of project.json at the root of a project folder.
type ProjectMeta struct {
	Name          string         `json:"name"`
	Author        string         `json:"author"`
	Description   string         `json:"description"`
	WordCountGoal int            `json:"wordCountGoal"`
	DailyWordGoal int            `json:"dailyWordGoal"`
	CreatedAt     string         `json:"createdAt"`
	UpdatedAt     string         `json:"updatedAt"`
	Focus         *FocusSettings `json:"focus,omitempty"`
	// ManuscriptFormat is "md" (chapters stored as markdown with "# " title
	// headings) or "txt" (plain text, title on the first line). Empty/unknown
	// values are treated as "md".
	ManuscriptFormat string `json:"manuscriptFormat"`
}

// FocusSettings controls the manuscript focus-writing mode. Stored per project
// in project.json. A nil value (older projects) is filled in with defaults on
// load, so the frontend always receives a fully populated object.
//
// Each effect has a base flag (does it happen in focus mode?) and an "always"
// flag (apply it even when focus mode is off?).
type FocusSettings struct {
	DimSentences  bool `json:"dimSentences"`  // dim every sentence but the one being written
	Typewriter    bool `json:"typewriter"`    // keep the current line vertically centered
	DimTitle      bool `json:"dimTitle"`      // dim the chapter title while editing the body
	HideWordCount bool `json:"hideWordCount"` // hide the word-count / save-status bar

	DimSentencesAlways  bool `json:"dimSentencesAlways"`
	TypewriterAlways    bool `json:"typewriterAlways"`
	DimTitleAlways      bool `json:"dimTitleAlways"`
	HideWordCountAlways bool `json:"hideWordCountAlways"`
}

func defaultFocusSettings() *FocusSettings {
	return &FocusSettings{
		DimSentences:  true,
		Typewriter:    true,
		DimTitle:      true,
		HideWordCount: true,
	}
}

// UnmarshalJSON starts from the defaults so a focus object written by an older
// build (missing newer keys) keeps each absent setting at its default rather
// than defaulting to the zero value.
func (f *FocusSettings) UnmarshalJSON(data []byte) error {
	type alias FocusSettings
	tmp := alias(*defaultFocusSettings())
	if err := json.Unmarshal(data, &tmp); err != nil {
		return err
	}
	*f = FocusSettings(tmp)
	return nil
}

// Project pairs a project folder on disk with its parsed metadata.
type Project struct {
	Path string      `json:"path"`
	Meta ProjectMeta `json:"meta"`
}

// ChapterInfo is a summary of one manuscript chapter/scene file (.md or .txt).
type ChapterInfo struct {
	Filename  string `json:"filename"`
	Title     string `json:"title"`
	WordCount int    `json:"wordCount"`
}

const (
	projectFile      = "project.json"
	manuscriptDir    = "manuscript"
	scenesSubdir     = "scenes"
	charactersDir    = "characters"
	worldDir         = "worldbuilding"
	codexDir         = "codex"
	mapsDir          = "maps"
	atlasFile        = "atlas.json"
	defaultAtlas     = "{\n  \"version\": 1,\n  \"mapImage\": \"\",\n  \"pins\": [],\n  \"regions\": []\n}\n"
	outlineFile      = "outline.json"
	defaultOutline   = "{\n  \"version\": 1,\n  \"nodes\": []\n}\n"
	defaultLocation  = "{\n  \"locations\": []\n}\n"
	defaultLore      = "{\n  \"entries\": []\n}\n"
	noteboardFile    = "noteboard.json"
	defaultNoteboard = "{\n  \"version\": 1,\n  \"defaultColor\": \"#bfbfbf\",\n  \"notes\": [],\n  \"threads\": []\n}\n"
)

var slugPattern = regexp.MustCompile(`[^a-z0-9]+`)

func slugify(name string) string {
	slug := strings.Trim(slugPattern.ReplaceAllString(strings.ToLower(name), "-"), "-")
	if slug == "" {
		slug = "untitled-project"
	}
	return slug
}

func nowStamp() string {
	return time.Now().UTC().Format(time.RFC3339)
}

// writeFileAtomic writes to a temp file then renames it into place, so an
// auto-save interrupted mid-write never leaves a truncated file behind.
func writeFileAtomic(path string, data []byte) error {
	dir := filepath.Dir(path)
	tmp, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpName)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpName)
		return err
	}
	return os.Rename(tmpName, path)
}

func writeJSON(path string, v interface{}) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(path, append(data, '\n'))
}

func readProjectMeta(projectPath string) (ProjectMeta, error) {
	var meta ProjectMeta
	data, err := os.ReadFile(filepath.Join(projectPath, projectFile))
	if err != nil {
		if os.IsNotExist(err) {
			return meta, fmt.Errorf("this folder is not an Author's Workshop project (no %s found)", projectFile)
		}
		return meta, err
	}
	if err := json.Unmarshal(data, &meta); err != nil {
		return meta, fmt.Errorf("%s is not valid JSON: %w", projectFile, err)
	}
	if meta.Focus == nil {
		meta.Focus = defaultFocusSettings()
	}
	meta.ManuscriptFormat = normalizeFormat(meta.ManuscriptFormat)
	return meta, nil
}

// scaffoldProject creates the full folder structure for a new project.
func scaffoldProject(dir string, meta ProjectMeta) error {
	dirs := []string{
		manuscriptDir,
		charactersDir,
		worldDir,
		filepath.Join(worldDir, codexDir),
	}
	for _, sub := range dirs {
		if err := os.MkdirAll(filepath.Join(dir, sub), 0o755); err != nil {
			return err
		}
	}
	if err := writeJSON(filepath.Join(dir, projectFile), meta); err != nil {
		return err
	}
	files := map[string]string{
		filepath.Join(dir, outlineFile):                    defaultOutline,
		filepath.Join(dir, noteboardFile):                  defaultNoteboard,
		filepath.Join(dir, worldDir, "locations.json"):     defaultLocation,
		filepath.Join(dir, worldDir, "lore.json"):          defaultLore,
		filepath.Join(dir, manuscriptDir, "chapter-01.md"): "# Chapter 1\n\n",
	}
	for path, content := range files {
		if err := writeFileAtomic(path, []byte(content)); err != nil {
			return err
		}
	}
	return nil
}

// normalizeFormat coerces a stored/incoming manuscript format to a known value,
// defaulting anything unrecognised (including "") to markdown.
func normalizeFormat(format string) string {
	if format == "txt" {
		return "txt"
	}
	return "md"
}

// manuscriptExt is the on-disk file extension for a manuscript format.
func manuscriptExt(format string) string {
	if normalizeFormat(format) == "txt" {
		return ".txt"
	}
	return ".md"
}

// formatForExt maps a manuscript file's extension back to its format.
func formatForExt(ext string) string {
	if strings.EqualFold(ext, ".txt") {
		return "txt"
	}
	return "md"
}

// splitDoc separates a chapter/scene file into its title and body, so the
// title can be edited and counted separately from the prose. In markdown the
// title is the first "# heading"; in plain text it's the first non-empty line.
func splitDoc(content, format string) (title, body string) {
	lines := strings.Split(content, "\n")
	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" {
			continue
		}
		if normalizeFormat(format) == "txt" {
			title = strings.TrimSpace(strings.TrimLeft(trimmed, "# "))
			body = strings.TrimLeft(strings.Join(lines[i+1:], "\n"), "\n")
			return title, body
		}
		if strings.HasPrefix(trimmed, "#") {
			title = strings.TrimSpace(strings.TrimLeft(trimmed, "# "))
			body = strings.TrimLeft(strings.Join(lines[i+1:], "\n"), "\n")
			return title, body
		}
		break
	}
	return "", content
}

// serializeDoc joins a title and body back into one file in the given format,
// mirroring the frontend's serializeDoc.
func serializeDoc(title, body, format string) string {
	t := strings.TrimSpace(title)
	if t == "" {
		return body
	}
	if normalizeFormat(format) == "txt" {
		return t + "\n\n" + body
	}
	return "# " + t + "\n\n" + body
}

func countWords(content string) int {
	return len(strings.Fields(content))
}

// ManuscriptPart is a labeled Part/Act divider shown above the chapter it
// begins. Anchoring to a chapter filename (rather than an index) keeps the
// heading glued to its starting chapter across reordering.
type ManuscriptPart struct {
	ID     string `json:"id"`
	Label  string `json:"label"`
	Before string `json:"before"`
}

// manuscriptOrder is the content of manuscript/order.json — the user's
// chosen ordering for chapters and scenes. Files not listed sort after
// the listed ones, alphabetically.
type manuscriptOrder struct {
	Chapters []string         `json:"chapters"`
	Scenes   []string         `json:"scenes"`
	Parts    []ManuscriptPart `json:"parts"`
}

const orderFile = "order.json"

func readManuscriptOrder(projectPath string) manuscriptOrder {
	var o manuscriptOrder
	data, err := os.ReadFile(filepath.Join(projectPath, manuscriptDir, orderFile))
	if err == nil {
		json.Unmarshal(data, &o)
	}
	return o
}

func sortDocsByOrder(docs []ChapterInfo, order []string) {
	pos := make(map[string]int, len(order))
	for i, f := range order {
		pos[f] = i
	}
	sort.SliceStable(docs, func(i, j int) bool {
		pi, iOK := pos[docs[i].Filename]
		pj, jOK := pos[docs[j].Filename]
		if iOK && jOK {
			return pi < pj
		}
		if iOK != jOK {
			return iOK
		}
		return docs[i].Filename < docs[j].Filename
	})
}

// safeName guards against path traversal in filenames coming from the frontend.
func safeName(filename string) (string, error) {
	base := filepath.Base(filename)
	if base != filename || base == "." || base == ".." || strings.HasPrefix(base, ".") {
		return "", fmt.Errorf("invalid filename: %q", filename)
	}
	return base, nil
}
