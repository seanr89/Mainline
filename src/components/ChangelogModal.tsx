import React, { useMemo, useState } from 'react';
import { Check, Copy, FileText, ScrollText, Search, X } from 'lucide-react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ChangelogSectionList } from './ChangelogSectionList';
import { ModalDialog } from './ModalDialog';

export const ChangelogModal: React.FC = () => {
  const { isChangelogOpen, setChangelogOpen, appVersionInfo } = useWorkspaceStore();

  const [selectedVersion, setSelectedVersion] = useState<string | 'all'>('all');
  const [filterText, setFilterText] = useState('');
  const [viewMode, setViewMode] = useState<'formatted' | 'raw'>('formatted');
  const [copied, setCopied] = useState(false);

  const releases = appVersionInfo?.releases ?? [];
  const currentVersion = appVersionInfo?.version ?? '0.1.0';
  const rawChangelog = appVersionInfo?.raw_changelog ?? '';

  const filteredReleases = useMemo(() => {
    const query = filterText.trim().toLowerCase();
    return releases
      .filter((release) => selectedVersion === 'all' || release.version === selectedVersion)
      .map((release) => {
        if (!query) return release;
        const versionMatches =
          release.version.toLowerCase().includes(query) ||
          release.date.toLowerCase().includes(query);
        if (versionMatches) return release;

        const matchingSections = release.sections
          .map((section) => {
            if (section.category.toLowerCase().includes(query)) {
              return section;
            }
            const items = section.items.filter((item) => item.toLowerCase().includes(query));
            return items.length > 0 ? { ...section, items } : null;
          })
          .filter((s): s is NonNullable<typeof s> => s !== null);

        return matchingSections.length > 0 ? { ...release, sections: matchingSections } : null;
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);
  }, [releases, selectedVersion, filterText]);

  const handleCopyMarkdown = async () => {
    if (!rawChangelog) return;
    try {
      await navigator.clipboard.writeText(rawChangelog);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard API may be unavailable in restricted contexts
    }
  };

  return (
    <ModalDialog
      isOpen={isChangelogOpen}
      onClose={() => setChangelogOpen(false)}
      labelledBy="changelog-dialog-title"
    >
      <div className="w-[min(94vw,48rem)] h-[min(85vh,38rem)] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-200/90 dark:border-gray-800 flex flex-col overflow-hidden text-gray-900 dark:text-gray-100">
        <div className="px-5 py-3.5 border-b border-gray-200/80 dark:border-gray-800/80 bg-gray-50/80 dark:bg-gray-900/80 flex items-center justify-between gap-3">
          <div className="flex items-center space-x-2.5 min-w-0">
            <ScrollText className="w-4 h-4 text-blue-500 shrink-0" />
            <h1
              id="changelog-dialog-title"
              className="text-sm font-semibold text-gray-900 dark:text-white truncate"
            >
              Mainline Changelog
            </h1>
            <span className="px-2 py-0.5 rounded-full text-[11px] font-mono bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800 shrink-0">
              v{currentVersion}
            </span>
          </div>

          <div className="flex items-center space-x-2">
            <div className="inline-flex rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setViewMode('formatted')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'formatted'
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Releases
              </button>
              <button
                type="button"
                onClick={() => setViewMode('raw')}
                className={`px-2 py-0.5 rounded transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-blue-600 text-white font-medium'
                    : 'text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white'
                }`}
              >
                Markdown
              </button>
            </div>

            <button
              type="button"
              onClick={() => setChangelogOpen(false)}
              aria-label="Close Changelog dialog"
              className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {viewMode === 'formatted' ? (
          <div className="flex-1 flex min-h-0 overflow-hidden">
            <aside className="w-44 shrink-0 border-r border-gray-200/80 dark:border-gray-800/80 bg-gray-50/50 dark:bg-gray-950/40 flex flex-col p-2.5 space-y-1 overflow-y-auto">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                Versions ({releases.length})
              </div>
              <button
                type="button"
                onClick={() => setSelectedVersion('all')}
                className={`w-full text-left px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  selectedVersion === 'all'
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-600 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800/60'
                }`}
              >
                All Releases
              </button>
              {releases.map((release) => {
                const isSelected = selectedVersion === release.version;
                const isCurrent = release.version === currentVersion;
                return (
                  <button
                    key={release.version}
                    type="button"
                    onClick={() => setSelectedVersion(release.version)}
                    className={`w-full text-left px-2.5 py-1.5 rounded-md transition-colors ${
                      isSelected
                        ? 'bg-blue-500 text-white'
                        : 'text-gray-700 dark:text-gray-300 hover:bg-gray-200/60 dark:hover:bg-gray-800/60'
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs font-mono font-medium">
                      <span>v{release.version}</span>
                      {isCurrent && (
                        <span
                          className={`text-[9px] px-1.5 py-0.2 rounded-full font-sans ${
                            isSelected
                              ? 'bg-blue-600 text-white'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300'
                          }`}
                        >
                          Current
                        </span>
                      )}
                    </div>
                    {release.date && (
                      <div
                        className={`text-[10px] font-mono mt-0.5 ${
                          isSelected ? 'text-blue-100' : 'text-gray-400'
                        }`}
                      >
                        {release.date}
                      </div>
                    )}
                  </button>
                );
              })}
            </aside>

            <div className="flex-1 flex flex-col min-w-0 min-h-0">
              <div className="px-4 py-2.5 border-b border-gray-200/70 dark:border-gray-800/70">
                <div className="relative">
                  <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-gray-400 pointer-events-none" />
                  <input
                    type="text"
                    value={filterText}
                    onChange={(e) => setFilterText(e.target.value)}
                    placeholder="Filter releases or changes..."
                    aria-label="Filter changelog entries"
                    className="w-full pl-8 pr-3 py-1.5 bg-gray-100/90 dark:bg-gray-800/80 border border-transparent focus:border-blue-500/50 rounded-md text-xs focus:ring-1 focus:ring-blue-500 outline-none text-gray-900 dark:text-gray-100 placeholder-gray-400"
                  />
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-5 space-y-6">
                {filteredReleases.length === 0 ? (
                  <div className="py-12 text-center text-xs text-gray-500 dark:text-gray-400">
                    No changelog entries matched &ldquo;{filterText}&rdquo;.
                  </div>
                ) : (
                  filteredReleases.map((release) => (
                    <section
                      key={release.version}
                      className="pb-5 border-b border-gray-200/70 dark:border-gray-800/70 last:border-b-0 last:pb-0 space-y-3"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <h2 className="text-sm font-semibold font-mono text-gray-900 dark:text-white">
                            v{release.version}
                          </h2>
                          {release.version === currentVersion && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                              Installed
                            </span>
                          )}
                        </div>
                        {release.date && (
                          <span className="text-[11px] font-mono text-gray-400">
                            {release.date}
                          </span>
                        )}
                      </div>

                      <ChangelogSectionList sections={release.sections} />
                    </section>
                  ))
                )}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <div className="px-4 py-2 border-b border-gray-200/70 dark:border-gray-800/70 flex items-center justify-between bg-gray-50/40 dark:bg-gray-950/30">
              <div className="flex items-center space-x-1.5 text-[11px] font-mono text-gray-500 dark:text-gray-400">
                <FileText className="w-3.5 h-3.5" />
                <span>CHANGELOG.md</span>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyMarkdown()}
                className="inline-flex items-center px-2.5 py-1 rounded text-[11px] font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                {copied ? (
                  <>
                    <Check className="w-3 h-3 mr-1 text-emerald-500" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="w-3 h-3 mr-1" />
                    Copy Markdown
                  </>
                )}
              </button>
            </div>
            <pre className="flex-1 overflow-auto p-4 text-xs font-mono text-gray-700 dark:text-gray-300 bg-gray-50/70 dark:bg-gray-950/60 whitespace-pre-wrap select-text">
              {rawChangelog || 'No CHANGELOG.md content bundled.'}
            </pre>
          </div>
        )}

        <div className="px-5 py-3 bg-gray-50/80 dark:bg-gray-900/80 border-t border-gray-200/80 dark:border-gray-800/80 flex items-center justify-between">
          <span className="text-[11px] text-gray-500 dark:text-gray-400">
            Bundled offline release history ({releases.length}{' '}
            {releases.length === 1 ? 'version' : 'versions'})
          </span>
          <button
            type="button"
            autoFocus
            onClick={() => setChangelogOpen(false)}
            className="px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
