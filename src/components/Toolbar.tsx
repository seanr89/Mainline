import React from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import {
  FolderPlus,
  RefreshCw,
  Terminal,
  Search,
  Download,
  GitMerge,
  ArrowDownToLine,
  GitFork,
  Info,
} from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';

interface ToolbarProps {
  searchInputRef: React.RefObject<HTMLInputElement>;
}

export const Toolbar: React.FC<ToolbarProps> = ({ searchInputRef }) => {
  const {
    activeRoot,
    addWorkspaceRoot,
    scanActiveWorkspace,
    repositories,
    selectedRepoPaths,
    searchQuery,
    setSearchQuery,
    isScanning,
    isSyncing,
    isConsoleOpen,
    setConsoleOpen,
    setAboutOpen,
    includeSubmodules,
    setIncludeSubmodules,
    requestBatchAction,
  } = useWorkspaceStore();

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected && typeof selected === 'string') {
      await addWorkspaceRoot(selected);
    }
  };

  const targetCount = selectedRepoPaths.size > 0 ? selectedRepoPaths.size : repositories.length;
  const hasRepos = repositories.length > 0;
  const busy = isScanning || isSyncing;

  return (
    <header
      data-tauri-drag-region
      className="h-12 shrink-0 border-b border-gray-200/80 dark:border-gray-800/90 bg-gray-50/75 dark:bg-gray-900/75 backdrop-blur-md flex items-center justify-between pl-20 pr-3 select-none"
    >
      <div data-tauri-drag-region className="flex items-center space-x-1.5">
        <button
          type="button"
          onClick={handleOpenFolder}
          className="flex items-center px-2.5 py-1 text-xs font-medium rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-750 text-gray-700 dark:text-gray-200 transition-colors"
        >
          <FolderPlus className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
          Add Workspace
        </button>

        <button
          type="button"
          onClick={() => void scanActiveWorkspace()}
          disabled={!activeRoot || isScanning}
          title="Rescan active workspace"
          className="p-1.5 rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 transition-colors"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isScanning ? 'animate-spin text-blue-500' : ''}`} />
        </button>

        <button
          type="button"
          onClick={() => void setIncludeSubmodules(!includeSubmodules)}
          title="Toggle scanning nested Git submodules"
          className={`flex items-center px-2 py-1 text-[11px] font-medium rounded-md border transition-colors ${
            includeSubmodules
              ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300'
              : 'bg-white border-gray-200 text-gray-500 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-400'
          }`}
        >
          <GitFork className="w-3 h-3 mr-1" />
          Submodules
        </button>
      </div>

      <div data-tauri-drag-region className="flex-1 max-w-xs mx-3">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1.5 text-gray-400 pointer-events-none" />
          <input
            ref={searchInputRef}
            type="text"
            placeholder="Filter repositories (⌘F)"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1 bg-gray-200/70 dark:bg-gray-800/90 border border-transparent focus:border-blue-500/50 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
          />
        </div>
      </div>

      <div data-tauri-drag-region className="flex items-center space-x-1.5">
        <button
          type="button"
          disabled={!hasRepos || busy}
          onClick={() => void requestBatchAction('fetch')}
          title={`Fetch remotes for ${targetCount} repositories`}
          className="flex items-center px-2 py-1 text-xs font-medium rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          <Download className="w-3.5 h-3.5 mr-1 text-gray-500" />
          Fetch
        </button>

        <button
          type="button"
          disabled={!hasRepos || busy}
          onClick={() => void requestBatchAction('sync')}
          title={`Fast-forward pull ${targetCount} repositories`}
          className="flex items-center px-2.5 py-1 text-xs font-medium rounded-md bg-blue-600 hover:bg-blue-700 text-white shadow-sm disabled:opacity-40 transition-colors"
        >
          <ArrowDownToLine className="w-3.5 h-3.5 mr-1" />
          Pull{selectedRepoPaths.size > 0 ? ` (${selectedRepoPaths.size})` : ''}
        </button>

        <button
          type="button"
          disabled={!hasRepos || busy}
          onClick={() => void requestBatchAction('reset-to-main')}
          title={`Checkout default branch and fast-forward ${targetCount} repositories`}
          className="flex items-center px-2.5 py-1 text-xs font-medium rounded-md bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
        >
          <GitMerge className="w-3.5 h-3.5 mr-1 text-amber-500" />
          Reset to Main
        </button>

        <button
          type="button"
          onClick={() => setConsoleOpen(!isConsoleOpen)}
          title="Toggle Git execution log console"
          className={`p-1.5 rounded-md border text-xs transition-colors ${
            isConsoleOpen
              ? 'bg-blue-50 border-blue-200 text-blue-600 dark:bg-blue-900/30 dark:border-blue-800 dark:text-blue-300'
              : 'bg-white border-gray-200 text-gray-600 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300'
          }`}
        >
          <Terminal className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          onClick={() => setAboutOpen(true)}
          title="About Mainline & What's New"
          aria-label="About Mainline"
          className="p-1.5 rounded-md border bg-white border-gray-200 text-gray-600 hover:bg-gray-50 dark:bg-gray-800 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-700 text-xs transition-colors"
        >
          <Info className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
