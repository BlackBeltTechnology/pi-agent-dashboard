import { mdiChevronDown, mdiChevronUp, mdiClose } from "@mdi/js";
import { Icon } from "@mdi/react";
import Fuse from "fuse.js";
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

const HIGHLIGHT_CLASS = "markdown-search-highlight";
const ACTIVE_HIGHLIGHT_CLASS = "markdown-search-highlight-active";

interface Props {
  /** Ref to the scrollable container holding the rendered markdown */
  contentRef: React.RefObject<HTMLElement | null>;
  /** Raw markdown content string — used to detect content changes */
  content?: string;
}

interface SearchableItem {
  text: string;
  /** The DOM element this text came from */
  element: Element;
}

/** Extract text blocks from the markdown container for fuse.js indexing */
function extractTextBlocks(container: HTMLElement): SearchableItem[] {
  const items: SearchableItem[] = [];
  // Get all leaf-ish elements that contain text
  const elements = container.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, blockquote, pre");
  for (const el of elements) {
    const text = el.textContent?.trim();
    if (text && text.length > 0) {
      items.push({ text, element: el });
    }
  }
  return items;
}

/** Clear all highlights from the container */
function clearHighlights(container: HTMLElement) {
  const marks = container.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);
  for (const mark of marks) {
    const parent = mark.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(mark.textContent || ""), mark);
      parent.normalize(); // Merge adjacent text nodes
    }
  }
}

