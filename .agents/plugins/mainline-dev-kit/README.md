# Mainline Dev Kit Plugin

Workspace plugin packaging Mainline's engineering rules, skills, and specialist subagents for Antigravity and Gemini agents.

## Included Components

- **Rules**: `rules/AGENTS.md` (architecture summary, root scaffolding invariant, and blueprint pitfall guards)
- **Skills**:
  - `rust-git-engine`: Rust `WalkDir` scanner, async `tokio` Git CLI wrapper, `porcelain=v2` parser, bounded semaphores, and `WatcherState`.
  - `tauri-specta-ipc`: Tauri v2 commands, `tauri-specta` TypeScript export (`BigIntExportBehavior::Number`), window vibrancy, and capabilities.
  - `macos-virtualized-ui`: macOS overlay titlebar, aligned `@tanstack/react-table` + `@tanstack/react-virtual` grid, Zustand store, and `DirtyConfirmModal`.
  - `verification-matrix`: 9-point Acceptance Testing Matrix and `generate_benchmark_repos.sh` 500/2,000-repo benchmark generator.
- **Specialist Agents**:
  - `rust-backend-engineer`
  - `tauri-react-ui-engineer`
  - `qa-benchmark-verifier`
