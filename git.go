package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Optional, opt-in version control. A project folder is already a plain
// directory of files, so it maps directly onto a git repository. Rather than
// pull in a Go git library, we shell out to the system `git` binary. GitHub
// sign-in is handled in-app via the OAuth device flow (github.go); the resulting
// token lives in git's own credential store (the macOS keychain), so both `git
// push` and our GitHub API calls authenticate without prompting.

// GitState is a snapshot of a project's git status for the settings UI.
type GitState struct {
	Available   bool   `json:"available"`   // is the git binary on PATH?
	IsRepo      bool   `json:"isRepo"`      // is the project folder a git repo?
	Branch      string `json:"branch"`      // current branch name
	HasRemote   bool   `json:"hasRemote"`   // is an "origin" remote configured?
	RemoteURL   string `json:"remoteUrl"`   // origin URL, if any
	Dirty       bool   `json:"dirty"`       // are there uncommitted changes?
	ChangeCount int    `json:"changeCount"` // number of changed/untracked paths
	Ahead       int    `json:"ahead"`       // commits not yet pushed to origin
	Behind      int    `json:"behind"`      // commits on origin not yet pulled
	SignedIn    bool   `json:"signedIn"`    // is a GitHub credential available?
	GitHubUser  string `json:"githubUser"`  // the signed-in GitHub username, if known
}

// GitCommitInfo is one entry in the version history.
type GitCommitInfo struct {
	Hash    string `json:"hash"`
	Date    string `json:"date"`
	Message string `json:"message"`
}

// runGit runs git inside projectPath and returns its trimmed stdout. On failure
// it returns an error carrying git's stderr, which holds the useful message
// (e.g. "Please tell me who you are" or an auth failure).
func runGit(projectPath string, args ...string) (string, error) {
	git, err := exec.LookPath("git")
	if err != nil {
		return "", fmt.Errorf("git is not installed or not on your PATH")
	}
	cmd := exec.Command(git, append([]string{"-C", projectPath}, args...)...)
	// GUI apps have no terminal, so a credential/passphrase prompt would hang or
	// fail with a confusing "Device not configured". Disable interactive prompts
	// so auth problems surface as a clean error we can explain.
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(errBuf.String()); msg != "" {
			return "", fmt.Errorf("%s", msg)
		}
		return "", err
	}
	return strings.TrimSpace(out.String()), nil
}

// runGitStdin is runGit with data piped to git's stdin (for `credential` plumbing).
// It returns stdout even on error so callers can still parse a partial result.
func runGitStdin(projectPath, stdin string, args ...string) (string, error) {
	git, err := exec.LookPath("git")
	if err != nil {
		return "", fmt.Errorf("git is not installed or not on your PATH")
	}
	cmd := exec.Command(git, append([]string{"-C", projectPath}, args...)...)
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0")
	cmd.Stdin = strings.NewReader(stdin)
	var out, errBuf bytes.Buffer
	cmd.Stdout = &out
	cmd.Stderr = &errBuf
	if err := cmd.Run(); err != nil {
		if msg := strings.TrimSpace(errBuf.String()); msg != "" {
			return out.String(), fmt.Errorf("%s", msg)
		}
		return out.String(), err
	}
	return out.String(), nil
}

// GitStatus reports the project's version-control state. It never errors for the
// ordinary "git missing" or "not a repo yet" cases — those are flags on the
// returned struct so the UI can offer to enable version control.
func (a *App) GitStatus(projectPath string) (GitState, error) {
	var st GitState
	if _, err := exec.LookPath("git"); err != nil {
		return st, nil // Available stays false
	}
	st.Available = true
	// A stored GitHub credential (from our device-flow sign-in, or any helper
	// the user already configured) means we can push and call the API.
	if login, token := githubCredentials(projectPath); token != "" {
		st.SignedIn = true
		st.GitHubUser = login
	}
	if _, err := os.Stat(filepath.Join(projectPath, ".git")); err != nil {
		return st, nil // not a repo yet
	}
	st.IsRepo = true

	if branch, err := runGit(projectPath, "rev-parse", "--abbrev-ref", "HEAD"); err == nil {
		st.Branch = branch
	}
	if url, err := runGit(projectPath, "remote", "get-url", "origin"); err == nil {
		st.HasRemote = true
		st.RemoteURL = url
	}
	if out, err := runGit(projectPath, "status", "--porcelain"); err == nil && out != "" {
		st.Dirty = true
		st.ChangeCount = len(strings.Split(out, "\n"))
	}
	// Left/right counts vs the upstream branch: left = behind, right = ahead.
	if out, err := runGit(projectPath, "rev-list", "--left-right", "--count", "@{upstream}...HEAD"); err == nil {
		if f := strings.Fields(out); len(f) == 2 {
			st.Behind, _ = strconv.Atoi(f[0])
			st.Ahead, _ = strconv.Atoi(f[1])
		}
	}
	return st, nil
}

