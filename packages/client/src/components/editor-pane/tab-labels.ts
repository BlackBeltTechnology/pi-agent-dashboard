/**
 * Display-text helpers for editor-pane tabs, shared by the tab strip, the
 * document bar title line and the Search tabs matcher so a label is the same
 * everywhere. See change: scope-anchor-editor-pane-controls (D2, D7).
 */
import type { OpenFile } from "../../lib/layout/editor-pane-state.js";
import type { TabHaystack } from "../../lib/layout/match-tabs.js";
import { stripTermId } from "../../lib/layout/use-terminal-pane-tabs.js";

/** Text before the first `:` (`term:t1` → `term`); the whole string when none. */
export const prefixOf = (p: string): string => {
  const i = p.indexOf(":");
  return i > 0 ? p.slice(0, i) : p;
};

export function basename(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i >= 0 ? p.slice(i + 1) : p;
}

function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : "";
}

/** Path without a virtual-tab prefix (`diff:a/b.ts` → `a/b.ts`). */
const afterPrefix = (p: string): string => (p.indexOf(":") > 0 ? p.slice(p.indexOf(":") + 1) : p);

export interface TabTextDeps {
  terminalTitle?: (id: string) => string | undefined;
  /** Fallback label for a terminal without a title. */
  terminalFallback: string;
}

/** Plain-text label of a tab; `""` for a plugin tab (its label is a React node). */
export function tabLabelText(file: OpenFile, deps: TabTextDeps): string {
  switch (file.viewer) {
    case "terminal":
      return deps.terminalTitle?.(stripTermId(file.path) ?? "") ?? deps.terminalFallback;
    case "plugin":
      return "";
    case "url":
    case "live-server":
      return afterPrefix(file.path);
    default:
      return basename(afterPrefix(file.path));
  }
}

/** Haystack for `matchTabs` (design D7): display label + location, never the raw prefix. */
export function tabHaystack(file: OpenFile, deps: TabTextDeps): TabHaystack {
  const label = tabLabelText(file, deps);
  switch (file.viewer) {
    case "terminal":
      return { label, location: "terminal" };
    case "url":
      return { label, location: "url" };
    case "live-server":
      return { label, location: "live" };
    case "plugin":
      return { label, location: afterPrefix(file.path) };
    default:
      return { label, location: dirname(afterPrefix(file.path)) };
  }
}
