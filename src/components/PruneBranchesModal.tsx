import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  GitBranch,
  Loader2,
  RefreshCw,
  Scissors,
  Search,
  ShieldAlert,
  Trash2,
  X,
} from 'lucide-react';
import { BranchPruneTarget, DefunctBranchInfo, RepoDefunctBranches } from '../bindings';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ModalDialog } from './ModalDialog';

function branchKey(repoPath: string, branchName: string): string {
  return `${repoPath}\0${branchName}`;
}

function formatCommitDate(timestampSec: number): string {
  if (!timestampSec || timestampSec <= 0) return '';
  return new Date(timestampSec * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

interface SelectedEntry {
  repo: RepoDefunctBranches;
  branch: DefunctBranchInfo;
}

export const PruneBranchesModal: React.FC = () => {
  const {
    isPruneModalOpen,
    isScanningDefunct,
    isPruningBranches,
    pruneScopeLabel,
    defunctByRepo,
    lastPruneOutcomes,
    rescanDefunctBranches,
    executePruneBranches,
    closePruneModal,
  } = useWorkspaceStore();

  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState('');
  const [confirmForceStep, setConfirmForceStep] = useState(false);

  useEffect(() => {
    if (!isPruneModalOpen) {
      setFilterText('');
      setConfirmForceStep(false);
      setSelectedKeys(new Set());
      return;
    }

    const safeDefaults = new Set<string>();
    for (const repo of defunctByRepo) {
      for (const branch of repo.branches) {
        if (branch.can_delete && branch.is_merged) {
          safeDefaults.add(branchKey(repo.absolute_path, branch.name));
        }
      }
    }
    setSelectedKeys(safeDefaults);
    setConfirmForceStep(false);
  }, [defunctByRepo, isPruneModalOpen]);

  const filteredRepos = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    if (!query) return defunctByRepo;

    return defunctByRepo
      .map((repo) => {
        const repoMatch =
          repo.repo_name.toLowerCase().includes(query) ||
          repo.relative_path.toLowerCase().includes(query);
        if (repoMatch) return repo;

        const matchingBranches = repo.branches.filter(
          (b) =>
            b.name.toLowerCase().includes(query) ||
            b.upstream.toLowerCase().includes(query) ||
            b.last_commit_title.toLowerCase().includes(query)
        );
        if (matchingBranches.length === 0) return null;
        return { ...repo, branches: matchingBranches };
      })
      .filter((r): r is RepoDefunctBranches => r !== null);
  }, [defunctByRepo, filterText]);

  const totals = useMemo(() => {
    let totalBranches = 0;
    let safeDeletable = 0;
    let totalDeletable = 0;
    for (const repo of defunctByRepo) {
      for (const branch of repo.branches) {
        totalBranches += 1;
        if (branch.can_delete) {
          totalDeletable += 1;
          if (branch.is_merged) safeDeletable += 1;
        }
      }
    }
    return { totalBranches, safeDeletable, totalDeletable };
  }, [defunctByRepo]);

  const selectedEntries = useMemo<SelectedEntry[]>(() => {
    const entries: SelectedEntry[] = [];
    for (const repo of defunctByRepo) {
      for (const branch of repo.branches) {
        if (branch.can_delete && selectedKeys.has(branchKey(repo.absolute_path, branch.name))) {
          entries.push({ repo, branch });
        }
      }
    }
    return entries;
  }, [defunctByRepo, selectedKeys]);

  const selectedMergedEntries = useMemo(
    () => selectedEntries.filter((e) => e.branch.is_merged),
    [selectedEntries]
  );
  const selectedUnmergedEntries = useMemo(
    () => selectedEntries.filter((e) => !e.branch.is_merged),
    [selectedEntries]
  );

  const outcomeSummary = useMemo(() => {
    if (!lastPruneOutcomes || lastPruneOutcomes.length === 0) return null;
    const deletedCount = lastPruneOutcomes.filter((o) => o.deleted).length;
    const failed = lastPruneOutcomes.filter((o) => !o.deleted);
    return { deletedCount, failed };
  }, [lastPruneOutcomes]);

  const toggleBranch = (repoPath: string, branchName: string) => {
    const key = branchKey(repoPath, branchName);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const selectSafeOnly = () => {
    const next = new Set<string>();
    for (const repo of defunctByRepo) {
      for (const branch of repo.branches) {
        if (branch.can_delete && branch.is_merged) {
          next.add(branchKey(repo.absolute_path, branch.name));
        }
      }
    }
    setSelectedKeys(next);
  };

  const selectAllDeletable = () => {
    const next = new Set<string>();
    for (const repo of defunctByRepo) {
      for (const branch of repo.branches) {
        if (branch.can_delete) {
          next.add(branchKey(repo.absolute_path, branch.name));
        }
      }
    }
    setSelectedKeys(next);
  };

  const runPrune = async (entries: SelectedEntry[], allowForce: boolean) => {
    const targets: BranchPruneTarget[] = entries.map(({ repo, branch }) => ({
      repo_path: repo.absolute_path,
      branch_name: branch.name,
      force: allowForce && !branch.is_merged,
    }));
    setConfirmForceStep(false);
    await executePruneBranches(targets);
  };

  const handlePrimaryDelete = () => {
    if (selectedEntries.length === 0 || isScanningDefunct || isPruningBranches) return;
    if (selectedUnmergedEntries.length > 0) {
      setConfirmForceStep(true);
      return;
    }
    void runPrune(selectedEntries, false);
  };

  const busy = isScanningDefunct || isPruningBranches;

  return (
    <ModalDialog
      isOpen={isPruneModalOpen}
      onClose={closePruneModal}
      labelledBy="prune-branches-dialog-title"
    >
      <div className="w-[min(94vw,46rem)] max-h-[85vh] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-200/90 dark:border-gray-800 flex flex-col overflow-hidden text-gray-900 dark:text-gray-100">
        <div className="px-5 py-3.5 border-b border-gray-200/80 dark:border-gray-800/80 bg-gray-50/80 dark:bg-gray-900/80 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5 min-w-0">
            <Scissors className="w-4 h-4 text-rose-500 shrink-0" />
            <h1
              id="prune-branches-dialog-title"
              className="text-sm font-semibold text-gray-900 dark:text-white truncate"
            >
              Prune Defunct Local Branches
            </h1>
            {pruneScopeLabel && (
              <span className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-200/80 dark:bg-gray-800 text-gray-700 dark:text-gray-300 truncate max-w-[14rem]">
                {pruneScopeLabel}
              </span>
            )}
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void rescanDefunctBranches(true)}
              title="Run git fetch --all --prune and rescan for [gone] branches"
              className="inline-flex items-center px-2.5 py-1 rounded-md text-[11px] font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 transition-colors"
            >
              <RefreshCw
                className={`w-3 h-3 mr-1.5 ${isScanningDefunct ? 'animate-spin text-blue-500' : ''}`}
              />
              Fetch &amp; Rescan
            </button>

            <button
              type="button"
              onClick={closePruneModal}
              aria-label="Close Prune Branches dialog"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {outcomeSummary && (
          <div
            className={`px-5 py-2 border-b text-xs flex items-start justify-between gap-3 ${
              outcomeSummary.failed.length > 0
                ? 'bg-amber-50/90 dark:bg-amber-950/40 border-amber-200/80 dark:border-amber-800/70 text-amber-800 dark:text-amber-200'
                : 'bg-emerald-50/90 dark:bg-emerald-950/40 border-emerald-200/80 dark:border-emerald-800/70 text-emerald-800 dark:text-emerald-200'
            }`}
          >
            <div className="flex items-start space-x-2">
              {outcomeSummary.failed.length > 0 ? (
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              ) : (
                <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              )}
              <div>
                <p className="font-medium">
                  Pruned {outcomeSummary.deletedCount}{' '}
                  {outcomeSummary.deletedCount === 1 ? 'branch' : 'branches'}
                  {outcomeSummary.failed.length > 0
                    ? ` (${outcomeSummary.failed.length} failed or protected)`
                    : '.'}
                </p>
                {outcomeSummary.failed.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[11px] font-mono">
                    {outcomeSummary.failed.map((item, idx) => (
                      <li key={`${item.repo_path}-${item.branch_name}-${idx}`}>
                        {item.branch_name}: {item.error ?? 'Could not delete'}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        )}

        {confirmForceStep ? (
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <div className="flex items-start space-x-3 text-amber-500">
              <AlertTriangle className="w-6 h-6 shrink-0 mt-0.5" />
              <div>
                <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                  Unmerged Branches Selected for Deletion
                </h2>
                <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                  {selectedUnmergedEntries.length === 1
                    ? 'The following [gone] branch is not fully merged into the default branch (it may have been squash-merged or have unmerged commits).'
                    : `The following ${selectedUnmergedEntries.length} [gone] branches are not fully merged into the default branch (they may have been squash-merged or have unmerged commits).`}{' '}
                  Safe deletion (<code className="font-mono">git branch -d</code>) will refuse
                  these branches unless you confirm force deletion (
                  <code className="font-mono">git branch -D</code>).
                </p>
              </div>
            </div>

            <div className="max-h-52 overflow-y-auto border border-amber-200/80 dark:border-amber-900/70 rounded-lg p-2.5 bg-amber-50/40 dark:bg-amber-950/20 space-y-1.5">
              {selectedUnmergedEntries.map(({ repo, branch }) => (
                <div
                  key={branchKey(repo.absolute_path, branch.name)}
                  className="flex items-center justify-between text-xs px-2 py-1 rounded bg-white/80 dark:bg-gray-900/70 border border-gray-200/70 dark:border-gray-800"
                >
                  <div className="min-w-0 truncate">
                    <span className="font-medium text-gray-800 dark:text-gray-200">
                      {repo.repo_name}
                    </span>
                    <span className="mx-1.5 text-gray-400">/</span>
                    <span className="font-mono text-amber-700 dark:text-amber-300">
                      {branch.name}
                    </span>
                  </div>
                  <span className="ml-2 shrink-0 font-mono text-[10px] text-gray-400">
                    {branch.last_commit_hash}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col space-y-2 pt-2">
              {selectedMergedEntries.length > 0 && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void runPrune(selectedMergedEntries, false)}
                  className="w-full py-2 px-3 bg-blue-600 hover:bg-blue-700 text-white rounded-md text-xs font-medium transition-colors disabled:opacity-40"
                >
                  Delete {selectedMergedEntries.length} Merged{' '}
                  {selectedMergedEntries.length === 1 ? 'Branch' : 'Branches'} Only (-d)
                </button>
              )}

              <button
                type="button"
                disabled={busy}
                onClick={() => void runPrune(selectedEntries, true)}
                className="w-full py-2 px-3 bg-rose-600 hover:bg-rose-700 text-white rounded-md text-xs font-medium transition-colors disabled:opacity-40"
              >
                Force Delete {selectedEntries.length} Selected{' '}
                {selectedEntries.length === 1 ? 'Branch' : 'Branches'} (-D / -d)
              </button>

              <button
                type="button"
                autoFocus
                disabled={busy}
                onClick={() => setConfirmForceStep(false)}
                className="w-full py-2 px-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 rounded-md text-xs font-medium transition-colors"
              >
                Back to Review
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="px-5 py-2.5 border-b border-gray-200/70 dark:border-gray-800/70 flex flex-wrap items-center justify-between gap-2 bg-white/50 dark:bg-gray-900/40">
              <div className="relative flex-1 min-w-[200px]">
                <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400 pointer-events-none" />
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="Filter repositories or branches..."
                  aria-label="Filter defunct branches"
                  className="w-full pl-8 pr-3 py-1.5 bg-gray-100/90 dark:bg-gray-800/80 border border-transparent focus:border-blue-500/50 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
                />
              </div>

              <div className="flex items-center space-x-1.5 text-[11px]">
                <button
                  type="button"
                  disabled={busy || totals.safeDeletable === 0}
                  onClick={selectSafeOnly}
                  className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 transition-colors"
                >
                  Select Safe ({totals.safeDeletable})
                </button>
                <button
                  type="button"
                  disabled={busy || totals.totalDeletable === 0}
                  onClick={selectAllDeletable}
                  className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 disabled:opacity-40 transition-colors"
                >
                  Select All ({totals.totalDeletable})
                </button>
                <button
                  type="button"
                  disabled={busy || selectedKeys.size === 0}
                  onClick={() => setSelectedKeys(new Set())}
                  className="px-2 py-1 rounded bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 disabled:opacity-40 transition-colors"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-[16rem]">
              {isScanningDefunct ? (
                <div className="py-16 flex flex-col items-center justify-center text-gray-500 dark:text-gray-400 space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-500" />
                  <p className="text-xs font-medium">
                    Scanning repositories for defunct [gone] local branches...
                  </p>
                </div>
              ) : defunctByRepo.length === 0 ? (
                <div className="py-14 flex flex-col items-center justify-center text-center space-y-2 text-gray-500 dark:text-gray-400">
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/80" />
                  <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                    No Defunct Local Branches Found
                  </p>
                  <p className="text-[11px] max-w-sm">
                    All local tracking branches in {pruneScopeLabel || 'this workspace'} still
                    have active remote refs on <code className="font-mono">origin</code>.
                  </p>
                </div>
              ) : filteredRepos.length === 0 ? (
                <div className="py-12 text-center text-xs text-gray-500 dark:text-gray-400">
                  No branches matched &ldquo;{filterText}&rdquo;.
                </div>
              ) : (
                filteredRepos.map((repo) => (
                  <section
                    key={repo.absolute_path}
                    className="rounded-lg border border-gray-200/80 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-950/40 overflow-hidden"
                  >
                    <div className="px-3.5 py-2 bg-gray-100/70 dark:bg-gray-900/70 border-b border-gray-200/70 dark:border-gray-800/80 flex items-center justify-between gap-2">
                      <div className="flex items-center space-x-2 min-w-0">
                        <span className="text-xs font-semibold text-gray-900 dark:text-gray-100 truncate">
                          {repo.repo_name}
                        </span>
                        <span className="text-[11px] text-gray-400 truncate">
                          {repo.relative_path}
                        </span>
                      </div>
                      <div className="flex items-center space-x-2 shrink-0 text-[10px]">
                        <span className="font-mono text-gray-500 dark:text-gray-400">
                          default: {repo.default_branch}
                        </span>
                        <span className="px-1.5 py-0.5 rounded-full bg-gray-200/80 dark:bg-gray-800 text-gray-600 dark:text-gray-300 font-medium tabular-nums">
                          {repo.branches.length} gone
                        </span>
                      </div>
                    </div>

                    {repo.fetch_error && (
                      <div className="px-3.5 py-1.5 bg-amber-50/80 dark:bg-amber-950/40 border-b border-amber-200/70 dark:border-amber-900/60 text-[11px] text-amber-700 dark:text-amber-300 flex items-center space-x-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate" title={repo.fetch_error}>
                          Fetch warning (showing locally known refs): {repo.fetch_error}
                        </span>
                      </div>
                    )}

                    {repo.branches.length > 0 && (
                      <div className="divide-y divide-gray-200/60 dark:divide-gray-800/70">
                        {repo.branches.map((branch) => {
                          const key = branchKey(repo.absolute_path, branch.name);
                          const checked = branch.can_delete && selectedKeys.has(key);
                          const dateLabel = formatCommitDate(branch.last_commit_timestamp);
                          const protectedReason = branch.is_current
                            ? 'Protected: currently checked-out branch'
                            : branch.is_default
                              ? 'Protected: repository default branch'
                              : undefined;

                          return (
                            <label
                              key={key}
                              title={protectedReason}
                              className={`flex items-start space-x-3 px-3.5 py-2.5 text-xs transition-colors ${
                                branch.can_delete
                                  ? 'cursor-pointer hover:bg-white/80 dark:hover:bg-gray-900/60'
                                  : 'opacity-65 cursor-not-allowed bg-gray-100/40 dark:bg-gray-900/30'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                disabled={!branch.can_delete || busy}
                                onChange={() => toggleBranch(repo.absolute_path, branch.name)}
                                className="mt-0.5 rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                              />

                              <div className="flex-1 min-w-0 space-y-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <GitBranch className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                                  <span className="font-mono font-medium text-gray-900 dark:text-gray-100 break-all">
                                    {branch.name}
                                  </span>

                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-200/70 dark:bg-gray-800 text-gray-600 dark:text-gray-300">
                                    [gone]{branch.upstream ? ` ${branch.upstream}` : ''}
                                  </span>

                                  {branch.is_current ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                                      <ShieldAlert className="w-3 h-3 mr-1" />
                                      Checked Out (Protected)
                                    </span>
                                  ) : branch.is_default ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                                      <ShieldAlert className="w-3 h-3 mr-1" />
                                      Default (Protected)
                                    </span>
                                  ) : branch.is_merged ? (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                                      Merged
                                    </span>
                                  ) : (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                                      Unmerged / Squash-merged
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center space-x-2 text-[11px] text-gray-500 dark:text-gray-400 truncate">
                                  {branch.last_commit_hash && (
                                    <span className="font-mono text-gray-400 shrink-0">
                                      {branch.last_commit_hash}
                                    </span>
                                  )}
                                  <span className="truncate">
                                    {branch.last_commit_title || 'No commit message'}
                                  </span>
                                  {dateLabel && (
                                    <span className="text-[10px] text-gray-400 shrink-0">
                                      · {dateLabel}
                                    </span>
                                  )}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    )}
                  </section>
                ))
              )}
            </div>

            <div className="px-5 py-3.5 bg-gray-50/80 dark:bg-gray-900/80 border-t border-gray-200/80 dark:border-gray-800/80 flex items-center justify-between gap-3">
              <div className="text-[11px] text-gray-500 dark:text-gray-400">
                {totals.totalBranches > 0 ? (
                  <span>
                    {selectedEntries.length} selected of {totals.totalDeletable} deletable
                    {selectedUnmergedEntries.length > 0 && (
                      <span className="ml-1.5 text-amber-600 dark:text-amber-400 font-medium">
                        ({selectedUnmergedEntries.length} unmerged)
                      </span>
                    )}
                  </span>
                ) : (
                  <span>Ready</span>
                )}
              </div>

              <div className="flex items-center space-x-2">
                <button
                  type="button"
                  autoFocus
                  onClick={closePruneModal}
                  className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                >
                  Close
                </button>

                <button
                  type="button"
                  disabled={selectedEntries.length === 0 || busy}
                  onClick={handlePrimaryDelete}
                  className="inline-flex items-center px-3.5 py-1.5 rounded-md text-xs font-medium bg-rose-600 hover:bg-rose-700 text-white shadow-sm disabled:opacity-40 transition-colors"
                >
                  {isPruningBranches ? (
                    <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Trash2 className="w-3.5 h-3.5 mr-1.5" />
                  )}
                  Delete Selected ({selectedEntries.length})
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </ModalDialog>
  );
};