// GitInit turns the project folder into a git repository on a "main" branch,
// adds a .gitignore for the app's temp/OS files, and records an initial commit.
func (a *App) GitInit(projectPath string) (GitState, error) {
	if _, err := os.Stat(filepath.Join(projectPath, ".git")); err == nil {
		return a.GitStatus(projectPath) // already a repo
	}
	if _, err := runGit(projectPath, "init", "-b", "main"); err != nil {
		// Older git lacks `init -b`; fall back to init + branch rename.
		if _, err2 := runGit(projectPath, "init"); err2 != nil {
			return GitState{}, err2
		}
		runGit(projectPath, "checkout", "-b", "main")
	}
	gitignore := filepath.Join(projectPath, ".gitignore")
	if _, err := os.Stat(gitignore); os.IsNotExist(err) {
		// .tmp-* are the in-flight files from writeFileAtomic.
		writeFileAtomic(gitignore, []byte(".tmp-*\n.DS_Store\n"))
	}
	if _, err := runGit(projectPath, "add", "-A"); err != nil {
		return GitState{}, err
	}
	if _, err := runGit(projectPath, "commit", "-m", "Initial version"); err != nil {
		return GitState{}, err
	}
	return a.GitStatus(projectPath)
}

// GitCommit stages every change and records a snapshot. A blank message becomes
// a timestamped default. If nothing has changed it returns the current status
// without error, so the button is always safe to press.
func (a *App) GitCommit(projectPath, message string) (GitState, error) {
	if _, err := runGit(projectPath, "add", "-A"); err != nil {
		return GitState{}, err
	}
	// `diff --cached --quiet` exits 0 when nothing is staged.
	if _, err := runGit(projectPath, "diff", "--cached", "--quiet"); err == nil {
		return a.GitStatus(projectPath)
	}
	msg := strings.TrimSpace(message)
	if msg == "" {
		msg = "Snapshot " + nowStamp()
	}
	if _, err := runGit(projectPath, "commit", "-m", msg); err != nil {
		return GitState{}, err
	}
	return a.GitStatus(projectPath)
}

// GitSetRemote points "origin" at the given GitHub URL, adding or updating it as
// needed. An empty URL removes the remote.
func (a *App) GitSetRemote(projectPath, url string) (GitState, error) {
	url = strings.TrimSpace(url)
	_, getErr := runGit(projectPath, "remote", "get-url", "origin")
	exists := getErr == nil
	switch {
	case url == "" && exists:
		if _, err := runGit(projectPath, "remote", "remove", "origin"); err != nil {
			return GitState{}, err
		}
	case url == "":
		// nothing to do
	case exists:
		if _, err := runGit(projectPath, "remote", "set-url", "origin", url); err != nil {
			return GitState{}, err
		}
	default:
		if _, err := runGit(projectPath, "remote", "add", "origin", url); err != nil {
			return GitState{}, err
		}
	}
	return a.GitStatus(projectPath)
}

// GitClone clones a repository into a folder the user picks, then opens it as a
// project. Returns nil (no error) if the user cancels the folder picker, and an
// error if the cloned repo isn't an Author's Workshop project.
func (a *App) GitClone(url string) (*Project, error) {
	url = strings.TrimSpace(url)
	if url == "" {
		return nil, fmt.Errorf("enter a repository URL")
	}
	parent, err := runtime.OpenDirectoryDialog(a.ctx, runtime.OpenDialogOptions{
		Title:                "Choose where to clone the project",
		CanCreateDirectories: true,
	})
	if err != nil {
		return nil, err
	}
	if parent == "" {
		return nil, nil // user cancelled
	}
	name := repoFolderName(url)
	dest := filepath.Join(parent, name)
	if _, err := os.Stat(dest); err == nil {
		return nil, fmt.Errorf("a folder named %q already exists there", name)
	}
	if _, err := runGit(parent, "clone", url, name); err != nil {
		os.RemoveAll(dest) // git may leave a partial dir behind on a failed clone
		return nil, friendlyCloneError(url, err)
	}
	meta, err := readProjectMeta(dest)
	if err != nil {
		os.RemoveAll(dest) // not one of our projects — don't leave a stray clone behind
		return nil, fmt.Errorf("that repository isn’t an Author's Workshop project: %w", err)
	}
	return &Project{Path: dest, Meta: meta}, nil
}

// OpenURL opens a URL in the user's default browser — used by the "View on
// GitHub" link so a writer can see their backed-up book on the web.
func (a *App) OpenURL(url string) {
	runtime.BrowserOpenURL(a.ctx, url)
}

// repoFolderName derives a local folder name from a clone URL, stripping any
// trailing slash and ".git" and taking the last path segment. Handles both
// https://host/owner/name(.git) and git@host:owner/name(.git) forms.
func repoFolderName(url string) string {
	s := strings.TrimSuffix(strings.TrimRight(url, "/"), ".git")
	if i := strings.LastIndexAny(s, "/:"); i >= 0 {
		s = s[i+1:]
	}
	if s == "" {
		return "cloned-project"
	}
	return s
}

