use crate::error::AppError;
use crate::git::{inspect_repo, inspect_workspace, list_repo_branches, run_git};
use crate::models::{
    AppVersionInfo, ChangelogRelease, ChangelogSection, LogPayload, RepoStatus, RepoSyncTarget,
    SyncStrategy,
};
use crate::scanner::scan_for_repos;
use crate::watcher::{start_workspace_watcher, WatcherState};
use std::path::Path;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

const BUNDLED_CHANGELOG: &str = include_str!("../../CHANGELOG.md");

fn flush_section(
    current_release: &mut Option<ChangelogRelease>,
    current_section: &mut Option<ChangelogSection>,
) {
    if let (Some(release), Some(section)) = (current_release.as_mut(), current_section.take()) {
        if !section.items.is_empty() {
            release.sections.push(section);
        }
    }
}

fn parse_release_header(line: &str) -> Option<(String, String)> {
    let rest = line.strip_prefix("## ")?.trim();
    if let Some((ver_part, date_part)) = rest.split_once(" - ") {
        let version = ver_part
            .trim()
            .trim_start_matches('[')
            .trim_end_matches(']')
            .trim();
        let date = date_part.trim();
        if !version.is_empty() {
            return Some((version.to_string(), date.to_string()));
        }
    } else {
        let version = rest.trim_start_matches('[').trim_end_matches(']').trim();
        if !version.is_empty() {
            return Some((version.to_string(), String::new()));
        }
    }
    None
}

pub fn parse_changelog(markdown: &str) -> Vec<ChangelogRelease> {
    let mut releases = Vec::new();
    let mut current_release: Option<ChangelogRelease> = None;
    let mut current_section: Option<ChangelogSection> = None;

    for raw_line in markdown.lines() {
        let trimmed = raw_line.trim();
        if let Some((version, date)) = parse_release_header(trimmed) {
            flush_section(&mut current_release, &mut current_section);
            if let Some(release) = current_release.take() {
                releases.push(release);
            }
            current_release = Some(ChangelogRelease {
                version,
                date,
                sections: Vec::new(),
            });
            continue;
        }

        if let Some(category) = trimmed.strip_prefix("### ") {
            if current_release.is_some() {
                flush_section(&mut current_release, &mut current_section);
                current_section = Some(ChangelogSection {
                    category: category.trim().to_string(),
                    items: Vec::new(),
                });
            }
            continue;
        }

        if let Some(item) = trimmed
            .strip_prefix("- ")
            .or_else(|| trimmed.strip_prefix("* "))
        {
            let item_text = item.trim();
            if item_text.is_empty() || current_release.is_none() {
                continue;
            }
            if current_section.is_none() {
                current_section = Some(ChangelogSection {
                    category: "Changes".to_string(),
                    items: Vec::new(),
                });
            }
            if let Some(section) = current_section.as_mut() {
                section.items.push(item_text.to_string());
            }
        }
    }

    flush_section(&mut current_release, &mut current_section);
    if let Some(release) = current_release {
        releases.push(release);
    }

    releases
}

