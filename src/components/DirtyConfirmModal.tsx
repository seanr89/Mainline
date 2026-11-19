import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { RepoStatus, SyncStrategy } from '../bindings';

interface ModalProps {
  isOpen: boolean;
  dirtyRepos: RepoStatus[];
  cleanCount: number;
  onConfirm: (strategy: SyncStrategy) => void;
  onSkipDirty: () => void;
  onCancel: () => void;
}

export const DirtyConfirmModal: React.FC<ModalProps> = ({
  isOpen,
  dirtyRepos,
  cleanCount,
  onConfirm,
  onSkipDirty,
  onCancel,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/45 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg max-w-md w-full shadow-2xl border border-gray-200 dark:border-gray-800 p-5 space-y-4">
        <div className="flex items-center space-x-3 text-amber-500">
          <AlertTriangle className="w-6 h-6 shrink-0" />
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">
            Uncommitted Changes Detected
          </h3>
        </div>

        <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
          {dirtyRepos.length === 1
            ? 'The following repository has uncommitted working tree modifications.'
            : `The following ${dirtyRepos.length} repositories have uncommitted working tree modifications.`}{' '}
          Choose how Mainline should handle local edits before syncing:
        </p>

        <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-800 rounded p-2 bg-gray-50 dark:bg-gray-950 text-xs space-y-1">
          {dirtyRepos.map((repo) => (
            <div
              key={repo.absolute_path}
              className="flex items-center justify-between font-mono text-gray-700 dark:text-gray-300"
            >
              <span className="truncate">{repo.name}</span>
              <span className="text-[10px] text-amber-600 dark:text-amber-400 ml-2 shrink-0">
                {repo.current_branch}
              </span>
            </div>
          ))}
        </div>

        <div className="flex flex-col space-y-2 pt-1">
          <button
            type="button"
            onClick={() => onConfirm('StashAndPull')}
            className="w-full py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs font-medium transition-colors"
          >
            Stash Changes, Pull & Re-apply
          </button>

          {cleanCount > 0 && (
            <button
              type="button"
              onClick={onSkipDirty}
              className="w-full py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-800 dark:text-gray-200 rounded text-xs font-medium transition-colors"
            >
              Skip Dirty & Sync {cleanCount} Clean Repos
            </button>
          )}

          <button
            type="button"
            onClick={() => onConfirm('HardResetAndPull')}
            className="w-full py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded text-xs font-medium transition-colors"
          >
            Hard Reset (Discard All Changes)
          </button>

          <button
            type="button"
            onClick={onCancel}
            className="w-full py-1.5 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300 rounded text-xs font-medium transition-colors"
          >
            Cancel Operation
          </button>
        </div>
      </div>
    </div>
  );
};
