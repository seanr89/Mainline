use crate::error::AppError;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

const PRUNED_DIRECTORIES: &[&str] = &[
    "node_modules",
    "target",
    ".build",
    ".venv",
    "venv",
    "bin",
    "obj",
    ".git",
    "Pods",
    "vendor",
    "dist",
    "build",
];

/// Recursively discover Git repositories beneath `root` while pruning heavy build
/// and dependency directories. Supports both `.git` directories and submodule
/// `.git` pointer files.
pub fn scan_for_repos(root: &Path, include_submodules: bool) -> Result<Vec<PathBuf>, AppError> {
    if !root.exists() || !root.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Path does not exist or is not a directory: {:?}",
            root
        )));
    }

    let mut repos = Vec::new();
    let mut it = WalkDir::new(root).follow_links(false).into_iter();

    while let Some(next) = it.next() {
        let entry = match next {
            Ok(e) => e,
            Err(_) => continue,
        };

        if !entry.file_type().is_dir() {
            continue;
        }

        let name = entry.file_name().to_string_lossy();
        if entry.depth() > 0 && PRUNED_DIRECTORIES.contains(&name.as_ref()) {
            it.skip_current_dir();
            continue;
        }

        let dir_path = entry.path();
        if dir_path.join(".git").exists() {
            repos.push(dir_path.to_path_buf());
            if !include_submodules {
                it.skip_current_dir();
            }
        }
    }

    Ok(repos)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs::{self, File};
    use tempfile::TempDir;

    #[test]
    fn test_invalid_path_returns_err() {
        let missing = PathBuf::from("/tmp/definitely-does-not-exist-mainline-test-xyz");
        let res = scan_for_repos(&missing, false);
        assert!(matches!(res, Err(AppError::InvalidPath(_))));
    }

    #[test]
    fn test_scan_prunes_node_modules_and_finds_repos() {
        let temp = TempDir::new().unwrap();
        let repo_a = temp.path().join("org/repo-a");
        let repo_ignored = temp.path().join("org/node_modules/nested-pkg");
        let repo_target = temp.path().join("target/cached-repo");

        fs::create_dir_all(repo_a.join(".git")).unwrap();
        fs::create_dir_all(repo_ignored.join(".git")).unwrap();
        fs::create_dir_all(repo_target.join(".git")).unwrap();

        let found = scan_for_repos(temp.path(), false).unwrap();
        assert_eq!(found, vec![repo_a]);
    }

    #[test]
    fn test_scan_submodule_toggle() {
        let temp = TempDir::new().unwrap();
        let parent = temp.path().join("parent-repo");
        let sub = parent.join("libs/sub-repo");

        fs::create_dir_all(parent.join(".git")).unwrap();
        fs::create_dir_all(&sub).unwrap();
        // Submodules often store a `.git` pointer file rather than a directory.
        File::create(sub.join(".git")).unwrap();

        let without_sub = scan_for_repos(temp.path(), false).unwrap();
        assert_eq!(without_sub.len(), 1);
        assert_eq!(without_sub[0], parent);

        let mut with_sub = scan_for_repos(temp.path(), true).unwrap();
        with_sub.sort();
        let mut expected = vec![parent, sub];
        expected.sort();
        assert_eq!(with_sub, expected);
    }
}
