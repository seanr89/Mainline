---
name: tauri-specta-ipc
description: >-
  Author and troubleshoot Tauri v2 IPC commands, event streams, security
  capabilities, window vibrancy configuration, and tauri-specta TypeScript
  codegen in Mainline. Use when adding or modifying #[tauri::command]
  handlers, regenerating src/bindings.ts, or editing tauri.conf.json and
  capabilities/default.json.
---

# Tauri v2 & Specta IPC Bridge

Keep Mainline's Rust backend and React frontend strictly synchronized through `tauri-specta` v2 generated TypeScript bindings (`src/bindings.ts`).

## Key Files

- `src-tauri/Cargo.toml`: Crate versions (`tauri = "2.0"`, `specta = "=2.0.0-rc.20"`, `specta-typescript = "=0.0.7"`, `tauri-specta = "=2.0.0-rc.20"`).
- `src-tauri/src/commands.rs`: IPC command implementations annotated with `#[tauri::command]` and `#[specta::specta]`.
- `src-tauri/src/lib.rs`: Command registration, TypeScript binding export, plugins, and `WatcherState` management.
- `src-tauri/src/main.rs`: Calls `git_workspace_manager_lib::run()`.
- `src-tauri/tauri.conf.json`: Window configuration (`Overlay` titlebar, `hiddenTitle: true`, `transparent: true`, `sidebar` + `vibrancy` effects).
- `src-tauri/capabilities/default.json`: Minimal permission grant (`core:default`, `dialog:allow-open`, `store:default`).
- `src/bindings.ts`: Generated IPC wrapper (`commands.*`) and domain types (`RepoStatus`, `SyncStrategy`, `LogPayload`, `AppError`).

## Authoring Rules

1. **Command Registration**:
   - Every new command in `commands.rs` MUST carry both `#[tauri::command]` and `#[specta::specta]` and be listed inside `tauri_specta::collect_commands![...]` in `lib.rs`.
   - Core command inventory:
     - `scan_workspace`
     - `refresh_repo`
     - `list_branches`
     - `switch_branch`
     - `sync_repos`
2. **TypeScript Binding Export**:
   - Export `../src/bindings.ts` under `#[cfg(debug_assertions)]` using `specta_typescript::Typescript::default().bigint(specta_typescript::BigIntExportBehavior::Number)` so `i64`/`usize` fields never panic on export.
   - Never hand-edit `src/bindings.ts` as a substitute for updating Rust types and regenerating bindings.
3. **Events**:
   - `"git-log"` emits `LogPayload { repo_path, line, is_stderr }`.
   - `"workspace-fs-change"` emits the changed `.git/HEAD` or `.git/index` path string.
   - Consider typing events with `tauri_specta::Event` if expanding event schemas.
4. **Capabilities & Security**:
   - Keep `capabilities/default.json` restricted to `"windows": ["main"]` and only required permissions (`core:default`, `dialog:allow-open`, `store:default`).

## Validation Steps

1. Verify Rust builds and regenerates bindings cleanly:
   ```bash
   cd src-tauri && cargo check && cargo test
   ```
2. Verify frontend compiles cleanly against `src/bindings.ts`:
   ```bash
   pnpm exec tsc --noEmit
   ```
