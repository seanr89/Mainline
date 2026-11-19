import React, { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Trash2 } from 'lucide-react';
import { LogPayload } from '../bindings';
import { useWorkspaceStore } from '../store/workspaceStore';

export const ConsoleDrawer: React.FC = () => {
  const { isConsoleOpen } = useWorkspaceStore();
  const [logs, setLogs] = useState<LogPayload[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const unlistenPromise = listen<LogPayload>('git-log', (event) => {
      if (!active) return;
      setLogs((prev) => [...prev.slice(-199), event.payload]);
    });
    return () => {
      active = false;
      void unlistenPromise.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    if (isConsoleOpen) {
      endRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, isConsoleOpen]);

  if (!isConsoleOpen) return null;

  return (
    <div className="h-44 shrink-0 border-t border-gray-200 dark:border-gray-800 bg-gray-950 text-gray-200 font-mono text-[11px] flex flex-col">
      <div className="px-3 py-1 bg-gray-900 text-gray-400 font-sans text-[10px] uppercase font-bold tracking-wider border-b border-gray-800 flex items-center justify-between">
        <span>Execution Log Console</span>
        <button
          type="button"
          onClick={() => setLogs([])}
          className="flex items-center space-x-1 text-[10px] normal-case font-medium text-gray-400 hover:text-gray-200"
        >
          <Trash2 className="w-3 h-3" />
          <span>Clear</span>
        </button>
      </div>
      <div className="flex-1 p-2.5 overflow-y-auto space-y-1">
        {logs.length === 0 ? (
          <div className="text-gray-500">Waiting for Git operations...</div>
        ) : (
          logs.map((log, index) => (
            <div
              key={index}
              className={`flex space-x-2 ${log.is_stderr ? 'text-rose-400' : 'text-emerald-400'}`}
            >
              <span className="text-gray-500 shrink-0">
                [{log.repo_path.split(/[/\\]/).pop()}]
              </span>
              <span className="break-all whitespace-pre-wrap">{log.line}</span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  );
};
