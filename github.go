package main

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	goruntime "runtime"
	"strings"
	"time"
)

// In-app GitHub sign-in via the OAuth device flow — the same mechanism the gh
// CLI uses. The writer never types a password into the app: they confirm a short
// code in their browser, and GitHub hands us a token. We hand that token to
// git's own credential store (the macOS keychain), so `git push` and the GitHub
// API both authenticate without any further prompting.

// githubClientIDConst is this app's GitHub OAuth App client ID. Create one at
// GitHub → Settings → Developer settings → OAuth Apps → New OAuth App, tick
// "Enable Device Flow", and paste its Client ID here (it's not a secret). It can
// also be supplied at runtime via the env var below, which takes precedence.
const githubClientIDConst = "Ov23li6JrD9ypewLGM98"

func githubClientID() string {
	if id := strings.TrimSpace(os.Getenv("AUTHORS_WORKSHOP_GITHUB_CLIENT_ID")); id != "" {
		return id
	}
	return githubClientIDConst
}

var httpClient = &http.Client{Timeout: 20 * time.Second}

// GitHubLogin is the device-flow prompt shown to the user: enter UserCode at
// VerificationURI. DeviceCode + Interval are passed back to GitHubPollLogin.
type GitHubLogin struct {
	UserCode        string `json:"userCode"`
	VerificationURI string `json:"verificationUri"`
	DeviceCode      string `json:"deviceCode"`
	Interval        int    `json:"interval"`
}

// GitHubStartLogin asks GitHub for a device + user code to begin sign-in.
func (a *App) GitHubStartLogin() (GitHubLogin, error) {
	if githubClientID() == "" {
		return GitHubLogin{}, fmt.Errorf("GitHub sign-in isn’t set up in this build yet (missing OAuth client ID).")
	}
	m, err := postForm("https://github.com/login/device/code", url.Values{
		"client_id": {githubClientID()},
		"scope":     {"repo"},
	})
	if err != nil {
		return GitHubLogin{}, err
	}
	if e := str(m, "error_description"); e != "" {
		return GitHubLogin{}, fmt.Errorf("%s", e)
	}
	lg := GitHubLogin{
		UserCode:        str(m, "user_code"),
		VerificationURI: str(m, "verification_uri"),
		DeviceCode:      str(m, "device_code"),
		Interval:        intval(m, "interval"),
	}
	if lg.DeviceCode == "" || lg.UserCode == "" {
		return GitHubLogin{}, fmt.Errorf("GitHub didn’t return a sign-in code; please try again")
	}
	return lg, nil
}

// GitHubPollLogin waits for the user to authorize the device code in their
// browser, then stores the resulting token in git's credential store and returns
// the refreshed status. It blocks until GitHub responds, the code expires, or a
// ~15-minute safety timeout elapses.
func (a *App) GitHubPollLogin(projectPath, deviceCode string, interval int) (GitState, error) {
	if interval < 1 {
		interval = 5
	}
	deadline := time.Now().Add(15 * time.Minute)
	for time.Now().Before(deadline) {
		time.Sleep(time.Duration(interval) * time.Second)
		m, err := postForm("https://github.com/login/oauth/access_token", url.Values{
			"client_id":   {githubClientID()},
			"device_code": {deviceCode},
			"grant_type":  {"urn:ietf:params:oauth:grant-type:device_code"},
		})
		if err != nil {
			continue // transient network blip; keep waiting
		}
		if token := str(m, "access_token"); token != "" {
			login := githubAPIUser(token)
			if err := storeCredentials(projectPath, login, token); err != nil {
				return GitState{}, fmt.Errorf("signed in, but couldn’t save your GitHub credential: %w", err)
			}
			return a.GitStatus(projectPath)
		}
		switch str(m, "error") {
		case "authorization_pending":
			// keep waiting
		case "slow_down":
			interval += 5
		case "access_denied":
			return GitState{}, fmt.Errorf("sign-in was cancelled on GitHub")
		case "expired_token":
			return GitState{}, fmt.Errorf("the sign-in code expired — please try again")
		default:
			if e := str(m, "error_description"); e != "" {
				return GitState{}, fmt.Errorf("%s", e)
			}
		}
	}
	return GitState{}, fmt.Errorf("sign-in timed out — please try again")
}

