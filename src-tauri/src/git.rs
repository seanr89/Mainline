use crate::error::AppError;
use crate::models::{GitProvider, RepoStatus};
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
}
