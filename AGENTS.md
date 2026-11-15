# Mainline — Multi-Agent Orchestration Guide

This repository uses Antigravity customizations (`.agents/`) to coordinate Gemini and specialist subagents across all 6 implementation phases of **Mainline** (`docs/IMPLEMENTATION_PLAN.md`).

---

## 1. Implementation Phases & Ownership

| Phase | Scope | Primary Files | Responsible Agent | Required Skills |
| :--- | :--- | :--- | :--- | :--- |
| **Phase 0** | Monorepo scaffolding, manifests, window config, capabilities | `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `src-tauri/capabilities/default.json` | `rust-backend-engineer` / `tauri-react-ui-engineer` | `tauri-specta-ipc` |
| **Phase 1** | Core Rust engine: domain models, errors, pruned walker, async Git inspector, unit tests | `src-tauri/src/{error,models,scanner,git}.rs` | `rust-backend-engineer` | `rust-git-engine` |
| **Phase 2** | Tauri v2 IPC commands, `tauri-specta` TypeScript codegen, `lib.rs` & `main.rs` | `src-tauri/src/{commands,lib,main}.rs`, `src/bindings.ts` | `rust-backend-engineer` | `tauri-specta-ipc` |
| **Phase 3** | macOS desktop UI, Zustand store, virtualized table, branch switcher, console drawer | `src/store/workspaceStore.ts`, `src/components/{Toolbar,Sidebar,RepoTable,BranchDropdown,ConsoleDrawer}.tsx`, `src/App.tsx` | `tauri-react-ui-engineer` | `macos-virtualized-ui`, `tauri-specta-ipc` |
| **Phase 4** | Batch sync pipeline, stash/pull/hard-reset strategies, dirty-tree safety modal | `src-tauri/src/commands.rs`, `src/components/DirtyConfirmModal.tsx` | `rust-backend-engineer` + `tauri-react-ui-engineer` | `rust-git-engine`, `macos-virtualized-ui` |
| **Phase 5** | Persistent debounced file watcher & GitHub Actions release matrix | `src-tauri/src/watcher.rs`, `.github/workflows/release.yml` | `rust-backend-engineer` | `rust-git-engine`, `tauri-specta-ipc` |
| **Phase 6** | 9-point Verification & Acceptance Testing Matrix + 500-repo benchmark | Tests & synthetic workspace benchmarks | `qa-benchmark-verifier` | `verification-matrix` |

---

## 2. Specialist Subagents & Workspace Skills

### Specialist Agents (`.agents/agents/`)
- **Rust Backend Engineer** (`.agents/agents/rust-backend-engineer.md`): Owns `src-tauri/src/*`, `Cargo.toml`, async `tokio` Git execution, `notify` watcher state, and `cargo test`.
- **Tauri React UI Engineer** (`.agents/agents/tauri-react-ui-engineer.md`): Owns `src/*`, Tailwind CSS macOS vibrancy styling, TanStack Table/Virtual performance, Zustand state, and Tauri IPC consumption.
- **QA & Benchmark Verifier** (`.agents/agents/qa-benchmark-verifier.md`): Owns unit/integration checks, 500-repo cold-scan benchmarks (`< 1,000ms`), dirty-tree guardrail verification, and bundle checks.

### Skills (`.agents/skills/`)
- `rust-git-engine`: Scanning, porcelain v2 parsing, detached HEAD/submodule edge cases, bounded semaphores, and watcher lifetime state.
- `tauri-specta-ipc`: Command macros, `BigIntExportBehavior`, `bindings.ts` generation, events, and capabilities.
- `macos-virtualized-ui`: Overlay titlebar drag regions, virtualized flex table alignment, keyboard shortcuts, and safety modal flows.
- `verification-matrix`: Synthetic 500-repo benchmark generator (`scripts/generate_benchmark_repos.sh`) and 9-point acceptance checklist.

---

## 3. Coordination Protocol for Parallel Work

1. **Contract First (Phase 1 -> Phase 2 -> Phase 3)**:
   - Finalize `models.rs`, `error.rs`, and `commands.rs` signatures and generate `src/bindings.ts` via `tauri-specta` **before** parallelizing UI components, so frontend agents compile against real generated TypeScript types.
2. **File Ownership Boundaries**:
   - Backend agents edit only `src-tauri/**` and `.github/workflows/**`.
   - Frontend agents edit only `src/**`, `index.html`, `package.json`, `tailwind.config.js`, and `tsconfig.json` (never hand-editing `src/bindings.ts` except for temporary stubs explicitly flagged for regeneration).
3. **Phase-Gate Commands**:
   - After Phase 1 & 2: `cd src-tauri && cargo check && cargo test`
   - After Phase 3 & 4: `pnpm exec tsc --noEmit && pnpm build`
   - After Phase 5 & 6: `cd src-tauri && cargo test && cargo clippy -- -D warnings` + `pnpm tauri build --debug` (or platform check) + benchmark script run.
