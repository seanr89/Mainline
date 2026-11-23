import React from 'react';
import { ChangelogSection } from '../bindings';

function renderInlineTokens(text: string): React.ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-semibold text-gray-900 dark:text-gray-100">
          {part.slice(2, -2)}
        </strong>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <code
          key={idx}
          className="px-1 py-0.5 rounded bg-gray-100 dark:bg-gray-800 font-mono text-[11px] text-gray-800 dark:text-gray-200"
        >
          {part.slice(1, -1)}
        </code>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

function categoryBadgeStyle(category: string): string {
  const lower = category.toLowerCase();
  if (lower.includes('feature')) {
    return 'bg-blue-50 text-blue-700 border-blue-200/80 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/80';
  }
  if (lower.includes('fix')) {
    return 'bg-emerald-50 text-emerald-700 border-emerald-200/80 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800/80';
  }
  if (lower.includes('perf')) {
    return 'bg-purple-50 text-purple-700 border-purple-200/80 dark:bg-purple-950/60 dark:text-purple-300 dark:border-purple-800/80';
  }
  return 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700';
}

interface ChangelogSectionListProps {
  sections: ChangelogSection[];
  compact?: boolean;
}

export const ChangelogSectionList: React.FC<ChangelogSectionListProps> = ({
  sections,
  compact = false,
}) => {
  if (sections.length === 0) {
    return (
      <p className="text-xs text-gray-500 dark:text-gray-400 italic">
        No detailed release notes recorded for this version.
      </p>
    );
  }

  return (
    <div className={compact ? 'space-y-2.5' : 'space-y-3.5'}>
      {sections.map((section) => (
        <div key={section.category} className="space-y-1.5">
          <span
            className={`inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold uppercase tracking-wide ${categoryBadgeStyle(
              section.category
            )}`}
          >
            {section.category}
          </span>
          <ul className="space-y-1 pl-3.5 list-disc marker:text-gray-400 dark:marker:text-gray-500">
            {section.items.map((item, idx) => (
              <li
                key={`${section.category}-${idx}`}
                className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed"
              >
                {renderInlineTokens(item)}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
};
