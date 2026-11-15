---
name: macos-virtualized-ui
description: >-
  Build and refine Mainline's macOS-style React 18, Tailwind CSS, Zustand, and
  TanStack Table/Virtual desktop interface. Use when working on
  src/components/*, src/store/workspaceStore.ts, virtualized table rendering,
  macOS overlay titlebar drag regions, keyboard shortcuts, or dirty-tree
  confirmation modals.
---

# macOS Virtualized Desktop UI

Deliver a responsive, native-feeling macOS desktop UI maintaining 60 FPS across 2,000+ repositories with `< 120MB` baseline memory footprint.

## Component Map

- `src/store/workspaceStore.ts`: Zustand store + `LazyStore('settings.json')` persistence for workspace roots, filters (`all`, `off-main`, `dirty`, `behind`), multi-selection, and modal/scanning state.
- `src/components/Toolbar.tsx`: Top bar (`h-12`) with traffic-light clearance, `Add Workspace`, `Refresh`, `⌘F` search filter, batch `Sync` / `Reset to Main` triggers, and console toggle.
- `src/components/Sidebar.tsx`: Workspace root selector and filter badges with live counts.
- `src/components/RepoTable.tsx`: Virtualized `@tanstack/react-table` + `@tanstack/react-virtual` data grid.
- `src/components/BranchDropdown.tsx`: Inline branch selector calling `listBranches` and `switchBranch`.
- `src/components/ConsoleDrawer.tsx`: `export const ConsoleDrawer` streaming `"git-log"` events (capped at latest 200 lines).
- `src/components/DirtyConfirmModal.tsx`: Guardrail intercept modal before dirty sync or hard reset.
- `src/App.tsx`: Root layout orchestrating store hydration, `⌘F` shortcut, and `"workspace-fs-change"` debounced single-repo refresh.

## Critical UI & Correctness Rules

1. **macOS Overlay Titlebar Clearance & Dragging**:
   - `tauri.conf.json` configures `"titleBarStyle": "Overlay"` and `"hiddenTitle": true`.
   - Give `<header>` in `Toolbar.tsx` `pl-20` (to clear macOS traffic-light buttons) and apply `data-tauri-drag-region` to the `<header>` and empty flex spacers (interactive buttons/inputs sit above it cleanly).
2. **TanStack Table v8 + Virtualizer Alignment**:
   - Import `getSortedRowModel` (never `getSortedCoreRowModel`, which does not exist in v8).
   - Because virtualized `<tbody>` rows use `position: absolute; display: flex; width: 100%`, apply **matching** `display: flex; width: 100%` and identical column flex/width classes on both `<thead>` `<tr>`/`<th>` and `<tbody>` `<tr>`/`<td>` so headers stay locked to cell columns.
   - Keep `estimateSize: () => 36` and `overscan: 10`.
3. **Dirty-Tree Safety Flow**:
   - Before invoking `commands.syncRepos(...)` for pull or branch-reset actions, inspect selected repos for `is_dirty === true`.
   - If any selected repo is dirty, open `DirtyConfirmModal` instead of executing immediately:
     - **"Stash Changes, Pull & Re-apply"** MUST pass `'StashAndPull'` (never `'PullFastForwardOnly'`).
     - **"Hard Reset (Discard All Changes)"** MUST pass `'HardResetAndPull'`.
     - **"Cancel Operation"** MUST abort cleanly without touching any repository.
4. **Event & Listener Hygiene**:
   - Export `ConsoleDrawer` with `export const ConsoleDrawer` (never Rust `pub`).
   - Always call the `unlisten` cleanup function returned by `listen(...)` on component unmount.

## Validation Steps

1. Type-check and build the production bundle:
   ```bash
   pnpm exec tsc --noEmit && pnpm build
   ```
2. Visually inspect the rendered table alignment, dark/light contrast, and 2,000-row scroll smoothness when running `pnpm tauri dev`.
