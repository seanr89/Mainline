import React from 'react';
import { Sparkles, ScrollText, X } from 'lucide-react';
import mainlineIcon from '../../src-tauri/icons/128x128.png';
import { useWorkspaceStore } from '../store/workspaceStore';
import { ChangelogSectionList } from './ChangelogSectionList';
import { ModalDialog } from './ModalDialog';

export const AboutModal: React.FC = () => {
  const { isAboutOpen, setAboutOpen, setChangelogOpen, appVersionInfo } = useWorkspaceStore();

  const version = appVersionInfo?.version ?? '0.1.0';
  const latestRelease = appVersionInfo?.releases[0] ?? null;
  const whatsNewVersion = latestRelease?.version ?? version;

  const handleOpenChangelog = () => {
    setAboutOpen(false);
    setChangelogOpen(true);
  };

  return (
    <ModalDialog
      isOpen={isAboutOpen}
      onClose={() => setAboutOpen(false)}
      labelledBy="about-dialog-title"
    >
      <div className="w-[min(92vw,32rem)] bg-white/95 dark:bg-gray-900/95 backdrop-blur-xl rounded-xl shadow-2xl border border-gray-200/90 dark:border-gray-800 overflow-hidden text-gray-900 dark:text-gray-100">
        <div className="relative px-6 pt-6 pb-5 border-b border-gray-200/80 dark:border-gray-800/80 bg-gradient-to-b from-gray-50/90 to-white dark:from-gray-800/50 dark:to-gray-900">
          <button
            type="button"
            onClick={() => setAboutOpen(false)}
            aria-label="Close About dialog"
            className="absolute top-3.5 right-3.5 p-1.5 rounded-md text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-200/60 dark:hover:bg-gray-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="flex items-center space-x-4">
            <img
              src={mainlineIcon}
              alt="Mainline app icon"
              className="w-16 h-16 rounded-2xl shadow-md ring-1 ring-black/10 dark:ring-white/10 shrink-0"
            />
            <div className="min-w-0">
              <div className="flex items-center space-x-2">
                <h1
                  id="about-dialog-title"
                  className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white"
                >
                  {appVersionInfo?.name ?? 'Mainline'}
                </h1>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800">
                  v{version}
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                High-performance macOS Git Workspace Manager
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200">
              <Sparkles className="w-3.5 h-3.5 text-blue-500" />
              <span>What&apos;s New in v{whatsNewVersion}</span>
            </div>
            {latestRelease?.date && (
              <span className="text-[11px] font-mono text-gray-400">{latestRelease.date}</span>
            )}
          </div>

          <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-200/80 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-950/60 p-3.5">
            {latestRelease ? (
              <ChangelogSectionList sections={latestRelease.sections} compact />
            ) : (
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Release notes are bundled offline inside Mainline.
              </p>
            )}
          </div>
        </div>

        <div className="px-6 py-3.5 bg-gray-50/80 dark:bg-gray-900/80 border-t border-gray-200/80 dark:border-gray-800/80 flex items-center justify-between">
          <button
            type="button"
            onClick={handleOpenChangelog}
            className="inline-flex items-center px-3 py-1.5 rounded-md text-xs font-medium bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 shadow-sm transition-colors"
          >
            <ScrollText className="w-3.5 h-3.5 mr-1.5 text-blue-500" />
            View Full Changelog
          </button>

          <button
            type="button"
            autoFocus
            onClick={() => setAboutOpen(false)}
            className="px-4 py-1.5 rounded-md text-xs font-medium bg-blue-600 hover:bg-blue-700 text-white shadow-sm transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </ModalDialog>
  );
};
