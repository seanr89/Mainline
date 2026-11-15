import { create } from 'zustand';
import { LazyStore } from '@tauri-apps/plugin-store';
import { AppError, RepoStatus, RepoSyncTarget, SyncStrategy, commands } from '../bindings';

const settingsStore = new LazyStore('settings.json');

export type FilterType = 'all' | 'off-main' | 'dirty' | 'behind';

export interface PendingSyncModal {
  mode: 'sync' | 'reset-to-main' | 'checkout';
  targets: RepoSyncTarget[];
  dirtyRepos: RepoStatus[];
  cleanCount: number;
}

export function formatAppError(err: AppError): string {
  switch (err.type) {
    case 'GitExecution':
      return `Git error (${err.details.code}): ${err.details.message}`;
    case 'Io':
      return `Filesystem error: ${err.details}`;
    case 'ParseError':
      return `Parse error: ${err.details}`;
    case 'InvalidPath':
      return `Invalid path: ${err.details}`;
  }
}

interface WorkspaceState {
  workspaceRoots: string[];
  activeRoot: string | null;
  repositories: RepoStatus[];
  selectedRepoPaths: Set<string>;
  lastSelectedPath: string | null;
  activeFilter: FilterType;
  searchQuery: string;
  includeSubmodules: boolean;
  isScanning: boolean;
  isSyncing: boolean;
  isConsoleOpen: boolean;
  lastScanDurationMs: number | null;
  lastError: string | null;
  dirtyModal: PendingSyncModal | null;

  initStore: () => Promise<void>;
  addWorkspaceRoot: (path: string) => Promise<void>;
  removeWorkspaceRoot: (path: string) => Promise<void>;
  setActiveRoot: (path: string) => void;
  setIncludeSubmodules: (enabled: boolean) => Promise<void>;
  scanActiveWorkspace: () => Promise<void>;
  refreshSingleRepo: (repoPath: string) => Promise<void>;
  setRepositories: (repos: RepoStatus[]) => void;
  toggleSelectRepo: (
    path: string,
    modifiers: { meta: boolean; shift: boolean },
    orderedVisiblePaths?: string[]
  ) => void;
  selectAllPaths: (paths: string[]) => void;
  clearSelection: () => void;
  setFilter: (filter: FilterType) => void;
  setSearchQuery: (query: string) => void;
  setConsoleOpen: (open: boolean) => void;
  clearError: () => void;
  requestBatchAction: (mode: 'sync' | 'reset-to-main' | 'fetch') => Promise<void>;
  requestBranchCheckout: (repo: RepoStatus, targetBranch: string) => Promise<void>;
  confirmDirtyAction: (strategy: SyncStrategy) => Promise<void>;
  skipDirtyAndContinue: () => Promise<void>;
  cancelDirtyModal: () => void;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaceRoots: [],
  activeRoot: null,
  repositories: [],
  selectedRepoPaths: new Set(),
  lastSelectedPath: null,
  activeFilter: 'all',
  searchQuery: '',
  includeSubmodules: false,
  isScanning: false,
  isSyncing: false,
  isConsoleOpen: false,
  lastScanDurationMs: null,
  lastError: null,
  dirtyModal: null,

