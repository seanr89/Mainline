use crate::error::AppError;
use crate::models::{
    BranchPruneOutcome, BranchPruneTarget, DefunctBranchInfo, GitProvider, LogPayload,
    RepoDefunctBranches, RepoScanTarget, RepoStatus,
};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio::process::Command as AsyncCommand;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;

/// Execute a git CLI command non-interactively in `repo_path`.
pub async fn run_git(repo_path: &Path, args: &[&str]) -> Result<String, AppError> {
    let output = AsyncCommand::new("git")
        .args(args)
        .current_dir(repo_path)
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("LC_MESSAGES", "C")
        .output()
        .await
        .map_err(|e| AppError::Io(e.to_string()))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let message = if !stderr.is_empty() { stderr } else { stdout };
        return Err(AppError::GitExecution {
            code: output.status.code().unwrap_or(-1),
            message,
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim_end().to_string())
}

fn provider_from_url(remote_url: &Option<String>) -> GitProvider {
    match remote_url {
        Some(url) if url.contains("github.com") => GitProvider::GitHub,
        Some(url) if url.contains("gitlab.com") => GitProvider::GitLab,
        Some(url) if url.contains("bitbucket.org") => GitProvider::Bitbucket,
        Some(url) => GitProvider::Custom(url.clone()),
        None => GitProvider::Custom("Local".to_string()),
    }
}

fn parse_origin_url_from_git_config(config: &str) -> Option<String> {
    let mut in_origin = false;
    for raw_line in config.lines() {
        let line = raw_line.trim();
        if line.starts_with('[') {
            in_origin = line.eq_ignore_ascii_case("[remote \"origin\"]");
            continue;
        }
        if in_origin {
            if let Some((key, val)) = line.split_once('=') {
                if key.trim().eq_ignore_ascii_case("url") {
                    let url = val.trim();
                    if !url.is_empty() {
                        return Some(url.to_string());
                    }
                }
            }
        }
    }
    None
}

async fn resolve_remote_and_default_branch(repo_path: &Path) -> (Option<String>, String) {
    let dot_git = repo_path.join(".git");
    if dot_git.is_dir() {
        let config_future = tokio::fs::read_to_string(dot_git.join("config"));
        let origin_head_future = tokio::fs::read_to_string(dot_git.join("refs/remotes/origin/HEAD"));
        let main_ref_exists = dot_git.join("refs/heads/main").exists();
        let master_ref_exists = dot_git.join("refs/heads/master").exists();

        let (config_res, origin_head_res) = tokio::join!(config_future, origin_head_future);
        let remote_url = config_res
            .ok()
            .and_then(|cfg| parse_origin_url_from_git_config(&cfg));

        if let Ok(head_ref) = origin_head_res {
            if let Some(branch) = head_ref.trim().strip_prefix("ref: refs/remotes/origin/") {
                if !branch.is_empty() {
                    return (remote_url, branch.to_string());
                }
            }
        }

        // Fall back to packed-refs or symbolic-ref only when needed, otherwise check local refs.
        if main_ref_exists {
            return (remote_url, "main".to_string());
        }
        if master_ref_exists {
            return (remote_url, "master".to_string());
        }

        if let Ok(sym) = run_git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"]).await {
            if let Some(branch) = sym.trim().strip_prefix("refs/remotes/origin/") {
                if !branch.is_empty() {
                    return (remote_url, branch.to_string());
                }
            }
        }

        return (remote_url, "main".to_string());
    }

    // Submodule `.git` file fallback
    let (remote_res, default_res) = tokio::join!(
        run_git(repo_path, &["remote", "get-url", "origin"]),
        run_git(repo_path, &["symbolic-ref", "refs/remotes/origin/HEAD"])
    );
    let remote_url = remote_res.ok().filter(|s| !s.is_empty());
    let default_branch = default_res
        .ok()
        .and_then(|r| {
            r.trim()
                .strip_prefix("refs/remotes/origin/")
                .map(|s| s.to_string())
        })
        .unwrap_or_else(|| "main".to_string());

    (remote_url, default_branch)
}