/** Highlight matching text in a specific element using TreeWalker */
function highlightTextInElement(element: Element, searchTerms: string[]): number {
  let count = 0;
  // Build a combined regex from search terms (escape special chars)
  const escaped = searchTerms.map(t => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (escaped.length === 0) return 0;
  const pattern = new RegExp(`(${escaped.join("|")})`, "gi");

  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  let node: Text | null;
  while ((node = walker.nextNode() as Text | null)) {
    // Skip nodes inside <mark> elements (already highlighted) or code blocks
    if (node.parentElement?.closest(`mark.${HIGHLIGHT_CLASS}`)) continue;
    if (pattern.test(node.data)) {
      textNodes.push(node);
    }
    pattern.lastIndex = 0;
  }

  for (const textNode of textNodes) {
    const frag = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    pattern.lastIndex = 0;

    while ((match = pattern.exec(textNode.data)) !== null) {
      if (match.index > lastIndex) {
        frag.appendChild(document.createTextNode(textNode.data.slice(lastIndex, match.index)));
      }
      const mark = document.createElement("mark");
      mark.className = HIGHLIGHT_CLASS;
      mark.textContent = match[0];
      frag.appendChild(mark);
      count++;
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < textNode.data.length) {
      frag.appendChild(document.createTextNode(textNode.data.slice(lastIndex)));
    }

    textNode.parentNode?.replaceChild(frag, textNode);
  }

  return count;
}

export function MarkdownSearch({ contentRef, content }: Props) {
  const [query, setQuery] = useState("");
  const [matchCount, setMatchCount] = useState(0);
  const [currentMatch, setCurrentMatch] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const fuseRef = useRef<Fuse<SearchableItem> | null>(null);
  const itemsRef = useRef<SearchableItem[]>([]);

  // Rebuild fuse index when content changes
  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    // Small delay to let markdown render
    const timer = setTimeout(() => {
      const items = extractTextBlocks(container);
      itemsRef.current = items;
      fuseRef.current = new Fuse(items, {
        keys: ["text"],
        threshold: 0.4,
        ignoreLocation: true,
        includeMatches: true,
      });

      // Re-run search if there's an active query
      if (query) {
        performSearch(query);
      }
    }, 100);

    return () => clearTimeout(timer);
  }, [content]); // eslint-disable-line react-hooks/exhaustive-deps

  const performSearch = useCallback((searchQuery: string) => {
    const container = contentRef.current;
    if (!container) return;

    // Clear previous highlights
    clearHighlights(container);

    if (!searchQuery.trim() || !fuseRef.current) {
      setMatchCount(0);
      setCurrentMatch(0);
      return;
    }

    // Strategy: try exact (substring) match first, fuzzy only as fallback
    const queryLower = searchQuery.toLowerCase();
    const exactMatches = itemsRef.current.filter((item) =>
      item.text.toLowerCase().includes(queryLower),
    );

    let terms: Set<string>;
    let matchedElements: Set<Element>;

    if (exactMatches.length > 0) {
      // Exact substring match — highlight the query itself
      terms = new Set([searchQuery]);
      matchedElements = new Set(exactMatches.map((m) => m.element));
    } else {
      // Fuzzy fallback via fuse.js
      const results = fuseRef.current.search(searchQuery);
      terms = new Set<string>();
      for (const result of results) {
        if (result.matches) {
          for (const m of result.matches) {
            if (m.value) {
              for (const [start, end] of m.indices ?? []) {
                const matchedText = m.value.slice(start, end + 1);
                if (matchedText.length >= 2) {
                  terms.add(matchedText);
                }
              }
            }
          }
        }
      }
      if (terms.size === 0) {
        terms.add(searchQuery);
      }
      matchedElements = new Set(results.map((r) => r.item.element));
    }

    // Highlight in matching elements
    let totalHighlights = 0;

    for (const element of matchedElements) {
      totalHighlights += highlightTextInElement(element, [...terms]);
    }

    setMatchCount(totalHighlights);
    setCurrentMatch(totalHighlights > 0 ? 1 : 0);

    // Scroll to first match
    if (totalHighlights > 0) {
      scrollToMatch(container, 0);
    }
  }, [contentRef]);

  const scrollToMatch = useCallback((container: HTMLElement, index: number) => {
    const marks = container.querySelectorAll(`mark.${HIGHLIGHT_CLASS}`);

    // Remove active class from all
    for (const m of marks) {
      m.classList.remove(ACTIVE_HIGHLIGHT_CLASS);
    }

    if (index >= 0 && index < marks.length) {
      marks[index].classList.add(ACTIVE_HIGHLIGHT_CLASS);
      marks[index].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, []);

  const handleQueryChange = useCallback((value: string) => {
    setQuery(value);
    performSearch(value);
  }, [performSearch]);

  const goToNext = useCallback(() => {
    if (matchCount === 0) return;
    const container = contentRef.current;
    if (!container) return;
    const next = currentMatch >= matchCount ? 1 : currentMatch + 1;
    setCurrentMatch(next);
    scrollToMatch(container, next - 1);
  }, [matchCount, currentMatch, contentRef, scrollToMatch]);

  const goToPrev = useCallback(() => {
    if (matchCount === 0) return;
    const container = contentRef.current;
    if (!container) return;
    const prev = currentMatch <= 1 ? matchCount : currentMatch - 1;
    setCurrentMatch(prev);
    scrollToMatch(container, prev - 1);
  }, [matchCount, currentMatch, contentRef, scrollToMatch]);

  const handleClear = useCallback(() => {
    setQuery("");
    setMatchCount(0);
    setCurrentMatch(0);
    const container = contentRef.current;
    if (container) clearHighlights(container);
  }, [contentRef]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (e.shiftKey) {
        goToPrev();
      } else {
        goToNext();
      }
    } else if (e.key === "Escape") {
      handleClear();
    }
  }, [goToNext, goToPrev, handleClear]);

  return (
    <div className="flex items-center gap-1" data-testid="markdown-search">
      <span className="text-[var(--text-muted)] text-xs">🔍</span>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => handleQueryChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={i18nT("common.search2", undefined, "Search...")}
        className="text-xs bg-[var(--bg-primary)] border border-[var(--border-secondary)] rounded px-2 py-0.5 text-[var(--text-primary)] placeholder-[var(--text-muted)] w-36 focus:outline-none focus:border-blue-500/50"
        data-testid="markdown-search-input"
      />
      {query && (
        <>
          <span className="text-[10px] text-[var(--text-muted)] whitespace-nowrap" data-testid="markdown-search-counter">
            {matchCount > 0 ? `${currentMatch}/${matchCount}` : "0 results"}
          </span>
          <button
            onClick={goToPrev}
            disabled={matchCount === 0}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30"
            title={i18nT("common.previousMatchShiftEnter", undefined, "Previous match (Shift+Enter)")}
            data-testid="markdown-search-prev"
          >
            <Icon path={mdiChevronUp} size={0.6} />
          </button>
          <button
            onClick={goToNext}
            disabled={matchCount === 0}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)] disabled:opacity-30"
            title={i18nT("common.nextMatchEnter", undefined, "Next match (Enter)")}
            data-testid="markdown-search-next"
          >
            <Icon path={mdiChevronDown} size={0.6} />
          </button>
          <button
            onClick={handleClear}
            className="text-[var(--text-muted)] hover:text-[var(--text-secondary)]"
            title={i18nT("common.clearSearchEscape", undefined, "Clear search (Escape)")}
            data-testid="markdown-search-clear"
          >
            <Icon path={mdiClose} size={0.5} />
          </button>
        </>
      )}
    </div>
  );
}
