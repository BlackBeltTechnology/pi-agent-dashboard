/**
 * Editable tag strip: colorized user chips (removable) + an "+ tag" popover
 * with a free-form input that autocompletes over the union of all in-use tags
 * (new tags allowed). Every mutation emits the FULL new normalized array via
 * `onChange` (the caller sends `set_session_tags`). See change: add-session-tags.
 */

import { normalizeTags } from "@blackbelt-technology/pi-dashboard-shared/tags.js";
import { useCallback, useMemo, useRef, useState } from "react";
import { useI18n } from "../../lib/i18n/i18n.js";
import { TagChip } from "./TagChip.js";

interface TagEditorProps {
  /** Current session tags (normalized). */
  tags: string[];
  /** Union of all tags in use across sessions, for autocomplete. */
  allTags: string[];
  /** Emits the full new normalized tag array. */
  onChange: (tags: string[]) => void;
}

export function TagEditor({ tags, allTags, onChange }: TagEditorProps) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = useCallback(
    (next: string[]) => onChange(normalizeTags(next)),
    [onChange],
  );

  const removeTag = useCallback(
    (tag: string) => commit(tags.filter((t) => t !== tag)),
    [commit, tags],
  );

  const addTag = useCallback(
    (raw: string) => {
      const [tag] = normalizeTags([raw]);
      if (!tag || tags.includes(tag)) {
        setQuery("");
        return;
      }
      commit([...tags, tag]);
      setQuery("");
    },
    [commit, tags],
  );

  const normalizedQuery = query.trim().toLowerCase();
  const suggestions = useMemo(() => {
    const applied = new Set(tags);
    return allTags
      .filter((t) => !applied.has(t) && (normalizedQuery === "" || t.includes(normalizedQuery)))
      .slice(0, 8);
  }, [allTags, tags, normalizedQuery]);

  const showCreate =
    normalizedQuery !== "" && !tags.includes(normalizedQuery) && !allTags.includes(normalizedQuery);

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <TagChip key={tag} label={tag} variant="user" onRemove={() => removeTag(tag)} />
      ))}

      <div className="relative">
        <button
          type="button"
          aria-label={t("tags.addTag", undefined, "Add tag")}
          aria-expanded={open}
          onClick={() => {
            setOpen((v) => !v);
            setTimeout(() => inputRef.current?.focus(), 0);
          }}
          className="inline-flex items-center gap-1 rounded-full border border-dashed border-[var(--border-secondary)] bg-transparent px-2 py-0.5 text-[11px] leading-tight text-[var(--text-muted)] hover:text-[var(--text-secondary)] hover:border-[var(--text-muted)] cursor-pointer"
        >
          {t("tags.addTagShort", undefined, "+ tag")}
        </button>

        {open ? (
          <div
            role="dialog"
            aria-label={t("tags.addTag", undefined, "Add tag")}
            className="absolute left-0 top-full z-20 mt-1 w-64 rounded-lg border border-[var(--border-secondary)] bg-[var(--bg-tertiary)] p-3 shadow-xl"
          >
            <input
              ref={inputRef}
              type="text"
              value={query}
              placeholder={t("tags.addTagPlaceholder", undefined, "Add tag…")}
              aria-label={t("tags.tagName", undefined, "Tag name")}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  if (query.trim()) addTag(query);
                } else if (e.key === "Escape") {
                  setOpen(false);
                  setQuery("");
                }
              }}
              className="w-full rounded-md border border-[var(--border-secondary)] bg-[var(--bg-primary)] px-2 py-1.5 text-xs text-[var(--text-primary)] outline-none focus:border-[var(--accent-blue)]"
            />
            {(suggestions.length > 0 || showCreate) ? (
              <div className="mt-2 border-t border-[var(--border-subtle)] pt-2">
                {suggestions.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addTag(t)}
                    className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-surface)]"
                  >
                    <TagChip label={t} variant="user" />
                  </button>
                ))}
                {showCreate ? (
                  <button
                    type="button"
                    onClick={() => addTag(query)}
                    className="flex w-full items-center rounded-md px-1.5 py-1 text-left text-xs text-[var(--accent-green,#86efac)] hover:bg-[var(--bg-surface)]"
                  >
                    {t("tags.createTag", { name: normalizedQuery }, "+ Create “{name}”")}
                  </button>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
