import React from "react";
import type { ToolRendererProps } from "./types.js";
import { LinkifiedText } from "./LinkifiedText.js";

/**
 * Fallback renderer: shows raw JSON args and tool output.
 *
 * The args JSON block above is NOT linkified — it renders verbatim.
 * The result block runs through `LinkifiedText` so URLs and file
 * references become clickable. See change: linkify-tool-output.
 */
export function GenericToolRenderer({ args, result, context }: ToolRendererProps) {
  return (
    <div className="space-y-2">
      <pre className="text-code text-[var(--text-secondary)]">{JSON.stringify(args, null, 2)}</pre>
      {result && (
        <>
          <div className="text-[var(--text-tertiary)] font-medium text-xs">Output:</div>
          <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)]">
            <LinkifiedText text={result} context={context} />
          </pre>
        </>
      )}
    </div>
  );
}
