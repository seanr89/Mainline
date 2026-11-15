# Mainline Dev Kit — Active Plugin Rules

When implementing or modifying **Mainline** (`/Mainline`), follow the authoritative engineering roadmap in `docs/IMPLEMENTATION_PLAN.md` and apply every blueprint fix in `docs/ARCHITECTURE_AND_PITFALLS.md`:

1. **Scaffold at Repo Root**: Place `src/`, `src-tauri/`, and `package.json` directly in the repository root — never inside a nested `git-workspace-manager/` folder.
2. **Keep `WatcherState` Alive**: Persist the `notify-debouncer-mini` `Debouncer` inside Tauri managed state (`WatcherState`) and filter events strictly to `.git/HEAD` and `.git/index`.
3. **Complete & Honest `SyncStrategy`**: Support `PullFastForwardOnly`, `FetchOnly`, `StashAndPull`, and `HardResetAndPull`. Always intercept dirty repos in `DirtyConfirmModal` before pull/reset, and map `"Stash Changes, Pull & Re-apply"` to `'StashAndPull'`.
4. **Type-Safe `tauri-specta` Export**: Include `specta-typescript = "=0.0.7"` in `Cargo.toml`, configure `BigIntExportBehavior::Number` (or use `u32`/`f64`), and register all IPC commands in `collect_commands![]`.
5. **macOS UI & Virtualization Fixes**: Use `getSortedRowModel` (never `getSortedCoreRowModel`), `export const ConsoleDrawer` (never `pub`), `data-tauri-drag-region` + `pl-20` in `Toolbar.tsx`, and aligned `flex` columns across `<thead>` and virtualized `<tbody>` rows.
6. **Verify Every Phase**: Run `cd src-tauri && cargo test && cargo clippy -- -D warnings` and `pnpm exec tsc --noEmit && pnpm build` before handoff.