// GitPush publishes local commits to origin, setting the upstream on first push
// so later syncs need no arguments.
func (a *App) GitPush(projectPath string) (GitState, error) {
	branch, err := runGit(projectPath, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return GitState{}, err
	}
	if _, err := runGit(projectPath, "rev-parse", "--abbrev-ref", "@{upstream}"); err != nil {
		// No upstream configured yet.
		if _, err := runGit(projectPath, "push", "-u", "origin", branch); err != nil {
			return GitState{}, friendlyAuthError(err)
		}
	} else if _, err := runGit(projectPath, "push"); err != nil {
		return GitState{}, friendlyAuthError(err)
	}
	return a.GitStatus(projectPath)
}

// friendlyAuthError rewrites git's opaque credential failures into a plain next
// step, leaving other errors untouched.
func friendlyAuthError(err error) error {
	msg := err.Error()
	if strings.Contains(msg, "could not read Username") ||
		strings.Contains(msg, "Authentication failed") ||
		strings.Contains(msg, "terminal prompts disabled") {
		return fmt.Errorf("couldn’t reach GitHub — you may need to sign in again under “Back up to GitHub”.\n\n%s", msg)
	}
	return err
}

// friendlyCloneError turns git clone's terse failures into a concrete next step.
// The two that trip writers up most are using an HTTPS URL for a private repo
// (this app can't show a sign-in prompt) and not having an SSH key on GitHub.
func friendlyCloneError(url string, err error) error {
	msg := err.Error()
	isSSH := strings.HasPrefix(url, "git@") || strings.HasPrefix(url, "ssh://")

	switch {
	// HTTPS auth: git wanted a username/password but can't prompt from a GUI app.
	case strings.Contains(msg, "could not read Username") ||
		strings.Contains(msg, "terminal prompts disabled") ||
		strings.Contains(msg, "Authentication failed"):
		return fmt.Errorf("couldn’t sign in to that repository. For a private repository, use an SSH URL like git@github.com:you/your-novel.git — this app can’t enter a password for an https:// URL. Make sure an SSH key for this Mac is added to your GitHub account.\n\n%s", msg)

	// SSH key present but GitHub rejected it (not added, or no access to this repo).
	case strings.Contains(msg, "Permission denied (publickey)") ||
		strings.Contains(msg, "publickey"):
		return fmt.Errorf("GitHub refused this Mac’s SSH key. Add the key to your GitHub account under Settings → SSH and GPG keys, and check that your account can access this repository.\n\n%s", msg)

	// First-ever connection to a host whose key isn't in known_hosts yet.
	case strings.Contains(msg, "Host key verification failed"):
		return fmt.Errorf("couldn’t verify the server’s identity. Open Terminal and run “ssh -T git@github.com” once to confirm the connection, then try again.\n\n%s", msg)

	// Wrong URL, or a private repo this account can't see (GitHub hides which).
	case strings.Contains(msg, "not found") ||
		strings.Contains(msg, "does not exist") ||
		strings.Contains(msg, "not read from remote repository"):
		hint := "Check the URL is correct and that your GitHub account has access to it."
		if !isSSH && strings.Contains(url, "github.com") {
			hint = "Check the URL, and for a private repository use an SSH URL (git@github.com:you/your-novel.git) so this app can authenticate."
		}
		return fmt.Errorf("couldn’t find that repository. %s\n\n%s", hint, msg)

	// No network / bad host.
	case strings.Contains(msg, "Could not resolve host") ||
		strings.Contains(msg, "unable to access") ||
		strings.Contains(msg, "Connection refused") ||
		strings.Contains(msg, "Connection timed out"):
		return fmt.Errorf("couldn’t reach the server. Check your internet connection and that the URL is correct.\n\n%s", msg)
	}
	return err
}

// GitPull fetches and merges changes from origin. --no-rebase keeps divergent
// histories as an explicit merge (or a conflict the writer can resolve in their
// files) rather than a surprising rebase.
func (a *App) GitPull(projectPath string) (GitState, error) {
	if _, err := runGit(projectPath, "pull", "--no-rebase"); err != nil {
		return GitState{}, err
	}
	return a.GitStatus(projectPath)
}

// GitLog returns the most recent commits, newest first, for the history list.
func (a *App) GitLog(projectPath string, limit int) ([]GitCommitInfo, error) {
	if limit <= 0 {
		limit = 20
	}
	// \x1f (unit separator) can't appear in the fields, so it's a safe delimiter.
	out, err := runGit(projectPath, "log", "-n", strconv.Itoa(limit),
		"--date=short", "--pretty=format:%h%x1f%ad%x1f%s")
	if err != nil {
		// An unborn branch (no commits yet) isn't an error for the UI.
		return []GitCommitInfo{}, nil
	}
	commits := []GitCommitInfo{}
	for _, line := range strings.Split(out, "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		if parts := strings.Split(line, "\x1f"); len(parts) == 3 {
			commits = append(commits, GitCommitInfo{Hash: parts[0], Date: parts[1], Message: parts[2]})
		}
	}
	return commits, nil
}
