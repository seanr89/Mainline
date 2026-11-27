import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitBranch, Check, Scissors } from 'lucide-react';
import { RepoStatus, commands } from '../bindings';
import { useWorkspaceStore } from '../store/workspaceStore';

interface BranchDropdownProps {
  repo: RepoStatus;
}

export const BranchDropdown: React.FC<BranchDropdownProps> = ({ repo }) => {
  const { requestBranchCheckout, openPruneModal } = useWorkspaceStore();
  const [isOpen, setIsOpen] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const isOffMain = repo.current_branch !== repo.default_branch;

  useEffect(() => {
    if (!isOpen) return;
    const onOutsideClick = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    window.addEventListener('mousedown', onOutsideClick);
    return () => window.removeEventListener('mousedown', onOutsideClick);
  }, [isOpen]);

  const handleToggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen) {
      setIsLoading(true);
      const res = await commands.listBranches(repo.absolute_path);
      setIsLoading(false);
      if (res.status === 'ok') {
        setBranches(res.data);
      }
    }
  };

  const handleSelectBranch = async (e: React.MouseEvent, branch: string) => {
    e.stopPropagation();
    setIsOpen(false);
    await requestBranchCheckout(repo, branch);
  };

  return (
    <div ref={containerRef} className="relative inline-block max-w-full">
      <button
        type="button"
        onClick={(e) => void handleToggle(e)}
        className={`flex items-center space-x-1 px-1.5 py-0.5 rounded hover:bg-gray-200/60 dark:hover:bg-gray-800 max-w-full transition-colors ${
          repo.is_detached
            ? 'text-rose-600 dark:text-rose-400 font-medium'
            : isOffMain
              ? 'text-amber-600 dark:text-amber-400 font-medium'
              : 'text-gray-700 dark:text-gray-300'
        }`}
      >
        <GitBranch className="w-3.5 h-3.5 shrink-0" />
        <span className="truncate text-xs">{repo.current_branch}</span>
        <ChevronDown className="w-3 h-3 opacity-60 shrink-0" />
      </button>

      {isOpen && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute left-0 mt-1 w-48 max-h-52 overflow-y-auto rounded-md bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 shadow-lg z-40 py-1"
        >
          {isLoading ? (
            <div className="px-3 py-1.5 text-[11px] text-gray-400">Loading branches...</div>
          ) : branches.length === 0 ? (
            <div className="px-3 py-1.5 text-[11px] text-gray-400">No local branches</div>
          ) : (
            branches.map((branch) => {
              const active = branch === repo.current_branch;
              return (
                <button
                  key={branch}
                  type="button"
                  onClick={(e) => void handleSelectBranch(e, branch)}
                  className="w-full flex items-center justify-between px-2.5 py-1 text-left text-xs text-gray-700 dark:text-gray-200 hover:bg-blue-500 hover:text-white transition-colors"
                >
                  <span className="truncate">{branch}</span>
                  {active && <Check className="w-3 h-3 shrink-0 ml-2" />}
                </button>
              );
            })
          )}

          <div className="mt-1 pt-1 border-t border-gray-200 dark:border-gray-800">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setIsOpen(false);
                void openPruneModal([repo], true);
              }}
              className="w-full flex items-center px-2.5 py-1.5 text-left text-[11px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/50 transition-colors"
            >
              <Scissors className="w-3 h-3 mr-1.5 shrink-0" />
              <span className="truncate">Review &amp; Prune Gone Branches…</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