  initStore: async () => {
    try {
      const savedRoots = await settingsStore.get<string[]>('roots');
      const savedSubmodules = await settingsStore.get<boolean>('includeSubmodules');
      set({
        workspaceRoots: savedRoots ?? [],
        activeRoot: savedRoots && savedRoots.length > 0 ? savedRoots[0] : null,
        includeSubmodules: savedSubmodules ?? false,
      });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  addWorkspaceRoot: async (path) => {
    const roots = Array.from(new Set([...get().workspaceRoots, path]));
    await settingsStore.set('roots', roots);
    await settingsStore.save();
    set({
      workspaceRoots: roots,
      activeRoot: path,
      selectedRepoPaths: new Set(),
      lastSelectedPath: null,
      lastError: null,
    });
  },

  removeWorkspaceRoot: async (path) => {
    const remaining = get().workspaceRoots.filter((r) => r !== path);
    await settingsStore.set('roots', remaining);
    await settingsStore.save();
    const currentActive = get().activeRoot;
    const nextActive =
      currentActive === path ? (remaining.length > 0 ? remaining[0] : null) : currentActive;
    set({
      workspaceRoots: remaining,
      activeRoot: nextActive,
      repositories: nextActive ? get().repositories : [],
      selectedRepoPaths: new Set(),
      lastSelectedPath: null,
    });
  },

  setActiveRoot: (path) =>
    set({
      activeRoot: path,
      selectedRepoPaths: new Set(),
      lastSelectedPath: null,
      lastError: null,
    }),

  setIncludeSubmodules: async (enabled) => {
    await settingsStore.set('includeSubmodules', enabled);
    await settingsStore.save();
    set({ includeSubmodules: enabled });
  },

  scanActiveWorkspace: async () => {
    const { activeRoot, includeSubmodules } = get();
    if (!activeRoot) {
      set({ repositories: [], lastScanDurationMs: null });
      return;
    }

    set({ isScanning: true, lastError: null });
    const start = performance.now();
    const result = await commands.scanWorkspace(activeRoot, includeSubmodules);
    const elapsed = Math.round(performance.now() - start);

    if (result.status === 'ok') {
      set({
        repositories: result.data,
        isScanning: false,
        lastScanDurationMs: elapsed,
      });
    } else {
      set({
        isScanning: false,
        lastError: formatAppError(result.error),
      });
    }
  },

  refreshSingleRepo: async (repoPath) => {
    const { activeRoot } = get();
    if (!activeRoot) return;
    const res = await commands.refreshRepo(repoPath, activeRoot);
    if (res.status === 'ok') {
      set((state) => {
        const exists = state.repositories.some((r) => r.absolute_path === repoPath);
        if (!exists) return state;
        return {
          repositories: state.repositories.map((r) =>
            r.absolute_path === repoPath ? res.data : r
          ),
        };
      });
    }
  },

  setRepositories: (repos) => set({ repositories: repos }),

  toggleSelectRepo: (path, modifiers, orderedVisiblePaths) => {
    set((state) => {
      if (modifiers.shift && state.lastSelectedPath && orderedVisiblePaths?.length) {
        const startIdx = orderedVisiblePaths.indexOf(state.lastSelectedPath);
        const endIdx = orderedVisiblePaths.indexOf(path);
        if (startIdx !== -1 && endIdx !== -1) {
          const [low, high] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
          const next = new Set(modifiers.meta ? state.selectedRepoPaths : []);
          for (let i = low; i <= high; i++) {
            next.add(orderedVisiblePaths[i]);
          }
          return { selectedRepoPaths: next };
        }
      }

      if (modifiers.meta) {
        const next = new Set(state.selectedRepoPaths);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
        }
        return { selectedRepoPaths: next, lastSelectedPath: path };
      }

      const next = new Set<string>();
      if (!(state.selectedRepoPaths.size === 1 && state.selectedRepoPaths.has(path))) {
        next.add(path);
      }
      return { selectedRepoPaths: next, lastSelectedPath: path };
    });
  },

  selectAllPaths: (paths) => set({ selectedRepoPaths: new Set(paths) }),

  clearSelection: () => set({ selectedRepoPaths: new Set(), lastSelectedPath: null }),

  setFilter: (filter) => set({ activeFilter: filter }),

  setSearchQuery: (query) => set({ searchQuery: query }),

  setConsoleOpen: (open) => set({ isConsoleOpen: open }),

  clearError: () => set({ lastError: null }),

  requestBatchAction: async (mode) => {
    const { repositories, selectedRepoPaths } = get();
    const chosenRepos =
      selectedRepoPaths.size > 0
        ? repositories.filter((r) => selectedRepoPaths.has(r.absolute_path))
        : repositories;

    if (chosenRepos.length === 0) return;

    const resetToDefault = mode === 'reset-to-main';
    const targets: RepoSyncTarget[] = chosenRepos.map((r) => ({
      absolute_path: r.absolute_path,
      branch: r.default_branch,
      reset_to_default: resetToDefault,
    }));

    if (mode === 'fetch') {
      set({ isSyncing: true, isConsoleOpen: true, lastError: null });
      const res = await commands.syncRepos(targets, 'FetchOnly');
      set({ isSyncing: false });
      if (res.status === 'error') {
        set({ lastError: formatAppError(res.error) });
      }
      await get().scanActiveWorkspace();
      return;
    }

    const dirtyRepos = chosenRepos.filter((r) => r.is_dirty);
    if (dirtyRepos.length > 0) {
      set({
        dirtyModal: {
          mode,
          targets,
          dirtyRepos,
          cleanCount: chosenRepos.length - dirtyRepos.length,
        },
      });
      return;
    }

    set({ isSyncing: true, isConsoleOpen: true, lastError: null });
    const res = await commands.syncRepos(targets, 'PullFastForwardOnly');
    set({ isSyncing: false });
    if (res.status === 'error') {
      set({ lastError: formatAppError(res.error) });
    }
    await get().scanActiveWorkspace();
  },

  requestBranchCheckout: async (repo, targetBranch) => {
    if (repo.current_branch === targetBranch) return;

    if (repo.is_dirty) {
      set({
        dirtyModal: {
          mode: 'checkout',
          targets: [
            {
              absolute_path: repo.absolute_path,
              branch: targetBranch,
              reset_to_default: true,
            },
          ],
          dirtyRepos: [repo],
          cleanCount: 0,
        },
      });
      return;
    }

    set({ isSyncing: true, lastError: null });
    const res = await commands.switchBranch(repo.absolute_path, targetBranch);
    set({ isSyncing: false });
    if (res.status === 'error') {
      set({ lastError: formatAppError(res.error), isConsoleOpen: true });
    }
    await get().refreshSingleRepo(repo.absolute_path);
  },

  confirmDirtyAction: async (strategy) => {
    const modal = get().dirtyModal;
    if (!modal) return;
    set({ dirtyModal: null, isSyncing: true, isConsoleOpen: true, lastError: null });

    const res = await commands.syncRepos(modal.targets, strategy);
    set({ isSyncing: false });
    if (res.status === 'error') {
      set({ lastError: formatAppError(res.error) });
    }
    await get().scanActiveWorkspace();
  },

  skipDirtyAndContinue: async () => {
    const modal = get().dirtyModal;
    if (!modal) return;
    const dirtySet = new Set(modal.dirtyRepos.map((d) => d.absolute_path));
    const cleanTargets = modal.targets.filter((t) => !dirtySet.has(t.absolute_path));
    set({ dirtyModal: null });

    if (cleanTargets.length === 0) return;
    set({ isSyncing: true, isConsoleOpen: true, lastError: null });
    const res = await commands.syncRepos(cleanTargets, 'PullFastForwardOnly');
    set({ isSyncing: false });
    if (res.status === 'error') {
      set({ lastError: formatAppError(res.error) });
    }
    await get().scanActiveWorkspace();
  },

  cancelDirtyModal: () => set({ dirtyModal: null }),
}));
