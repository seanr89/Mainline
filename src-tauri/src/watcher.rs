use crate::error::AppError;
use notify_debouncer_mini::{
    new_debouncer,
    notify::{RecommendedWatcher, RecursiveMode},
    DebounceEventResult, Debouncer,
};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Managed Tauri state retaining the active filesystem debouncer so watching remains
/// alive for the lifetime of the selected workspace root.
#[derive(Default)]
pub struct WatcherState {
    debouncer: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    watched_root: Mutex<Option<PathBuf>>,
}

fn is_git_head_or_index(path: &Path) -> Option<String> {
    let file_name = path.file_name()?.to_str()?;
    if file_name != "HEAD" && file_name != "index" {
        return None;
    }
    let parent = path.parent()?;
    if parent.file_name() != Some(OsStr::new(".git")) {
        return None;
    }
    let repo_root = parent.parent()?;
    Some(repo_root.to_string_lossy().to_string())
}

/// Start (or switch) the debounced filesystem watcher for `root_path`.
pub fn start_workspace_watcher(
    state: &WatcherState,
    app_handle: AppHandle,
    root_path: &Path,
) -> Result<(), AppError> {
    if !root_path.exists() || !root_path.is_dir() {
        return Err(AppError::InvalidPath(format!(
            "Cannot watch non-existent workspace: {:?}",
            root_path
        )));
    }

    {
        let watched_guard = state
            .watched_root
            .lock()
            .map_err(|_| AppError::Io("Watcher root lock poisoned".to_string()))?;
        if watched_guard.as_deref() == Some(root_path) {
            let debouncer_guard = state
                .debouncer
                .lock()
                .map_err(|_| AppError::Io("Watcher state lock poisoned".to_string()))?;
            if debouncer_guard.is_some() {
                return Ok(());
            }
        }
    }

    let app = app_handle.clone();
    let mut debouncer = new_debouncer(
        Duration::from_millis(250),
        move |res: DebounceEventResult| match res {
            Ok(events) => {
                let mut emitted = Vec::new();
                for event in events {
                    if let Some(repo_root) = is_git_head_or_index(&event.path) {
                        if !emitted.contains(&repo_root) {
                            emitted.push(repo_root);
                        }
                    }
                }
                for repo_root in emitted {
                    let _ = app.emit("workspace-fs-change", repo_root);
                }
            }
            Err(e) => eprintln!("Workspace watcher error: {:?}", e),
        },
    )
    .map_err(|e| AppError::Io(e.to_string()))?;

    debouncer
        .watcher()
        .watch(root_path, RecursiveMode::Recursive)
        .map_err(|e| AppError::Io(e.to_string()))?;

    let mut debouncer_guard = state
        .debouncer
        .lock()
        .map_err(|_| AppError::Io("Watcher state lock poisoned".to_string()))?;
    *debouncer_guard = Some(debouncer);

    let mut root_guard = state
        .watched_root
        .lock()
        .map_err(|_| AppError::Io("Watcher root lock poisoned".to_string()))?;
    *root_guard = Some(root_path.to_path_buf());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_git_meta_path_filter() {
        assert_eq!(
            is_git_head_or_index(Path::new("/ws/repo-a/.git/HEAD")),
            Some("/ws/repo-a".to_string())
        );
        assert_eq!(
            is_git_head_or_index(Path::new("/ws/repo-a/.git/index")),
            Some("/ws/repo-a".to_string())
        );
        // Must ignore source files outside `.git`
        assert_eq!(
            is_git_head_or_index(Path::new("/ws/repo-a/src/index")),
            None
        );
        assert_eq!(
            is_git_head_or_index(Path::new("/ws/repo-a/src/index.ts")),
            None
        );
    }
}
