---
name: rust-git-engine
description: >-
  Build, extend, test, and optimize Mainline's Rust backend engine in
  src-tauri/src/ (scanner.rs, git.rs, watcher.rs, models.rs, error.rs).
  Use when implementing pruned directory scanning, Git CLI porcelain v2
  parsing, bounded tokio semaphore pools, persistent notify filesystem
  watching, or Rust unit and integration tests.
---

# Rust Git Engine

Maintain high-throughput, non-blocking filesystem scanning, Git status inspection, batch sync execution, and persistent `.git` monitoring in `src-tauri/src/`.

## Core Modules & Responsibilities

- `src-tauri/src/error.rs`: `AppError` enum (`Io`, `GitExecution`, `ParseError`, `InvalidPath`) deriving `thiserror::Error`, `Serialize`, and `specta::Type`.
- `src-tauri/src/models.rs`: `GitProvider`, `SyncStrategy` (`PullFastForwardOnly`, `FetchOnly`, `StashAndPull`, `HardResetAndPull`), `RepoStatus`, `RepoSyncTarget`, `LogPayload`.
- `src-tauri/src/scanner.rs`: `scan_for_repos(root, include_submodules)` using `WalkDir::new(root).follow_links(false)`.
- `src-tauri/src/git.rs`: `run_git`, `inspect_repo`, `inspect_workspace`, `list_repo_branches`.
- `src-tauri/src/watcher.rs`: `WatcherState` holding `Mutex<Option<Debouncer<RecommendedWatcher>>>` and `start_workspace_watcher`.

## Non-Negotiable Implementation Rules

### 1. Fast Pruned Scanning (`scanner.rs`)
- Return early with `return Err(AppError::InvalidPath(...))` if `root` does not exist or is not a directory.
- Prune heavy build/dependency directories: `node_modules`, `target`, `.build`, `.venv`, `venv`, `bin`, `obj`, `Pods`, `vendor`, `dist`, `build`, and `.git`.
- Detect repositories by checking whether a directory contains `.git` (either directory or submodule file) **and** skip descending into the repo's own subdirectories when `include_submodules == false` so 500+ repositories scan well under `1,000ms`.

### 2. Async Git Execution & Porcelain v2 Parsing (`git.rs`)
- Always run `tokio::process::Command::new("git")` with `.current_dir(repo_path)` and `.env("GIT_TERMINAL_PROMPT", "0")`.
- Bound `inspect_workspace` concurrency with `Arc::new(Semaphore::new(8))` and `sync_repos` concurrency with `Arc::new(Semaphore::new(4))`.
- Handle Git edge cases cleanly without failing inspection:
  - **Detached HEAD**: `symbolic-ref --short -q HEAD` fails or returns non-zero; fall back to `rev-parse --short HEAD` (or `"HEAD"`) and set `is_detached = true`. Also recognize `# branch.head (detached)` in `git status --porcelain=v2 --branch`.
  - **Unborn branches (0 commits)**: `git log -1` fails on empty repos; return `("", 0, "No commits")` rather than an error.
  - **No `origin` remote**: `remote get-url origin` fails; return `remote_url = None` and `GitProvider::Custom("Local")`. Check local `main` / `master` refs before defaulting `default_branch` to `"main"`.
  - **Use `u32` / `f64` (or configure `BigIntExportBehavior::Number`)** on numeric `RepoStatus` fields so `specta` exports clean TypeScript `number` types.

### 3. Persistent Filesystem Watcher (`watcher.rs`)
- **Never** drop the `Debouncer` at the end of a setup function. Store it in Tauri managed state:
  ```rust
  #[derive(Default)]
  pub struct WatcherState(pub std::sync::Mutex<Option<notify_debouncer_mini::Debouncer<notify::RecommendedWatcher>>>);
  ```
- Filter events strictly to `.git/HEAD` and `.git/index` (verify parent component is `.git` so application files named `index` do not cause spurious refreshes).
- Debounce at `250ms` and emit `"workspace-fs-change"` with the changed path.

### 4. Multi-Step Batch `SyncStrategy` Execution
- `PullFastForwardOnly`: optional `checkout <branch>` if `reset_to_default`, then `pull --ff-only`.
- `FetchOnly`: `fetch --all --prune`.
- `StashAndPull`: `stash push --include-untracked -m "Mainline auto-stash"` -> optional `checkout <branch>` -> `pull --ff-only` -> `stash pop` (only if stash was created).
- `HardResetAndPull`: `reset --hard HEAD` -> `clean -fd` -> optional `checkout <branch>` -> `pull --ff-only`.

## Validation Steps

1. Run Rust compilation and lints:
   ```bash
   cd src-tauri && cargo check && cargo clippy -- -D warnings
   ```
2. Run Rust unit and integration tests (ensure tests pass `-b main` to `git init` so host `init.defaultBranch` config cannot cause flakes):
   ```bash
   cd src-tauri && cargo test
   ```