/// Inspect a single Git repository concurrently for branch, ahead/behind, dirty state,
/// stash count, remote provider, and latest commit metadata.
pub async fn inspect_repo(repo_path: &Path, root: &Path) -> Result<RepoStatus, AppError> {
    let name = repo_path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Unknown".to_string());

    let rel = repo_path
        .strip_prefix(root)
        .unwrap_or(repo_path)
        .to_string_lossy()
        .to_string();
    let relative_path = if rel.is_empty() {
        ".".to_string()
    } else {
        rel
    };

    let (status_res, log_res, (remote_url, mut default_branch)) = tokio::join!(
        run_git(
            repo_path,
            &["status", "--porcelain=v2", "--branch", "--show-stash"]
        ),
        run_git(repo_path, &["log", "-1", "--format=%h|%at|%s"]),
        resolve_remote_and_default_branch(repo_path)
    );

    let status_v2 = status_res?;

    let mut current_branch = String::new();
    let mut is_detached = false;
    let mut ahead_count: u32 = 0;
    let mut behind_count: u32 = 0;
    let mut stashed_count: u32 = 0;
    let mut is_dirty = false;
    let mut head_oid: Option<String> = None;

    for line in status_v2.lines() {
        if let Some(oid) = line.strip_prefix("# branch.oid ") {
            let trimmed = oid.trim();
            if trimmed != "(initial)" {
                head_oid = Some(trimmed.chars().take(7).collect());
            }
        } else if let Some(head) = line.strip_prefix("# branch.head ") {
            let trimmed = head.trim();
            if trimmed == "(detached)" {
                is_detached = true;
            } else {
                current_branch = trimmed.to_string();
            }
        } else if let Some(ab) = line.strip_prefix("# branch.ab ") {
            let mut parts = ab.split_whitespace();
            if let (Some(ahead), Some(behind)) = (parts.next(), parts.next()) {
                ahead_count = ahead.trim_start_matches('+').parse().unwrap_or(0);
                behind_count = behind.trim_start_matches('-').parse().unwrap_or(0);
            }
        } else if let Some(stash) = line.strip_prefix("# stash ") {
            stashed_count = stash.trim().parse().unwrap_or(0);
        } else if !line.starts_with('#') && !line.trim().is_empty() {
            is_dirty = true;
        }
    }

    if is_detached {
        current_branch = match head_oid {
            Some(short) => format!("HEAD ({})", short),
            None => "HEAD".to_string(),
        };
    } else if current_branch.is_empty() {
        current_branch = "HEAD".to_string();
    }

    if default_branch == "main" && current_branch == "master" {
        default_branch = "master".to_string();
    }

    let provider = provider_from_url(&remote_url);

    let (last_commit_hash, last_commit_timestamp, last_commit_title) = match log_res {
        Ok(log_raw) => {
            let log_parts: Vec<&str> = log_raw.splitn(3, '|').collect();
            if log_parts.len() == 3 {
                (
                    log_parts[0].to_string(),
                    log_parts[1].parse::<f64>().unwrap_or(0.0),
                    log_parts[2].to_string(),
                )
            } else {
                (String::new(), 0.0, "No commits".to_string())
            }
        }
        Err(_) => (String::new(), 0.0, "No commits".to_string()),
    };

    Ok(RepoStatus {
        name,
        relative_path,
        absolute_path: repo_path.to_string_lossy().to_string(),
        current_branch,
        default_branch,
        ahead_count,
        behind_count,
        is_dirty,
        stashed_count,
        remote_url,
        provider,
        is_detached,
        last_commit_title,
        last_commit_hash,
        last_commit_timestamp,
    })
}

/// List local branches for a repository sorted by name.
pub async fn list_repo_branches(repo_path: &Path) -> Result<Vec<String>, AppError> {
    let raw = run_git(
        repo_path,
        &["for-each-ref", "--format=%(refname:short)", "refs/heads"],
    )
    .await?;
    let mut branches: Vec<String> = raw
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect();
    branches.sort();
    Ok(branches)
}

