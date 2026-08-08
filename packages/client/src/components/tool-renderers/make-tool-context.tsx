/**
 * `ToolContext` builder — the single place production attaches the `fileLink`
 * renderer that `MarkdownContent` needs for file-mention linkification.
 *
 * Deliberately its OWN module, not `types.ts`: every consumer in the former
 * SCC-B cycle imports `types.ts` with `import type` (an erased edge), so
 * keeping that module value-free means a future non-`import type` consumer
 * cannot close the loop through a `FileLink` value import.
 *
 * Deliberately a PURE function over its arguments: the D4b regression test
 * (test-plan #F3) calls this exact builder, so if it closed over ambient module
 * state the test would exercise a different path than production and could stay
 * green through the very regression it exists to catch.
 *
 * See change: cleanup-import-cycles (D4b).
 */

import { FileLink } from "./FileLink.js";
import type { FileLinkRenderer, ToolContext } from "./types.js";

/**
 * The production file-mention renderer. Exported so `ChatView` can merge it as
 * a default into an externally-supplied `ToolContext` without rebuilding one.
 */
export const defaultFileLink: FileLinkRenderer = ({ path, line, col, absolute, context, children }) => (
  <FileLink path={path} line={line} col={col} absolute={absolute} context={context}>
    {children}
  </FileLink>
);

/**
 * Build a `ToolContext` with the file-mention renderer attached.
 *
 * Every production construction site MUST go through here. A context built by
 * hand omits `fileLink`, which silently downgrades file mentions to plain text
 * with no type error — the concrete silent-regression path for D4b.
 */
export function makeToolContext(base: Omit<ToolContext, "fileLink">): ToolContext {
  return { ...base, fileLink: defaultFileLink };
}

/**
 * Ensure a context carries a `fileLink`, preserving any caller-supplied one.
 * Used by `ChatView` for embedder-supplied contexts, which are built outside
 * this module and would otherwise lose linkification.
 */
export function withDefaultFileLink(context: ToolContext): ToolContext {
  return context.fileLink ? context : { ...context, fileLink: defaultFileLink };
}