// GitCreateRepo creates a private GitHub repository via the API, wires it up as
// "origin", and pushes the current branch. Requires a signed-in GitHub account.
func (a *App) GitCreateRepo(projectPath string) (GitState, error) {
	if _, err := os.Stat(filepath.Join(projectPath, ".git")); err != nil {
		return GitState{}, fmt.Errorf("turn on version history before backing up to GitHub")
	}
	_, token := githubCredentials(projectPath)
	if token == "" {
		return GitState{}, fmt.Errorf("sign in to GitHub first")
	}
	body, _ := json.Marshal(map[string]any{
		"name":    filepath.Base(projectPath),
		"private": true,
	})
	req, _ := http.NewRequest("POST", "https://api.github.com/user/repos", bytes.NewReader(body))
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("Content-Type", "application/json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return GitState{}, err
	}
	defer resp.Body.Close()
	var m map[string]any
	data, _ := io.ReadAll(resp.Body)
	json.Unmarshal(data, &m)
	if resp.StatusCode != http.StatusCreated {
		if e := str(m, "message"); e != "" {
			return GitState{}, fmt.Errorf("GitHub: %s", e)
		}
		return GitState{}, fmt.Errorf("GitHub returned status %d while creating the repository", resp.StatusCode)
	}
	cloneURL := str(m, "clone_url")
	if cloneURL == "" {
		return GitState{}, fmt.Errorf("GitHub didn’t return a repository URL")
	}
	if _, err := a.GitSetRemote(projectPath, cloneURL); err != nil {
		return GitState{}, err
	}
	return a.GitPush(projectPath)
}

// githubCredentials asks git for a stored github.com credential, returning the
// username and token (password). Empty token means "not signed in". With
// interactive prompts disabled, this never blocks — it just reports what's
// already stored in a credential helper.
func githubCredentials(projectPath string) (login, token string) {
	out, _ := runGitStdin(projectPath, "protocol=https\nhost=github.com\n\n", "credential", "fill")
	for _, line := range strings.Split(out, "\n") {
		if v, ok := strings.CutPrefix(line, "username="); ok {
			login = v
		} else if v, ok := strings.CutPrefix(line, "password="); ok {
			token = v
		}
	}
	return login, token
}

// storeCredentials saves a github.com token into git's credential store so
// future pushes authenticate silently. On macOS it makes sure a keychain helper
// is configured first, since a default git install may have none.
func storeCredentials(projectPath, login, token string) error {
	ensureCredentialHelper(projectPath)
	if login == "" {
		login = "x-access-token"
	}
	in := fmt.Sprintf("protocol=https\nhost=github.com\nusername=%s\npassword=%s\n\n", login, token)
	_, err := runGitStdin(projectPath, in, "credential", "approve")
	return err
}

// ensureCredentialHelper configures git's macOS keychain credential helper if
// the user hasn't set one, so storeCredentials has somewhere to persist to.
func ensureCredentialHelper(projectPath string) {
	if goruntime.GOOS != "darwin" {
		return
	}
	if out, _ := runGit(projectPath, "config", "--global", "credential.helper"); strings.TrimSpace(out) == "" {
		runGit(projectPath, "config", "--global", "credential.helper", "osxkeychain")
	}
}

// githubAPIUser returns the login name for a token, or "" if it can't be read.
func githubAPIUser(token string) string {
	req, _ := http.NewRequest("GET", "https://api.github.com/user", nil)
	req.Header.Set("Authorization", "token "+token)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return ""
	}
	defer resp.Body.Close()
	var m map[string]any
	data, _ := io.ReadAll(resp.Body)
	json.Unmarshal(data, &m)
	return str(m, "login")
}

// postForm POSTs a form-encoded body and decodes GitHub's JSON response.
func postForm(endpoint string, form url.Values) (map[string]any, error) {
	req, _ := http.NewRequest("POST", endpoint, strings.NewReader(form.Encode()))
	req.Header.Set("Accept", "application/json")
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := httpClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	var m map[string]any
	data, _ := io.ReadAll(resp.Body)
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, fmt.Errorf("unexpected response from GitHub")
	}
	return m, nil
}

func str(m map[string]any, key string) string {
	if v, ok := m[key].(string); ok {
		return v
	}
	return ""
}

func intval(m map[string]any, key string) int {
	if v, ok := m[key].(float64); ok {
		return int(v)
	}
	return 0
}