#[tauri::command]
#[specta::specta]
pub fn get_app_version_info() -> AppVersionInfo {
    let releases = parse_changelog(BUNDLED_CHANGELOG);
    AppVersionInfo {
        name: "Mainline".to_string(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        raw_changelog: BUNDLED_CHANGELOG.to_string(),
        releases,
    }
}

fn emit_log(app: &AppHandle, repo_path: &str, line: impl Into<String>, is_stderr: bool) {
    let text = line.into();
    if text.trim().is_empty() {
        return;
    }
    let _ = app.emit(
        "git-log",
        LogPayload {
            repo_path: repo_path.to_string(),
            line: text,
            is_stderr,
        },
    );
}

#[tauri::command]
#[specta::specta]
pub async fn scan_workspace(
    app_handle: AppHandle,
    watcher_state: State<'_, WatcherState>,
    root_path: String,
    include_submodules: Option<bool>,
) -> Result<Vec<RepoStatus>, AppError> {
    let root = Path::new(&root_path);
    let paths = scan_for_repos(root, include_submodules.unwrap_or(false))?;
    let statuses = inspect_workspace(paths, root).await;

    // Best-effort start/update of persistent watcher for active workspace root
    let _ = start_workspace_watcher(&watcher_state, app_handle, root);

    Ok(statuses)
}

#[tauri::command]
#[specta::specta]
pub async fn watch_workspace(
    app_handle: AppHandle,
    watcher_state: State<'_, WatcherState>,
    root_path: String,
) -> Result<(), AppError> {
    start_workspace_watcher(&watcher_state, app_handle, Path::new(&root_path))
}

#[tauri::command]
#[specta::specta]
pub async fn refresh_repo(repo_path: String, root_path: String) -> Result<RepoStatus, AppError> {
    inspect_repo(Path::new(&repo_path), Path::new(&root_path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn list_branches(repo_path: String) -> Result<Vec<String>, AppError> {
    list_repo_branches(Path::new(&repo_path)).await
}

#[tauri::command]
#[specta::specta]
pub async fn switch_branch(repo_path: String, target_branch: String) -> Result<(), AppError> {
    run_git(Path::new(&repo_path), &["checkout", &target_branch])
        .await
        .map(|_| ())
}

async fn run_sync_steps(target: &RepoSyncTarget, strategy: &SyncStrategy) -> Vec<LogPayload> {
    let path = Path::new(&target.absolute_path);
    let mut logs = Vec::new();
    let push_log = |logs: &mut Vec<LogPayload>, line: String, is_stderr: bool| {
        if !line.trim().is_empty() {
            logs.push(LogPayload {
                repo_path: target.absolute_path.clone(),
                line,
                is_stderr,
            });
        }
    };

    match strategy {
        SyncStrategy::FetchOnly => match run_git(path, &["fetch", "--all", "--prune"]).await {
            Ok(out) => push_log(
                &mut logs,
                if out.is_empty() {
                    "Fetched remotes (--all --prune)".to_string()
                } else {
                    out
                },
                false,
            ),
            Err(e) => push_log(&mut logs, e.to_string(), true),
        },
        SyncStrategy::PullFastForwardOnly => {
            if target.reset_to_default && !target.branch.is_empty() {
                if let Err(e) = run_git(path, &["checkout", &target.branch]).await {
                    push_log(&mut logs, e.to_string(), true);
                    return logs;
                }
                push_log(
                    &mut logs,
                    format!("Switched to branch {}", target.branch),
                    false,
                );
            }
            match run_git(path, &["pull", "--ff-only"]).await {
                Ok(out) => push_log(&mut logs, out, false),
                Err(e) => push_log(&mut logs, e.to_string(), true),
            }
        }
        SyncStrategy::StashAndPull => {
            let stash_res = run_git(
                path,
                &["stash", "push", "--include-untracked", "-m", "Mainline auto-stash"],
            )
            .await;

            let did_stash = match stash_res {
                Ok(out) => {
                    let created = !out.contains("No local changes to save");
                    push_log(&mut logs, out, false);
                    created
                }
                Err(e) => {
                    push_log(&mut logs, e.to_string(), true);
                    return logs;
                }
            };

            if target.reset_to_default && !target.branch.is_empty() {
                if let Err(e) = run_git(path, &["checkout", &target.branch]).await {
                    push_log(&mut logs, e.to_string(), true);
                    if did_stash {
                        let _ = run_git(path, &["stash", "pop"]).await;
                    }
                    return logs;
                }
            }

            match run_git(path, &["pull", "--ff-only"]).await {
                Ok(out) => push_log(&mut logs, out, false),
                Err(e) => {
                    push_log(&mut logs, e.to_string(), true);
                    if did_stash {
                        match run_git(path, &["stash", "pop"]).await {
                            Ok(pop_out) => push_log(&mut logs, pop_out, false),
                            Err(pop_err) => push_log(
                                &mut logs,
                                format!("Stash pop conflict/error: {}", pop_err),
                                true,
                            ),
                        }
                    }
                    return logs;
                }
            }

            if did_stash {
                match run_git(path, &["stash", "pop"]).await {
                    Ok(pop_out) => push_log(&mut logs, pop_out, false),
                    Err(pop_err) => push_log(
                        &mut logs,
                        format!("Stash pop conflict/error: {}", pop_err),
                        true,
                    ),
                }
            }
        }
        SyncStrategy::HardResetAndPull => {
            if let Err(e) = run_git(path, &["reset", "--hard", "HEAD"]).await {
                push_log(&mut logs, e.to_string(), true);
                return logs;
            }
            if let Err(e) = run_git(path, &["clean", "-fd"]).await {
                push_log(&mut logs, e.to_string(), true);
                return logs;
            }
            push_log(
                &mut logs,
                "Hard reset working tree and cleaned untracked files".to_string(),
                false,
            );

            if target.reset_to_default && !target.branch.is_empty() {
                if let Err(e) = run_git(path, &["checkout", &target.branch]).await {
                    push_log(&mut logs, e.to_string(), true);
                    return logs;
                }
            }

            match run_git(path, &["pull", "--ff-only"]).await {
                Ok(out) => push_log(&mut logs, out, false),
                Err(e) => push_log(&mut logs, e.to_string(), true),
            }
        }
    }

    logs
}

async fn execute_sync_target(app: &AppHandle, target: &RepoSyncTarget, strategy: &SyncStrategy) {
    for log in run_sync_steps(target, strategy).await {
        emit_log(app, &log.repo_path, log.line, log.is_stderr);
    }
}

#[tauri::command]
#[specta::specta]
pub async fn sync_repos(
    app_handle: AppHandle,
    targets: Vec<RepoSyncTarget>,
    strategy: SyncStrategy,
) -> Result<(), AppError> {
    let semaphore = Arc::new(Semaphore::new(4));
    let mut join_set = JoinSet::new();

    for target in targets {
        let sem = Arc::clone(&semaphore);
        let app = app_handle.clone();
        let strat = strategy.clone();
        join_set.spawn(async move {
            let Ok(_permit) = sem.acquire().await else {
                return;
            };
            execute_sync_target(&app, &target, &strat).await;
        });
    }

    while join_set.join_next().await.is_some() {}
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use std::io::Write;
    use std::process::Command;
    use tempfile::TempDir;

    fn git_sync(dir: &Path, args: &[&str]) {
        let out = Command::new("git")
            .args(args)
            .current_dir(dir)
            .output()
            .unwrap();
        assert!(
            out.status.success(),
            "git {:?} failed: {}",
            args,
            String::from_utf8_lossy(&out.stderr)
        );
    }

    fn setup_remote_and_clone() -> (TempDir, std::path::PathBuf, std::path::PathBuf) {
        let temp = TempDir::new().unwrap();
        let remote = temp.path().join("remote.git");
        let seed = temp.path().join("seed");
        let clone = temp.path().join("clone");

        fs::create_dir_all(&remote).unwrap();
        git_sync(&remote, &["init", "--bare", "-b", "main"]);

        git_sync(temp.path(), &["clone", remote.to_str().unwrap(), "seed"]);
        git_sync(&seed, &["config", "user.name", "Test"]);
        git_sync(&seed, &["config", "user.email", "test@test.com"]);
        let mut f = File::create(seed.join("README.md")).unwrap();
        writeln!(f, "v1").unwrap();
        git_sync(&seed, &["add", "."]);
        git_sync(&seed, &["commit", "-m", "v1"]);
        git_sync(&seed, &["push", "-u", "origin", "main"]);

        git_sync(temp.path(), &["clone", remote.to_str().unwrap(), "clone"]);
        git_sync(&clone, &["config", "user.name", "Test"]);
        git_sync(&clone, &["config", "user.email", "test@test.com"]);

        // Advance remote from seed
        let mut f2 = File::create(seed.join("remote_update.txt")).unwrap();
        writeln!(f2, "v2").unwrap();
        git_sync(&seed, &["add", "."]);
        git_sync(&seed, &["commit", "-m", "v2"]);
        git_sync(&seed, &["push", "origin", "main"]);

        (temp, remote, clone)
    }

    #[tokio::test]
    async fn test_stash_and_pull_preserves_uncommitted_changes() {
        let (_temp, _remote, clone) = setup_remote_and_clone();
        // Make uncommitted local edit in clone (non-conflicting file)
        let mut local = File::create(clone.join("local_work.txt")).unwrap();
        writeln!(local, "wip").unwrap();

        let target = RepoSyncTarget {
            absolute_path: clone.to_string_lossy().to_string(),
            branch: "main".to_string(),
            reset_to_default: false,
        };
        let logs = run_sync_steps(&target, &SyncStrategy::StashAndPull).await;
        assert!(
            logs.iter().all(|l| !l.is_stderr),
            "unexpected stderr logs: {:?}",
            logs
        );
        assert!(clone.join("remote_update.txt").exists());
        assert!(clone.join("local_work.txt").exists());
    }

    #[tokio::test]
    async fn test_hard_reset_and_pull_discards_dirty_and_switches_branch() {
        let (_temp, _remote, clone) = setup_remote_and_clone();
        git_sync(&clone, &["checkout", "-b", "feature/discard"]);
        let mut local = File::create(clone.join("untracked.txt")).unwrap();
        writeln!(local, "discard me").unwrap();

        let target = RepoSyncTarget {
            absolute_path: clone.to_string_lossy().to_string(),
            branch: "main".to_string(),
            reset_to_default: true,
        };
        let logs = run_sync_steps(&target, &SyncStrategy::HardResetAndPull).await;
        assert!(
            logs.iter().all(|l| !l.is_stderr),
            "unexpected stderr logs: {:?}",
            logs
        );
        assert!(!clone.join("untracked.txt").exists());
        assert!(clone.join("remote_update.txt").exists());
        let status = inspect_repo(&clone, &clone).await.unwrap();
        assert_eq!(status.current_branch, "main");
        assert!(!status.is_dirty);
    }

    #[test]
    fn test_parse_changelog_parses_multiple_releases() {
        let sample = "\
# Changelog

All notable changes to Mainline.

## [0.2.0] - 2026-11-23

### Features
- Add automated versioning
- Add About screen

### Bug Fixes
- Fix watcher debounce

## [0.1.0] - 2026-11-21

### Features
- Initial release
";

        let releases = parse_changelog(sample);
        assert_eq!(releases.len(), 2);

        assert_eq!(releases[0].version, "0.2.0");
        assert_eq!(releases[0].date, "2026-11-23");
        assert_eq!(releases[0].sections.len(), 2);
        assert_eq!(releases[0].sections[0].category, "Features");
        assert_eq!(
            releases[0].sections[0].items,
            vec!["Add automated versioning", "Add About screen"]
        );
        assert_eq!(releases[0].sections[1].category, "Bug Fixes");
        assert_eq!(
            releases[0].sections[1].items,
            vec!["Fix watcher debounce"]
        );

        assert_eq!(releases[1].version, "0.1.0");
        assert_eq!(releases[1].date, "2026-11-21");
        assert_eq!(releases[1].sections.len(), 1);
        assert_eq!(releases[1].sections[0].items, vec!["Initial release"]);
    }

    #[test]
    fn test_get_app_version_info_and_manifest_sync() {
        let info = get_app_version_info();
        assert_eq!(info.name, "Mainline");
        assert!(!info.version.is_empty());
        assert_eq!(info.version, env!("CARGO_PKG_VERSION"));
        assert!(!info.raw_changelog.is_empty());
        assert!(!info.releases.is_empty());

        let manifest_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
        let pkg_json: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(manifest_dir.join("../package.json")).unwrap(),
        )
        .unwrap();
        let tauri_conf: serde_json::Value = serde_json::from_str(
            &fs::read_to_string(manifest_dir.join("tauri.conf.json")).unwrap(),
        )
        .unwrap();

        assert_eq!(
            pkg_json["version"].as_str().unwrap(),
            info.version,
            "package.json version must stay synchronized with Cargo.toml"
        );
        assert_eq!(
            tauri_conf["version"].as_str().unwrap(),
            info.version,
            "tauri.conf.json version must stay synchronized with Cargo.toml"
        );
    }
}
