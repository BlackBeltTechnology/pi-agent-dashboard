/**
 * Where a rendered mermaid diagram came from on disk — the identity the
 * "Apply fix to file" action needs. Absent (null) for chat and any other
 * file-less surface, which keeps display-only + copy.
 *
 * Surfaces build the value with `useMermaidSource` (memoized, stable identity),
 * which also enforces the live-session-cwd rule.
 *
 * See change: add-preview-apply-fix-to-file (design D1).
 */
import { createContext, useContext } from "react";

export type MermaidFileKind = "md" | "adoc" | "mmd";

export interface MermaidSourceInfo {
  /** Session cwd the file is scoped to (what `md-read`/`write` accept). */
  cwd: string;
  /** File path, relative to `cwd` or absolute (as the surface already uses it). */
  path: string;
  kind: MermaidFileKind;
  /** Re-fetch the surface's content after a successful write or a conflict. */
  reload: () => void;
  /** The same file has unsaved edits in an editor → action disabled. */
  isDirty?: boolean;
  /** AsciiDoc: number of mermaid blocks the preview rendered (count-parity guard). */
  expectedCount?: number;
  /**
   * A markup repair is displayed but not yet applied to the file: block ordinals on
   * disk would not match the repaired rendering, so per-diagram apply is disabled.
   * See change: add-md-adoc-markup-repair.
   */
  markupRepairActive?: boolean;
}

export const MermaidSourceContext = createContext<MermaidSourceInfo | null>(null);

export function useMermaidSourceContext(): MermaidSourceInfo | null {
  return useContext(MermaidSourceContext);
}
