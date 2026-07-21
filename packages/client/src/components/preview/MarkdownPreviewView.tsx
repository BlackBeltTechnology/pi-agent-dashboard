import { mdiArrowLeft, mdiLoading } from "@mdi/js";
import { Icon } from "@mdi/react";
import React, { useRef } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownContent } from "./MarkdownContent.js";
import { MarkdownSearch } from "./MarkdownSearch.js";

export interface PreviewTab {
  id: string;
  label: string;
  colorClass?: string;
}

interface Props {
  title?: string;
  content?: string;
  isLoading?: boolean;
  error?: string;
  tabs?: PreviewTab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  /** Back-navigation handler. When omitted, no back button is rendered (e.g.
   *  when hosted in a Dialog that supplies its own standard close). */
  onBack?: () => void;
  /** Enable text search overlay (default: true) */
  searchable?: boolean;
  /** Reserve right padding in the header so a host Dialog's close (✕) button
   *  does not overlap the search box. */
  closeInset?: boolean;
}

export function MarkdownPreviewView({
  title,
  content,
  isLoading,
  error,
  tabs,
  activeTab,
  onTabChange,
  onBack,
  searchable = true,
  closeInset = false,
}: Props) {
  const contentRef = useRef<HTMLDivElement>(null);
  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="markdown-preview">
      {/* Header with optional back button and title */}
      <div className={`flex items-center gap-2 px-4 py-2 border-b border-[var(--border-secondary)]${closeInset ? " pr-12" : ""}`}>
        {onBack && (
          <button
            onClick={onBack}
            className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-1 rounded hover:bg-[var(--bg-surface)]"
            data-testid="preview-back"
            title={i18nT("session.backToChat", undefined, "Back to chat")}
          >
            <Icon path={mdiArrowLeft} size={0.7} />
          </button>
        )}
        {title && (
          <span className="text-sm font-medium text-[var(--text-secondary)] truncate">
            {title}
          </span>
        )}
        {searchable && <span className="flex-1" />}
        {searchable && <MarkdownSearch contentRef={contentRef} content={content} />}
      </div>

      {/* Tab bar */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 px-4 py-1.5 border-b border-[var(--border-secondary)]" data-testid="preview-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => onTabChange?.(tab.id)}
              className={`text-xs font-bold font-mono px-2 py-1 rounded transition-colors ${
                tab.id === activeTab
                  ? "bg-[var(--bg-surface)] text-[var(--text-primary)]"
                  : `${tab.colorClass ?? "text-[var(--text-muted)]"} hover:text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]`
              }`}
              data-testid={`preview-tab-${tab.id}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}

      {/* Content area */}
      <div ref={contentRef} className="flex-1 overflow-y-auto p-4" style={{ WebkitOverflowScrolling: "touch", overscrollBehavior: "contain" }}>
        {isLoading && (
          <div className="flex items-center justify-center h-full text-[var(--text-muted)]" data-testid="preview-loading">
            <Icon path={mdiLoading} size={1.2} spin className="animate-spin" />
          </div>
        )}
        {error && !isLoading && (
          <div className="text-red-400 text-sm py-4" data-testid="preview-error">
            {error}
          </div>
        )}
        {content && !isLoading && !error && (
          <MarkdownContent content={content} frontmatter="properties" />
        )}
      </div>
    </div>
  );
}
