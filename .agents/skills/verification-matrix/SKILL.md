---
name: verification-matrix
description: >-
  Execute Mainline's 9-point Verification & Acceptance Testing Matrix, including
  synthetic 50-repository benchmark workspace generation, cold scan latency
  checks (<1,000ms), dirty-tree safety verification, detached HEAD and submodule
  testing, and release build verification. Use when validating a completed phase
  or signing off before release.
---

# Verification & Acceptance Testing Matrix

Validate Mainline against all 9 target metrics from `docs/IMPLEMENTATION_PLAN.md` (Phase 6).

## Helper Script

Use [generate_benchmark_repos.sh](./scripts/generate_benchmark_repos.sh) to generate synthetic multi-state Git workspaces in `/tmp/mainline-bench-workspace` (clean repos, dirty working trees, detached HEAD repos, and off-main branches):

```bash
# Default: 50 repositories in /tmp/mainline-bench-workspace
./.agents/skills/verification-matrix/scripts/generate_benchmark_repos.sh 50 /tmp/mainline-bench-workspace

# Optional scale stress test: 500 repositories
./.agents/skills/verification-matrix/scripts/generate_benchmark_repos.sh 500 /tmp/mainline-bench-stress
```

> Clean up benchmark folders in `/tmp/` after running verification.

## 9-Point Acceptance Checklist

1. **Cold Initial Scan (`< 1,000ms` for 50+ repos)**:
   - Run `cargo test --release -- --nocapture bench_scan_50` against the 50-repo `/tmp/mainline-bench-workspace` fixture.
2. **Dynamic UI Virtualization (`60 FPS` scrolling)**:
   - Open `/tmp/mainline-bench-workspace` in `pnpm tauri dev` and confirm virtualized table rendering via `@tanstack/react-virtual` (`estimateSize: () => 36`, `overscan: 10`).
3. **Memory Footprint (`< 120MB` baseline RSS on macOS)**:
   - Launch release/dev app on macOS and measure process RSS (`ps -o rss= -p <pid>`) after scanning an active workspace.
4. **Concurrent Submodule Handling**:
   - Run Rust integration tests with `include_submodules = true` and `false` on a repo containing a Git submodule (`.git` file vs `.git` directory).
5. **Detached HEAD Resolution**:
   - Verify `inspect_repo` marks `is_detached == true` when checked out directly to a commit SHA.
6. **Bounded Threading**:
   - Confirm `git.rs` uses `Semaphore::new(8)` for inspection and `commands.rs` uses `Semaphore::new(4)` for batch sync (or bounded to system core max).
7. **Destructive Action Intercept**:
   - Select a dirty repo, trigger batch sync or reset to main, and confirm `DirtyConfirmModal` opens before any `reset --hard` or `pull` command runs.
8. **Live Realtime Debouncing**:
   - Touch `.git/HEAD` or `.git/index` multiple times inside `250ms` and verify `watcher.rs` triggers a single consolidated `"workspace-fs-change"` refresh.
9. **Target Build Packaging**:
   - Verify `.github/workflows/release.yml` targets macOS (`.dmg`), Windows (`.msi`), and Linux (`.AppImage`/`.deb`), and run local `pnpm build` + `cd src-tauri && cargo check --release`.

## Full Verification Sequence

```bash
cd src-tauri && cargo test && cargo clippy -- -D warnings
cd .. && pnpm exec tsc --noEmit && pnpm build
```