/// Inspect a list of discovered repositories using a bounded async worker pool (max 8 concurrent).
pub async fn inspect_workspace(paths: Vec<PathBuf>, root: &Path) -> Vec<RepoStatus> {
    let semaphore = Arc::new(Semaphore::new(8));
    let root_arc = Arc::new(root.to_path_buf());
    let mut join_set = JoinSet::new();

    for path in paths {
        let sem = Arc::clone(&semaphore);
        let root_ref = Arc::clone(&root_arc);
        join_set.spawn(async move {
            let _permit = sem.acquire().await.ok()?;
            inspect_repo(&path, &root_ref).await.ok()
        });
    }

    let mut results = Vec::new();
    while let Some(res) = join_set.join_next().await {
        if let Ok(Some(status)) = res {
            results.push(status);
        }
    }

    results.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.relative_path.cmp(&b.relative_path))
    });

    results
}

/// Inspect a repository for local branches whose remote tracking ref is `[gone]`.
/// Optionally runs `git fetch --all --prune` first; fetch failures are recorded in
/// `fetch_error` without aborting inspection of locally known `[gone]` refs.
pub async fn inspect_repo_defunct_branches(
    target: &RepoScanTarget,
    fetch_first: bool,
) -> (RepoDefunctBranches, Vec<LogPayload>) {
    let repo_path = Path::new(&target.absolute_path);
    let mut logs = Vec::new();
    let mut fetch_error: Option<String> = None;

    if fetch_first {
        match run_git(repo_path, &["fetch", "--all", "--prune"]).await {
            Ok(out) => {
                let line = if out.is_empty() {
                    "Fetched & pruned remotes (--all --prune)".to_string()
                } else {
                    out
                };
                logs.push(LogPayload {
                    repo_path: target.absolute_path.clone(),
                    line,
                    is_stderr: false,
                });
            }
            Err(e) => {
                let msg = e.to_string();
                logs.push(LogPayload {
                    repo_path: target.absolute_path.clone(),
                    line: msg.clone(),
                    is_stderr: true,
                });
                fetch_error = Some(msg);
            }
        }
    }

    let (_, mut default_branch) = resolve_remote_and_default_branch(repo_path).await;
    if default_branch.is_empty() && !target.default_branch.is_empty() {
        default_branch = target.default_branch.clone();
    }

    let current_branch = run_git(repo_path, &["symbolic-ref", "--short", "-q", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "HEAD".to_string());

    if default_branch == "main" && current_branch == "master" {
        default_branch = "master".to_string();
    }

    let origin_ref = format!("refs/remotes/origin/{default_branch}");
    let local_ref = format!("refs/heads/{default_branch}");
    let merge_base_ref = if run_git(repo_path, &["rev-parse", "--verify", "--quiet", &origin_ref])
        .await
        .is_ok()
    {
        Some(origin_ref)
    } else if run_git(repo_path, &["rev-parse", "--verify", "--quiet", &local_ref])
        .await
        .is_ok()
    {
        Some(local_ref)
    } else if run_git(repo_path, &["rev-parse", "--verify", "--quiet", "HEAD"])
        .await
        .is_ok()
    {
        Some("HEAD".to_string())
    } else {
        None
    };

    let merged_set: HashSet<String> = match merge_base_ref {
        Some(base_ref) => run_git(
            repo_path,
            &["branch", "--merged", &base_ref, "--format=%(refname:short)"],
        )
        .await
        .unwrap_or_default()
        .lines()
        .map(|l| l.trim().to_string())
        .filter(|l| !l.is_empty())
        .collect(),
        None => HashSet::new(),
    };

    let mut branches = Vec::new();
    match run_git(
        repo_path,
        &[
            "for-each-ref",
            "--format=%(refname:short)%1f%(upstream:short)%1f%(upstream:track)%1f%(HEAD)%1f%(objectname:short)%1f%(committerdate:unix)%1f%(contents:subject)",
            "refs/heads",
        ],
    )
    .await
    {
        Ok(raw) => {
            for line in raw.lines() {
                let parts: Vec<&str> = line.splitn(7, '\x1f').collect();
                if parts.len() != 7 {
                    continue;
                }
                let name = parts[0].trim();
                let upstream = parts[1].trim();
                let track = parts[2].trim();
                let head_marker = parts[3].trim();
                let last_commit_hash = parts[4].trim();
                let last_commit_timestamp = parts[5].trim().parse::<f64>().unwrap_or(0.0);
                let last_commit_title = parts[6].trim();

                if name.is_empty() || !track.contains("[gone]") {
                    continue;
                }

                let is_current = head_marker == "*" || current_branch == name;
                let is_default = name == default_branch;
                let can_delete = !is_current && !is_default;
                let is_merged = merged_set.contains(name);

                branches.push(DefunctBranchInfo {
                    name: name.to_string(),
                    upstream: upstream.to_string(),
                    last_commit_hash: last_commit_hash.to_string(),
                    last_commit_title: last_commit_title.to_string(),
                    last_commit_timestamp,
                    is_merged,
                    is_current,
                    is_default,
                    can_delete,
                });
            }
        }
        Err(e) => {
            let msg = e.to_string();
            logs.push(LogPayload {
                repo_path: target.absolute_path.clone(),
                line: msg.clone(),
                is_stderr: true,
            });
            if fetch_error.is_none() {
                fetch_error = Some(msg);
            }
        }
    }

    branches.sort_by(|a, b| {
        b.can_delete
            .cmp(&a.can_delete)
            .then_with(|| b.is_merged.cmp(&a.is_merged))
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    (
        RepoDefunctBranches {
            repo_name: target.repo_name.clone(),
            relative_path: target.relative_path.clone(),
            absolute_path: target.absolute_path.clone(),
            current_branch,
            default_branch,
            branches,
            fetch_error,
        },
        logs,
    )
}

/// Safely delete selected local branches in a single repository sequentially
/// (avoiding `.git/packed-refs.lock` contention), guarding against deleting the
/// currently checked-out branch, default branch, or invalid branch names.
pub async fn prune_repo_branches(
    repo_path: &Path,
    targets: &[BranchPruneTarget],
) -> (Vec<BranchPruneOutcome>, Vec<LogPayload>) {
    let repo_str = repo_path.to_string_lossy().to_string();
    let mut outcomes = Vec::with_capacity(targets.len());
    let mut logs = Vec::new();

    let live_current_branch = run_git(repo_path, &["symbolic-ref", "--short", "-q", "HEAD"])
        .await
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let (_, mut live_default_branch) = resolve_remote_and_default_branch(repo_path).await;
    if live_default_branch == "main" && live_current_branch.as_deref() == Some("master") {
        live_default_branch = "master".to_string();
    }

    for target in targets {
        let branch = target.branch_name.trim();
        if branch.is_empty() || branch.starts_with('-') {
            let msg = format!("Refused invalid branch name '{}'", target.branch_name);
            logs.push(LogPayload {
                repo_path: repo_str.clone(),
                line: msg.clone(),
                is_stderr: true,
            });
            outcomes.push(BranchPruneOutcome {
                repo_path: repo_str.clone(),
                branch_name: target.branch_name.clone(),
                deleted: false,
                forced: target.force,
                error: Some(msg),
            });
            continue;
        }

        if live_current_branch.as_deref() == Some(branch) {
            let msg = format!("Refused to delete checked-out branch '{}'", branch);
            logs.push(LogPayload {
                repo_path: repo_str.clone(),
                line: msg.clone(),
                is_stderr: true,
            });
            outcomes.push(BranchPruneOutcome {
                repo_path: repo_str.clone(),
                branch_name: branch.to_string(),
                deleted: false,
                forced: target.force,
                error: Some(msg),
            });
            continue;
        }

        if branch == live_default_branch {
            let msg = format!("Refused to delete default branch '{}'", branch);
            logs.push(LogPayload {
                repo_path: repo_str.clone(),
                line: msg.clone(),
                is_stderr: true,
            });
            outcomes.push(BranchPruneOutcome {
                repo_path: repo_str.clone(),
                branch_name: branch.to_string(),
                deleted: false,
                forced: target.force,
                error: Some(msg),
            });
            continue;
        }

        let flag = if target.force { "-D" } else { "-d" };
        match run_git(repo_path, &["branch", flag, "--", branch]).await {
            Ok(out) => {
                let line = if out.is_empty() {
                    format!("Deleted branch {} ({})", branch, flag)
                } else {
                    out
                };
                logs.push(LogPayload {
                    repo_path: repo_str.clone(),
                    line,
                    is_stderr: false,
                });
                outcomes.push(BranchPruneOutcome {
                    repo_path: repo_str.clone(),
                    branch_name: branch.to_string(),
                    deleted: true,
                    forced: target.force,
                    error: None,
                });
            }
            Err(e) => {
                let msg = e.to_string();
                logs.push(LogPayload {
                    repo_path: repo_str.clone(),
                    line: msg.clone(),
                    is_stderr: true,
                });
                outcomes.push(BranchPruneOutcome {
                    repo_path: repo_str.clone(),
                    branch_name: branch.to_string(),
                    deleted: false,
                    forced: target.force,
                    error: Some(msg),
                });
            }
        }
    }

    (outcomes, logs)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::scanner::scan_for_repos;
    use std::fs::File;
    use std::io::Write;
    use std::process::Command;
    use std::time::Instant;
    use tempfile::TempDir;

    fn setup_git_repo(dir: &Path) {
        Command::new("git")
            .args(["init", "-b", "main"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["config", "user.email", "test@test.com"])
            .current_dir(dir)
            .output()
            .unwrap();
        let dummy = dir.join("file.txt");
        let mut f = File::create(dummy).unwrap();
        writeln!(f, "hello").unwrap();
        Command::new("git")
            .args(["add", "."])
            .current_dir(dir)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "initial commit"])
            .current_dir(dir)
            .output()
            .unwrap();
    }

    #[tokio::test]
    async fn test_inspect_clean_repo() {
        let temp = TempDir::new().unwrap();
        setup_git_repo(temp.path());
        let status = inspect_repo(temp.path(), temp.path()).await.unwrap();
        assert!(!status.is_dirty);
        assert!(!status.is_detached);
        assert_eq!(status.current_branch, "main");
        assert_eq!(status.last_commit_title, "initial commit");
    }

    #[tokio::test]
    async fn test_inspect_dirty_repo() {
        let temp = TempDir::new().unwrap();
        setup_git_repo(temp.path());
        let dummy = temp.path().join("dirty.txt");
        let mut f = File::create(dummy).unwrap();
        writeln!(f, "dirty change").unwrap();
        let status = inspect_repo(temp.path(), temp.path()).await.unwrap();
        assert!(status.is_dirty);
    }

    #[tokio::test]
    async fn test_inspect_detached_head() {
        let temp = TempDir::new().unwrap();
        setup_git_repo(temp.path());
        let sha_out = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(temp.path())
            .output()
            .unwrap();
        let sha = String::from_utf8_lossy(&sha_out.stdout).trim().to_string();
        Command::new("git")
            .args(["checkout", &sha])
            .current_dir(temp.path())
            .output()
            .unwrap();

        let status = inspect_repo(temp.path(), temp.path()).await.unwrap();
        assert!(status.is_detached);
        assert!(status.current_branch.starts_with("HEAD"));
    }

    #[tokio::test]
    async fn test_list_repo_branches() {
        let temp = TempDir::new().unwrap();
        setup_git_repo(temp.path());
        Command::new("git")
            .args(["checkout", "-b", "feature/alpha"])
            .current_dir(temp.path())
            .output()
            .unwrap();

        let branches = list_repo_branches(temp.path()).await.unwrap();
        assert_eq!(branches, vec!["feature/alpha", "main"]);
    }

    #[tokio::test]
    async fn bench_scan_50() {
        let bench_root = Path::new("/tmp/mainline-bench-workspace");
        if !bench_root.exists() {
            // Skip silently unless synthetic 50-repo workspace is generated by verification script
            return;
        }
        let start = Instant::now();
        let paths = scan_for_repos(bench_root, false).unwrap();
        let statuses = inspect_workspace(paths.clone(), bench_root).await;
        let elapsed_ms = start.elapsed().as_millis();
        println!(
            "bench_scan_50: scanned {} repos -> inspected {} in {} ms",
            paths.len(),
            statuses.len(),
            elapsed_ms
        );
        assert!(paths.len() >= 50, "expected >= 50 repos");
        assert_eq!(statuses.len(), paths.len());
    }

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

    fn setup_remote_with_branches() -> (TempDir, PathBuf) {
        let temp = TempDir::new().unwrap();
        let remote = temp.path().join("remote.git");
        let seed = temp.path().join("seed");
        let clone = temp.path().join("clone");

        std::fs::create_dir_all(&remote).unwrap();
        git_sync(&remote, &["init", "--bare", "-b", "main"]);

        git_sync(temp.path(), &["clone", remote.to_str().unwrap(), "seed"]);
        git_sync(&seed, &["config", "user.name", "Test"]);
        git_sync(&seed, &["config", "user.email", "test@test.com"]);
        {
            let mut f = File::create(seed.join("README.md")).unwrap();
            writeln!(f, "base").unwrap();
        }
        git_sync(&seed, &["add", "."]);
        git_sync(&seed, &["commit", "-m", "initial"]);
        git_sync(&seed, &["push", "-u", "origin", "main"]);

        git_sync(temp.path(), &["clone", remote.to_str().unwrap(), "clone"]);
        git_sync(&clone, &["config", "user.name", "Test"]);
        git_sync(&clone, &["config", "user.email", "test@test.com"]);

        // 1. feature/merged: pushed, merged into origin/main, then deleted on origin
        git_sync(&clone, &["checkout", "-b", "feature/merged", "main"]);
        {
            let mut f = File::create(clone.join("merged.txt")).unwrap();
            writeln!(f, "merged work").unwrap();
        }
        git_sync(&clone, &["add", "."]);
        git_sync(&clone, &["commit", "-m", "feat: merged work"]);
        git_sync(&clone, &["push", "-u", "origin", "feature/merged"]);
        git_sync(&clone, &["checkout", "main"]);
        git_sync(&clone, &["merge", "--no-ff", "feature/merged", "-m", "Merge feature/merged"]);
        git_sync(&clone, &["push", "origin", "main"]);
        git_sync(&clone, &["push", "origin", "--delete", "feature/merged"]);

        // 2. feature/unmerged: pushed, NOT merged into main, then deleted on origin (squash-merge simulation)
        git_sync(&clone, &["checkout", "-b", "feature/unmerged", "main"]);
        {
            let mut f = File::create(clone.join("unmerged.txt")).unwrap();
            writeln!(f, "squash work").unwrap();
        }
        git_sync(&clone, &["add", "."]);
        git_sync(&clone, &["commit", "-m", "feat: squash work"]);
        git_sync(&clone, &["push", "-u", "origin", "feature/unmerged"]);
        git_sync(&clone, &["checkout", "main"]);
        git_sync(&clone, &["push", "origin", "--delete", "feature/unmerged"]);

        // 3. feature/active: pushed and still exists on origin
        git_sync(&clone, &["checkout", "-b", "feature/active", "main"]);
        {
            let mut f = File::create(clone.join("active.txt")).unwrap();
            writeln!(f, "active work").unwrap();
        }
        git_sync(&clone, &["add", "."]);
        git_sync(&clone, &["commit", "-m", "feat: active work"]);
        git_sync(&clone, &["push", "-u", "origin", "feature/active"]);

        // 4. feature/local: local-only branch with no upstream
        git_sync(&clone, &["checkout", "-b", "feature/local", "main"]);
        git_sync(&clone, &["checkout", "main"]);

        (temp, clone)
    }

    #[tokio::test]
    async fn test_inspect_defunct_branches_detects_gone_merged_and_unmerged() {
        let (_temp, clone) = setup_remote_with_branches();
        let scan_target = RepoScanTarget {
            absolute_path: clone.to_string_lossy().to_string(),
            repo_name: "clone".to_string(),
            relative_path: "clone".to_string(),
            default_branch: "main".to_string(),
        };

        let (result, _logs) = inspect_repo_defunct_branches(&scan_target, true).await;
        assert!(result.fetch_error.is_none(), "unexpected fetch error: {:?}", result.fetch_error);
        assert_eq!(result.branches.len(), 2, "expected 2 gone branches, got {:?}", result.branches);

        let merged = result.branches.iter().find(|b| b.name == "feature/merged").unwrap();
        assert!(merged.is_merged);
        assert!(merged.can_delete);
        assert!(!merged.is_current);
        assert!(!merged.is_default);
        assert_eq!(merged.upstream, "origin/feature/merged");
        assert_eq!(merged.last_commit_title, "feat: merged work");

        let unmerged = result.branches.iter().find(|b| b.name == "feature/unmerged").unwrap();
        assert!(!unmerged.is_merged);
        assert!(unmerged.can_delete);
        assert!(!unmerged.is_current);
        assert!(!unmerged.is_default);
        assert_eq!(unmerged.upstream, "origin/feature/unmerged");
    }

    #[tokio::test]
    async fn test_inspect_defunct_branches_protects_checked_out_branch() {
        let (_temp, clone) = setup_remote_with_branches();
        git_sync(&clone, &["checkout", "feature/merged"]);

        let scan_target = RepoScanTarget {
            absolute_path: clone.to_string_lossy().to_string(),
            repo_name: "clone".to_string(),
            relative_path: "clone".to_string(),
            default_branch: "main".to_string(),
        };

        let (result, _logs) = inspect_repo_defunct_branches(&scan_target, true).await;
        let current_gone = result.branches.iter().find(|b| b.name == "feature/merged").unwrap();
        assert!(current_gone.is_current);
        assert!(!current_gone.can_delete);
    }

    #[tokio::test]
    async fn test_prune_repo_branches_safe_force_and_guardrails() {
        let (_temp, clone) = setup_remote_with_branches();
        let repo_str = clone.to_string_lossy().to_string();

        // Check out feature/active to verify current-branch protection separately from default branch
        git_sync(&clone, &["checkout", "feature/active"]);
        git_sync(&clone, &["fetch", "--all", "--prune"]);

        let targets = vec![
            BranchPruneTarget {
                repo_path: repo_str.clone(),
                branch_name: "feature/merged".to_string(),
                force: false,
            },
            BranchPruneTarget {
                repo_path: repo_str.clone(),
                branch_name: "feature/unmerged".to_string(),
                force: false,
            },
            BranchPruneTarget {
                repo_path: repo_str.clone(),
                branch_name: "feature/active".to_string(),
                force: true,
            },
            BranchPruneTarget {
                repo_path: repo_str.clone(),
                branch_name: "main".to_string(),
                force: true,
            },
        ];

        let (outcomes, _logs) = prune_repo_branches(&clone, &targets).await;
        assert_eq!(outcomes.len(), 4);
        assert!(outcomes[0].deleted, "merged branch should delete with -d");
        assert!(!outcomes[1].deleted, "unmerged branch must fail with -d");
        assert!(!outcomes[2].deleted, "checked-out branch must be protected even with force=true");
        assert!(!outcomes[3].deleted, "default branch must be protected even with force=true");

        // Now opt in to force deletion for the unmerged branch
        let (force_outcomes, _logs) = prune_repo_branches(
            &clone,
            &[BranchPruneTarget {
                repo_path: repo_str,
                branch_name: "feature/unmerged".to_string(),
                force: true,
            }],
        )
        .await;
        assert!(force_outcomes[0].deleted, "unmerged branch should delete with -D");

        let remaining = list_repo_branches(&clone).await.unwrap();
        assert!(!remaining.contains(&"feature/merged".to_string()));
        assert!(!remaining.contains(&"feature/unmerged".to_string()));
        assert!(remaining.contains(&"feature/active".to_string()));
        assert!(remaining.contains(&"main".to_string()));
    }
}
