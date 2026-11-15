import React, { useMemo, useState } from 'react';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  SortingState,
  flexRender,
  createColumnHelper,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { AlertTriangle, ArrowUp, ArrowDown, ArrowUpDown, FolderGit2 } from 'lucide-react';
import { RepoStatus } from '../bindings';
import { useWorkspaceStore } from '../store/workspaceStore';
import { BranchDropdown } from './BranchDropdown';

const columnHelper = createColumnHelper<RepoStatus>();

const COLUMN_CLASSES: Record<string, string> = {
  select: 'w-9 shrink-0 flex items-center justify-center',
  name: 'flex-[2.2] min-w-[200px] px-3 truncate',
  current_branch: 'flex-[1.3] min-w-[150px] px-3',
  is_dirty: 'w-32 shrink-0 px-3',
  ahead_count: 'w-28 shrink-0 px-3',
  last_commit_title: 'flex-[1.8] min-w-[180px] px-3 truncate',
};

export const RepoTable: React.FC = () => {
  const {
    repositories,
    activeRoot,
    activeFilter,
    searchQuery,
    selectedRepoPaths,
    toggleSelectRepo,
    selectAllPaths,
    clearSelection,
  } = useWorkspaceStore();

  const [sorting, setSorting] = useState<SortingState>([]);

  const filteredData = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return repositories.filter((repo) => {
      if (q) {
        const matches =
          repo.name.toLowerCase().includes(q) ||
          repo.relative_path.toLowerCase().includes(q) ||
          repo.current_branch.toLowerCase().includes(q);
        if (!matches) return false;
      }
      if (activeFilter === 'off-main') return repo.current_branch !== repo.default_branch;
      if (activeFilter === 'dirty') return repo.is_dirty;
      if (activeFilter === 'behind') return repo.behind_count > 0;
      return true;
    });
  }, [repositories, activeFilter, searchQuery]);

  const allVisibleSelected =
    filteredData.length > 0 &&
    filteredData.every((r) => selectedRepoPaths.has(r.absolute_path));

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            checked={allVisibleSelected}
            onChange={(e) => {
              if (e.target.checked) {
                selectAllPaths(filteredData.map((r) => r.absolute_path));
              } else {
                clearSelection();
              }
            }}
            className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
          />
        ),
        cell: ({ row }) => {
          const checked = selectedRepoPaths.has(row.original.absolute_path);
          return (
            <input
              type="checkbox"
              checked={checked}
              onClick={(e) => {
                e.stopPropagation();
                toggleSelectRepo(
                  row.original.absolute_path,
                  { meta: true, shift: e.shiftKey },
                  filteredData.map((r) => r.absolute_path)
                );
              }}
              onChange={() => {}}
              className="rounded border-gray-300 dark:border-gray-600 text-blue-600 focus:ring-blue-500"
            />
          );
        },
      }),
      columnHelper.accessor('name', {
        header: 'Repository',
        cell: (info) => (
          <div className="truncate">
            <span className="font-semibold text-gray-900 dark:text-gray-100">
              {info.getValue()}
            </span>
            <span className="ml-2 text-gray-400 font-normal text-[11px]">
              {info.row.original.relative_path}
            </span>
          </div>
        ),
      }),
      columnHelper.accessor('current_branch', {
        header: 'Branch',
        cell: (info) => <BranchDropdown repo={info.row.original} />,
      }),
      columnHelper.accessor('is_dirty', {
        header: 'Status',
        cell: (info) => {
          const stashed = info.row.original.stashed_count;
          return (
            <div className="flex items-center space-x-1.5">
              {info.getValue() ? (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300">
                  <AlertTriangle className="w-3 h-3 mr-1" />
                  Dirty
                </span>
              ) : (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300">
                  Clean
                </span>
              )}
              {stashed > 0 && (
                <span className="text-[10px] px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-500">
                  +{stashed}s
                </span>
              )}
            </div>
          );
        },
      }),
      columnHelper.accessor('ahead_count', {
        header: 'Sync State',
        cell: (info) => {
          const ahead = info.getValue();
          const behind = info.row.original.behind_count;
          return (
            <div className="flex items-center space-x-2 text-xs text-gray-500 tabular-nums">
              {ahead > 0 && (
                <span className="flex items-center text-blue-600 dark:text-blue-400">
                  <ArrowUp className="w-3 h-3 mr-0.5" />
                  {ahead}
                </span>
              )}
              {behind > 0 && (
                <span className="flex items-center text-rose-600 dark:text-rose-400">
                  <ArrowDown className="w-3 h-3 mr-0.5" />
                  {behind}
                </span>
              )}
              {ahead === 0 && behind === 0 && <span className="text-gray-400">Synced</span>}
            </div>
          );
        },
      }),
      columnHelper.accessor('last_commit_title', {
        header: 'Last Commit',
        cell: (info) => (
          <div className="truncate text-xs text-gray-500 dark:text-gray-400">
            {info.row.original.last_commit_hash && (
              <span className="font-mono text-[11px] text-gray-400 mr-1.5">
                {info.row.original.last_commit_hash}
              </span>
            )}
            <span>{info.getValue()}</span>
          </div>
        ),
      }),
    ],
    [allVisibleSelected, clearSelection, filteredData, selectAllPaths, selectedRepoPaths, toggleSelectRepo]
  );

  const table = useReactTable({
    data: filteredData,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const tableContainerRef = React.useRef<HTMLDivElement>(null);
  const { rows } = table.getRowModel();
  const orderedPaths = useMemo(() => rows.map((r) => r.original.absolute_path), [rows]);

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 36,
    overscan: 10,
  });

  if (!activeRoot) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-white/85 dark:bg-gray-950/90 text-gray-500 p-8 text-center">
        <FolderGit2 className="w-10 h-10 mb-3 text-gray-300 dark:text-gray-700" />
        <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-200">
          No Workspace Selected
        </h2>
        <p className="text-xs text-gray-400 mt-1 max-w-xs">
          Click <span className="font-medium text-gray-600 dark:text-gray-300">Add Workspace</span>{' '}
          in the toolbar to scan your local Git repositories.
        </p>
      </div>
    );
  }

  return (
    <div ref={tableContainerRef} className="flex-1 overflow-auto bg-white/95 dark:bg-gray-950/95">
      <table className="w-full text-left border-collapse block">
        <thead className="sticky top-0 bg-gray-50/95 dark:bg-gray-900/95 backdrop-blur-sm border-b border-gray-200 dark:border-gray-800 z-10 block">
          {table.getHeaderGroups().map((headerGroup) => (
            <tr key={headerGroup.id} className="flex w-full items-center px-1">
              {headerGroup.headers.map((header) => {
                const colClass = COLUMN_CLASSES[header.column.id] ?? 'flex-1 px-3';
                const canSort = header.column.getCanSort();
                return (
                  <th
                    key={header.id}
                    onClick={canSort ? header.column.getToggleSortingHandler() : undefined}
                    className={`${colClass} py-2 text-[11px] font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider ${
                      canSort ? 'cursor-pointer hover:text-gray-800 dark:hover:text-gray-200' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-1">
                      <span>{flexRender(header.column.columnDef.header, header.getContext())}</span>
                      {canSort && <ArrowUpDown className="w-2.5 h-2.5 opacity-40" />}
                    </div>
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody
          className="block relative w-full"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
        >
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index];
            const isSelected = selectedRepoPaths.has(row.original.absolute_path);
            return (
              <tr
                key={row.id}
                onClick={(e) =>
                  toggleSelectRepo(
                    row.original.absolute_path,
                    { meta: e.metaKey || e.ctrlKey, shift: e.shiftKey },
                    orderedPaths
                  )
                }
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${virtualRow.size}px`,
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className={`border-b border-gray-100 dark:border-gray-900 text-xs flex items-center px-1 cursor-pointer transition-colors ${
                  isSelected
                    ? 'bg-blue-50/90 dark:bg-blue-950/45'
                    : 'hover:bg-gray-50/80 dark:hover:bg-gray-900/50'
                }`}
              >
                {row.getVisibleCells().map((cell) => {
                  const colClass = COLUMN_CLASSES[cell.column.id] ?? 'flex-1 px-3 truncate';
                  return (
                    <td key={cell.id} className={`${colClass} py-1.5`}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};
