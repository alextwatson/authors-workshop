import { useEffect, useState } from "react";
import {
    GitStatus,
    GitInit,
    GitCommit,
    GitCreateRepo,
    GitSetRemote,
    GitPush,
    GitPull,
    GitLog,
    OpenURL,
    GitHubStartLogin,
    GitHubPollLogin,
} from "../../../wailsjs/go/main/App";
import { main } from "../../../wailsjs/go/models";
import { blurOnEnter } from "../../ui";

// Optional, opt-in version control backed by the system `git` binary, framed for
// writers rather than developers: "save a version" instead of commit, "back up
// to GitHub" instead of push. GitHub sign-in happens in-app via the OAuth device
// flow; the token lives in git's keychain credential store, not in the app.

// webURL turns a clone URL (https or git@) into a browsable repo page, or "".
function webURL(remote: string): string {
    let u = remote.trim().replace(/\.git$/, "");
    const ssh = u.match(/^git@([^:]+):(.+)$/);
    if (ssh) u = `https://${ssh[1]}/${ssh[2]}`;
    return u.startsWith("http") ? u : "";
}

export default function VersionControlSettings({ projectPath }: { projectPath: string }) {
    const [status, setStatus] = useState<main.GitState | null>(null);
    const [history, setHistory] = useState<main.GitCommitInfo[]>([]);
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [message, setMessage] = useState("");
    const [commitMsg, setCommitMsg] = useState("");
    const [remote, setRemote] = useState("");
    const [remoteDirty, setRemoteDirty] = useState(false);
    const [showLink, setShowLink] = useState(false); // manual "I already have a repo" / change
    const [login, setLogin] = useState<main.GitHubLogin | null>(null); // pending device-flow prompt

    async function load(st: main.GitState) {
        setStatus(st);
        if (!remoteDirty) setRemote(st.remoteUrl || "");
        if (st.isRepo) {
            try {
                setHistory(await GitLog(projectPath, 10));
            } catch {
                setHistory([]);
            }
        }
    }

    useEffect(() => {
        let cancelled = false;
        GitStatus(projectPath)
            .then((st) => {
                if (!cancelled) load(st);
            })
            .catch((err) => {
                if (!cancelled) setError(String(err));
            });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [projectPath]);

    // Shared wrapper for a backend call that returns fresh status.
    async function run(okMessage: string, fn: () => Promise<main.GitState>) {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            await load(await fn());
            if (okMessage) setMessage(okMessage);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    }

    // Save a version, and — when connected to GitHub — back it up in the same step,
    // so a writer never has to think about a separate "upload" action.
    async function saveVersion() {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            let st = await GitCommit(projectPath, commitMsg);
            setCommitMsg("");
            if (st.hasRemote) {
                try {
                    st = await GitPush(projectPath);
                    setMessage("Version saved and backed up to GitHub.");
                } catch (err) {
                    setError(`Saved on this computer, but couldn’t reach GitHub: ${err}`);
                }
            } else {
                setMessage("Version saved on this computer.");
            }
            await load(st);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    }

    // GitHub device-flow sign-in: get a code, open the browser, then wait for the
    // writer to confirm. The code stays on screen until GitHub responds.
    async function signIn() {
        setError("");
        setMessage("");
        let lg: main.GitHubLogin;
        try {
            lg = await GitHubStartLogin();
        } catch (err) {
            setError(String(err));
            return;
        }
        setLogin(lg);
        OpenURL(lg.verificationUri);
        setBusy(true);
        try {
            const st = await GitHubPollLogin(projectPath, lg.deviceCode, lg.interval);
            await load(st);
            setMessage(`Signed in to GitHub${st.githubUser ? ` as ${st.githubUser}` : ""}.`);
        } catch (err) {
            setError(String(err));
        } finally {
            setLogin(null);
            setBusy(false);
        }
    }

    // Point at an existing GitHub repo and immediately back up to it.
    async function connectRemote() {
        setBusy(true);
        setError("");
        setMessage("");
        try {
            let st = await GitSetRemote(projectPath, remote);
            setRemoteDirty(false);
            if (st.hasRemote) {
                try {
                    st = await GitPush(projectPath);
                    setMessage("Connected and backed up to GitHub.");
                } catch (err) {
                    setError(`Connected, but couldn’t back up: ${err}`);
                }
            }
            await load(st);
        } catch (err) {
            setError(String(err));
        } finally {
            setBusy(false);
        }
    }

    if (status && !status.available) {
        return (
            <>
                <p className="subtitle">
                    This feature needs Git, which isn’t installed on this computer. Once Git
                    is installed, reopen this project to use it.
                </p>
            </>
        );
    }

    const repoURL = status ? webURL(status.remoteUrl) : "";

    return (
        <>
            <p className="subtitle">
                Save snapshots of your book as you write — so you can look back at, or
                return to, any earlier draft — and back them up to GitHub so your work is
                safe and on all your devices.
            </p>

            {/* Not turned on yet. */}
            {status && !status.isRepo && (
                <div className="settings-form">
                    <p className="subtitle">
                        Turn this on to start keeping a history of your drafts. It just saves
                        snapshots inside your project folder — nothing leaves your computer
                        until you choose to back up to GitHub.
                    </p>
                    <div className="export-buttons">
                        <button
                            type="button"
                            disabled={busy}
                            onClick={() => run("Version history turned on.", () => GitInit(projectPath))}
                        >
                            Turn on version history
                        </button>
                    </div>
                </div>
            )}

            {status && status.isRepo && (
                <div className="settings-form">
                    {/* Plain-language status of where the book currently lives. */}
                    {!status.hasRemote ? (
                        <div className="git-banner info">
                            Your version history is saved on <strong>this computer only</strong>.
                            Back up to GitHub below to keep it safe online.
                        </div>
                    ) : status.ahead > 0 ? (
                        <div className="git-banner warn">
                            <span>
                                {status.ahead} saved version{status.ahead === 1 ? "" : "s"} not backed
                                up to GitHub yet.
                            </span>
                            <button type="button" disabled={busy} onClick={() => run("Backed up to GitHub.", () => GitPush(projectPath))}>
                                Back up now
                            </button>
                        </div>
                    ) : status.dirty ? (
                        <div className="git-banner info">
                            You have changes that aren’t saved as a version yet.
                        </div>
                    ) : (
                        <div className="git-banner ok">
                            <span>✓ Your book is backed up to GitHub.</span>
                            {repoURL && (
                                <button type="button" className="linklike" onClick={() => OpenURL(repoURL)}>
                                    View on GitHub
                                </button>
                            )}
                        </div>
                    )}

                    {/* Save a version (also backs up when connected). */}
                    <label>
                        What changed? (optional)
                        <input
                            value={commitMsg}
                            placeholder="e.g. Finished chapter 3 draft"
                            disabled={busy}
                            onChange={(e) => setCommitMsg(e.target.value)}
                            onKeyDown={blurOnEnter}
                        />
                    </label>
                    <div className="export-buttons">
                        <button type="button" disabled={busy || !status.dirty} onClick={saveVersion}>
                            Save a version
                        </button>
                    </div>
                    <p className="subtitle">
                        {status.hasRemote
                            ? "Records a snapshot and backs it up to GitHub in one step."
                            : "Records a snapshot you can return to later."}
                    </p>

                    {/* GitHub connection. */}
                    {status.hasRemote ? (
                        <>
                            <div className="settings-subhead">GitHub</div>
                            <p className="subtitle">
                                Connected{" "}
                                {repoURL ? (
                                    <button type="button" className="linklike" onClick={() => OpenURL(repoURL)}>
                                        {repoURL.replace(/^https?:\/\//, "")}
                                    </button>
                                ) : (
                                    "to your repository"
                                )}
                                . Your versions back up here when you save.
                            </p>
                            <div className="export-buttons">
                                <button
                                    type="button"
                                    disabled={busy}
                                    onClick={() => run("Updated from GitHub.", () => GitPull(projectPath))}
                                >
                                    Get latest from GitHub
                                </button>
                                <button type="button" className="linklike" onClick={() => setShowLink((v) => !v)}>
                                    Change or disconnect
                                </button>
                            </div>
                            {showLink && (
                                <>
                                    <label>
                                        Repository web address
                                        <input
                                            value={remote}
                                            disabled={busy}
                                            onChange={(e) => {
                                                setRemoteDirty(true);
                                                setRemote(e.target.value);
                                            }}
                                            onKeyDown={blurOnEnter}
                                        />
                                    </label>
                                    <div className="export-buttons">
                                        <button
                                            type="button"
                                            disabled={busy || remote.trim() === (status.remoteUrl || "")}
                                            onClick={() =>
                                                run("Repository updated.", () => GitSetRemote(projectPath, remote)).then(() => setRemoteDirty(false))
                                            }
                                        >
                                            Update
                                        </button>
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() =>
                                                run("Disconnected from GitHub.", () => GitSetRemote(projectPath, "")).then(() => {
                                                    setRemoteDirty(false);
                                                    setShowLink(false);
                                                })
                                            }
                                        >
                                            Disconnect
                                        </button>
                                    </div>
                                </>
                            )}
                        </>
                    ) : (
                        <>
                            <div className="settings-subhead">Back up to GitHub</div>

                            {login ? (
                                // Device-flow prompt: confirm this code in the browser.
                                <div className="git-banner info">
                                    <span>
                                        In your browser, enter this code to finish signing in:{" "}
                                        <strong className="git-code">{login.userCode}</strong>
                                    </span>
                                    <button type="button" className="linklike" onClick={() => OpenURL(login.verificationUri)}>
                                        Open GitHub again
                                    </button>
                                </div>
                            ) : !status.signedIn ? (
                                <>
                                    <p className="subtitle">
                                        Sign in to GitHub to keep your book backed up online. A short code
                                        will appear — confirm it in your browser, and you’re done. You only
                                        do this once on this computer.
                                    </p>
                                    <div className="export-buttons">
                                        <button type="button" disabled={busy} onClick={signIn}>
                                            Sign in to GitHub
                                        </button>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="subtitle">
                                        Signed in{status.githubUser ? ` as ${status.githubUser}` : ""}. Create
                                        a free, <strong>private</strong> repository (only you can see it) and
                                        back up your book to it.
                                    </p>
                                    <div className="export-buttons">
                                        <button
                                            type="button"
                                            disabled={busy}
                                            onClick={() => run("Backed up to GitHub.", () => GitCreateRepo(projectPath))}
                                        >
                                            Back up to GitHub
                                        </button>
                                        <button type="button" className="linklike" onClick={() => setShowLink((v) => !v)}>
                                            I already have a repository
                                        </button>
                                    </div>
                                    {showLink && (
                                        <>
                                            <label>
                                                Repository web address
                                                <input
                                                    value={remote}
                                                    placeholder="https://github.com/you/your-novel.git"
                                                    disabled={busy}
                                                    onChange={(e) => {
                                                        setRemoteDirty(true);
                                                        setRemote(e.target.value);
                                                    }}
                                                    onKeyDown={blurOnEnter}
                                                />
                                            </label>
                                            <div className="export-buttons">
                                                <button
                                                    type="button"
                                                    disabled={busy || !remote.trim()}
                                                    onClick={connectRemote}
                                                >
                                                    Connect &amp; back up
                                                </button>
                                            </div>
                                        </>
                                    )}
                                </>
                            )}
                        </>
                    )}

                    {history.length > 0 && (
                        <div className="git-history">
                            <div className="subtitle">Recent versions</div>
                            <ul>
                                {history.map((c) => (
                                    <li key={c.hash}>
                                        <span className="git-history-date">{c.date}</span>
                                        <span className="git-history-msg">{c.message}</span>
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            )}

            {busy && (
                <div className="save-status saving">
                    {login ? "Waiting for you to confirm on GitHub…" : "Working…"}
                </div>
            )}
            {message && !busy && <div className="save-status saved">{message}</div>}
            {error && <div className="save-status error">{error}</div>}
        </>
    );
}
