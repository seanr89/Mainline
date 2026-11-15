# Mainline — Blueprint Corrections & Architectural Pitfalls

This document catalogs critical bugs, missing wiring, and performance edge cases identified while reviewing the original [Git Workspace Manager — Phased Implementation Plan & Build Guide](https://docs.google.com/document/d/1vt9NmLuiQfD_3tU86Fm9v-_InKllITgFfdYUyztABog/edit). **Every engineer and AI agent working on Mainline must apply these fixes.**

---

## 1. Summary of 8 Blueprint Corrections

| # | Location in Source Blueprint | Defect in Original Draft | Required Production Fix |
| :- | :--- | :--- | :--- |
| 1 | Section 1 (`Initialisation Commands`) | Runs `pnpm create tauri-app workspace-manager` inside a nested subdirectory. | Scaffold directly at the `Mainline/` repository root (`src/`, `src-tauri/`, `package.json`) so CI, git history, and agent rules align. |
| 2 | Section 2.2 (`scanner.rs`), 3.3 (`RepoTable.tsx`), 3.3 (`ConsoleDrawer.tsx`) | Syntax / API errors: `\|---\|Err(...)` typo in `scanner.rs`; `pub const ConsoleDrawer` (Rust keyword in TS); `getSortedCoreRowModel` (non-existent in `@tanstack/react-table` v8). | Fix to `return Err(...)`, `export const ConsoleDrawer`, and `getSortedRowModel`. |
| 3 | Section 6.1 (`watcher.rs`) | `let mut debouncer = new_debouncer(...)` is dropped immediately when `start_workspace_watcher()` returns, killing filesystem watching instantly. | Wrap the debouncer in `pub struct WatcherState(pub Mutex<Option<Debouncer<RecommendedWatcher>>>);`, manage it via `.manage(WatcherState::default())` in `lib.rs`, and store/replace it on workspace change. |
| 4 | Section 5.1 (`commands.rs`) & 5.2 (`DirtyConfirmModal.tsx`) | `"Stash Changes, Pull & Re-apply"` button dispatches `'PullFastForwardOnly'` (never stashes), and `HardResetAndPull` runs `git reset --hard HEAD` without cleaning, switching to `main`, or pulling. | Add `SyncStrategy::StashAndPull` and implement full multi-step Git sequences for both `StashAndPull` and `HardResetAndPull` (plus optional `reset_to_default` checkout). |
| 5 | Section 1 (`Cargo.toml`) & 2.2 (`lib.rs`) | `lib.rs` invokes `specta_typescript::Typescript::default()`, but `specta-typescript` is missing from `Cargo.toml`; `RepoStatus` uses `usize`/`i64` without `BigIntExportBehavior`, causing `tauri-specta` export errors/panics. | Add `specta-typescript = "=0.0.7"` to `Cargo.toml`, use `u32`/`f64` or configure `.bigint(BigIntExportBehavior::Number)`, and register all 5+ commands in `collect_commands![]`. |
| 6 | Section 1 (Monorepo Tree) | Blueprint omits code for `src-tauri/src/main.rs`, `src/components/BranchDropdown.tsx`, `src/App.tsx`, `src/main.tsx`, `src/index.html`, `src/styles.css`, `tailwind.config.js`, and `tsconfig.json`. | Implement every file cleanly during Phase 0–3 (see `docs/IMPLEMENTATION_PLAN.md`). |
| 7 | Section 3.3 (`RepoTable.tsx`) | `<tbody>` uses `position: absolute; display: flex; width: 100%` on `<tr>`, while `<thead>` uses standard table-row layout, causing header columns to misalign from virtualized body cells. | Apply matching `display: flex; width: 100%` and identical column flex/width utilities to both `<thead>` `<tr>`/`<th>` and `<tbody>` `<tr>`/`<td>`. |
| 8 | Section 2.3 (`tauri.conf.json`) & 3.2 (`Toolbar.tsx`) | `"titleBarStyle": "Overlay"` + `"hiddenTitle": true` requires explicit drag regions (`data-tauri-drag-region`) to move the macOS window. | Add `data-tauri-drag-region` to `<header>` and spacer `<div>`s in `Toolbar.tsx`, keeping `pl-20` for traffic light buttons. |

---

## 2. Subtle Runtime & Git Edge Cases to Prevent

### A. False-Positive Watcher Refreshes on `index.ts` / `index.html`
The draft watcher checks:
```rust
if event.path.ends_with("HEAD") || event.path.ends_with("index")
```
Wait: `Path::ends_with("index")` only matches exact filename `"index"` (not `"index.ts"`), **however** a project might legitimately have a file or directory named `index` outside `.git`, or a nested worktree. Always verify the parent directory component is `.git`!
```rust
let is_git_meta = event.path.parent().and_then(|p| p.file_name()) == Some(OsStr::new(".git"))
    && matches!(
        event.path.file_name().and_then(|n| n.to_str()),
        Some("HEAD" | "index")
    );
```
Also exclude `node_modules` and `target` if the watcher hits OS watch limits (`EMFILE` / FSEvents churn) on large monorepos.

### B. Scanning Submodules (`.git` File vs. `.git` Directory)
Git submodules frequently use a **`.git` file** (containing `gitdir: ../../.git/modules/...`) rather than a `.git` directory. In `scanner.rs`, check `entry.file_name() == ".git"` regardless of `is_dir()`, and when `!include_submodules`, call `it.skip_current_dir()` only when inside a matched repo directory (not at the workspace root). Note: with `WalkDir`, `it.skip_current_dir()` skips the **currently entered directory**, so if you match `.git` (which is a child of the repo dir) and call `it.skip_current_dir()`, it skips inside `.git` — it does **not** skip sibling folders of `.git` inside the repo unless you prune at the repo directory level using `filter_entry`!
**Better `WalkDir` pattern**: Check `entry.path().join(".git").exists()` when `file_type.is_dir()` inside `filter_entry` or loop:
- If `path.join(".git").exists()` -> record `path` as a repo! If `!include_submodules`, skip descending into `path` completely (`it.skip_current_dir()`), which saves scanning thousands of source files inside every repo and drives 500-repo cold scans well under `200ms`!

### C. `git init` Default Branch in Tests
Different developer machines and CI images have different `git config init.defaultBranch` (`master` vs `main`). Unit tests in `git.rs` **must** run `git init -b main` (or read the created branch dynamically) so tests never fail locally.

### D. Unborn Branches & Repos Without Remotes
- A freshly initialized repo with zero commits fails `git log -1` and `git status --porcelain=v2 --branch` outputs `# branch.oid (initial)`. Handle zero-commit repos gracefully without returning `Err`.
- Repos without an `origin` remote have no `refs/remotes/origin/HEAD`; default `default_branch` safely by checking whether `main` or `master` exists in `refs/heads/` before falling back to `"main"`.

### E. `inspect_repo` Process Count Optimization
Running 5 sequential `git` CLI spawns per repository (`symbolic-ref`, `remote`, `symbolic-ref origin/HEAD`, `status`, `stash list`, `log`) across 500 repos executes `3,000` subprocess spawns. To hit `< 1,000ms` reliably on macOS:
- Combine or parallelize intra-repo calls, or read `.git/HEAD` directly when simple, or run `tokio::join!` on `status`, `remote`, `stash`, and `log` (4 commands instead of 6, or read `.git/HEAD` in Rust in microseconds!).
- Benchmark with `.agents/skills/verification-matrix/scripts/generate_benchmark_repos.sh` to confirm `< 1,000ms` on target hardware.
