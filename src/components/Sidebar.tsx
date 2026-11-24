import React from 'react';
import {
  Folder,
  GitBranch,
  AlertCircle,
  ArrowDownCircle,
  Layers,
  X,
  ScrollText,
} from 'lucide-react';
import { useWorkspaceStore, FilterType } from '../store/workspaceStore';

export const Sidebar: React.FC = () => {
  const {
    workspaceRoots,
    activeRoot,
    setActiveRoot,
    removeWorkspaceRoot,
    activeFilter,
    setFilter,
    repositories,
    selectedRepoPaths,
    lastScanDurationMs,
    appVersionInfo,
    setAboutOpen,
    setChangelogOpen,
  } = useWorkspaceStore();

  const counts = React.useMemo(() => {
    return {
      all: repositories.length,
      'off-main': repositories.filter((r) => r.current_branch !== r.default_branch).length,
      dirty: repositories.filter((r) => r.is_dirty).length,
      behind: repositories.filter((r) => r.behind_count > 0).length,
    };
  }, [repositories]);

  const navItems: {
    id: FilterType;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    count: number;
  }[] = [
    { id: 'all', label: 'All Repositories', icon: Layers, count: counts.all },
    { id: 'off-main', label: 'Off Main Branch', icon: GitBranch, count: counts['off-main'] },
    { id: 'dirty', label: 'Dirty Working Tree', icon: AlertCircle, count: counts.dirty },
    { id: 'behind', label: 'Behind Remote', icon: ArrowDownCircle, count: counts.behind },
  ];

  return (
    <aside className="w-56 shrink-0 border-r border-gray-200/80 dark:border-gray-800/90 bg-gray-50/45 dark:bg-gray-900/45 backdrop-blur-md flex flex-col h-full select-none">
      <div className="px-3 pt-3 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
        Workspaces
      </div>

      <div className="px-2 space-y-0.5 max-h-48 overflow-y-auto">
        {workspaceRoots.length === 0 ? (
          <div className="px-2 py-2 text-[11px] text-gray-400">No workspace added</div>
        ) : (
          workspaceRoots.map((root) => {
            const label = root.split(/[/\\]/).filter(Boolean).pop() ?? root;
            const isActive = activeRoot === root;
            return (
              <div
                key={root}
                className={`group flex items-center justify-between px-2 py-1.5 rounded-md text-xs font-medium ${
                  isActive
                    ? 'bg-gray-200/75 dark:bg-gray-800 text-gray-900 dark:text-white'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-gray-800/50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => setActiveRoot(root)}
                  title={root}
                  className="flex items-center truncate flex-1 text-left"
                >
                  <Folder className="w-3.5 h-3.5 mr-2 text-blue-500 shrink-0" />
                  <span className="truncate">{label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeWorkspaceRoot(root)}
                  title="Remove workspace from list"
                  className="opacity-0 group-hover:opacity-100 ml-1 p-0.5 rounded hover:bg-gray-300/60 dark:hover:bg-gray-700 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-opacity"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            );
          })
        )}
      </div>

      <div className="px-3 pt-4 pb-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
        Filters
      </div>

      <nav className="px-2 space-y-0.5 flex-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeFilter === item.id;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => setFilter(item.id)}
              className={`w-full flex items-center justify-between px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-blue-500 text-white'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100/80 dark:hover:bg-gray-800/50'
              }`}
            >
              <div className="flex items-center truncate">
                <Icon className="w-3.5 h-3.5 mr-2 shrink-0" />
                <span className="truncate">{item.label}</span>
              </div>
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded-full tabular-nums ${
                  isActive
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200/80 dark:bg-gray-800 text-gray-500 dark:text-gray-400'
                }`}
              >
                {item.count}
              </span>
            </button>
          );
        })}
      </nav>

      <div className="px-3 py-2 border-t border-gray-200/70 dark:border-gray-800/80 space-y-1.5">
        <div className="text-[11px] text-gray-400 flex items-center justify-between">
          <span>{selectedRepoPaths.size} selected</span>
          {lastScanDurationMs !== null && (
            <span className="tabular-nums">{lastScanDurationMs}ms</span>
          )}
        </div>
        <div className="flex items-center justify-between pt-1.5 border-t border-gray-200/50 dark:border-gray-800/60">
          <button
            type="button"
            onClick={() => setAboutOpen(true)}
            title="About Mainline & What's New"
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-medium text-gray-600 dark:text-gray-300 bg-gray-200/70 dark:bg-gray-800 hover:bg-gray-300/70 dark:hover:bg-gray-700 transition-colors"
          >
            v{appVersionInfo?.version ?? '0.1.0'}
          </button>
          <button
            type="button"
            onClick={() => setChangelogOpen(true)}
            title="View full Changelog"
            className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
          >
            <ScrollText className="w-3 h-3 mr-1" />
            Changelog
          </button>
        </div>
      </div>
    </aside>
  );
};
