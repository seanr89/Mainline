import { useEffect, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { X } from 'lucide-react';
import { Toolbar } from './components/Toolbar';
import { Sidebar } from './components/Sidebar';
import { RepoTable } from './components/RepoTable';
import { ConsoleDrawer } from './components/ConsoleDrawer';
import { DirtyConfirmModal } from './components/DirtyConfirmModal';
import { AboutModal } from './components/AboutModal';
import { ChangelogModal } from './components/ChangelogModal';
import { PruneBranchesModal } from './components/PruneBranchesModal';
import { useWorkspaceStore } from './store/workspaceStore';

export default function App() {
  const {
    activeRoot,
    includeSubmodules,
    initStore,
    scanActiveWorkspace,
    refreshSingleRepo,
    lastError,
    clearError,
    dirtyModal,
    confirmDirtyAction,
    skipDirtyAndContinue,
    cancelDirtyModal,
  } = useWorkspaceStore();

  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void initStore();
  }, [initStore]);

  useEffect(() => {
    if (activeRoot) {
      void scanActiveWorkspace();
    }
  }, [activeRoot, includeSubmodules, scanActiveWorkspace]);

  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<string>('workspace-fs-change', (event) => {
      if (!active) return;
      void refreshSingleRepo(event.payload);
    });

    return () => {
      active = false;
      void unlistenPromise.then((fn) => fn());
    };
  }, [refreshSingleRepo]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === 'Escape' && dirtyModal) {
        cancelDirtyModal();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [dirtyModal, cancelDirtyModal]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-transparent text-gray-900 dark:text-gray-100">
      <Toolbar searchInputRef={searchInputRef} />

      {lastError && (
        <div className="px-4 py-1.5 bg-rose-50 dark:bg-rose-950/70 border-b border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-200 text-xs flex items-center justify-between">
          <span className="truncate">{lastError}</span>
          <button
            type="button"
            onClick={clearError}
            className="ml-3 p-0.5 rounded hover:bg-rose-200/50 dark:hover:bg-rose-800/60"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      <div className="flex-1 flex min-h-0 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
          <RepoTable />
          <ConsoleDrawer />
        </main>
      </div>

      <DirtyConfirmModal
        isOpen={dirtyModal !== null}
        dirtyRepos={dirtyModal?.dirtyRepos ?? []}
        cleanCount={dirtyModal?.cleanCount ?? 0}
        onConfirm={(strategy) => void confirmDirtyAction(strategy)}
        onSkipDirty={() => void skipDirtyAndContinue()}
        onCancel={cancelDirtyModal}
      />

      <AboutModal />
      <ChangelogModal />
      <PruneBranchesModal />
    </div>
  );
}
