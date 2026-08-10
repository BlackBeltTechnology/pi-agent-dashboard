import type React from "react";
import { useCallback } from "react";
import { useMainSpecsReader } from "../../hooks/useMainSpecsReader.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { MarkdownPreviewView } from "../preview/MarkdownPreviewView.js";

interface Props {
  cwd: string;
  onBack: () => void;
}

export function SpecsBrowserView({ cwd, onBack }: Props) {
  const { specNames, content, isLoading, error } = useMainSpecsReader(cwd);

  const handleSpecSelect = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    const name = e.target.value;
    if (!name) return;
    const el = document.getElementById(`spec-${name}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth" });
    }
    // Reset select to placeholder so same item can be re-selected
    e.target.value = "";
  }, []);

  return (
    <div className="flex-1 flex flex-col min-h-0" data-testid="specs-browser">
      {/* Combobox for jump-to */}
      {specNames.length > 0 && !isLoading && (
        <div className="flex items-center gap-2 px-4 py-1.5 border-b border-[var(--border-secondary)]">
          <select
            onChange={handleSpecSelect}
            defaultValue=""
            className="text-xs bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-1 text-[var(--text-secondary)] focus:outline-none focus:border-blue-500/50 max-w-[300px]"
            data-testid="specs-browser-combobox"
          >
            <option value="" disabled>{i18nT("openspec.jumpToSpec", undefined, "Jump to spec...")}</option>
            {specNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
          <span className="text-[10px] text-[var(--text-muted)]">{specNames.length} specs</span>
        </div>
      )}

      {/* Markdown preview with search */}
      <MarkdownPreviewView
        title={i18nT("openspec.mainSpecs", undefined, "Main Specs")}
        content={content}
        isLoading={isLoading}
        error={error}
        onBack={onBack}
        searchable
      />
    </div>
  );
}
