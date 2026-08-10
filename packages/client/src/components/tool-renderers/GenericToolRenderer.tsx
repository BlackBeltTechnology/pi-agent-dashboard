import React from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { LinkifiedText } from "./LinkifiedText.js";
import { ToolResultImages } from "./ToolResultImages.js";
import type { ToolRendererProps } from "./types.js";

/**
 * Fallback renderer: shows raw JSON args and tool output.
 *
 * The args JSON block above is NOT linkified — it renders verbatim.
 * The result block runs through `LinkifiedText` so URLs and file
 * references become clickable. See change: linkify-tool-output.
 */
export function GenericToolRenderer({ args, result, images, context }: ToolRendererProps) {
  const hasImages = images && images.length > 0;
  return (
    <div className="space-y-2">
      <pre className="text-code text-[var(--text-secondary)]">{JSON.stringify(args, null, 2)}</pre>
      {hasImages && <ToolResultImages images={images!} />}
      {result && (
        <>
          <div className="text-[var(--text-tertiary)] font-medium text-xs">{i18nT("common.output", undefined, "Output:")}</div>
          <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)]">
            <LinkifiedText text={result} context={context} />
          </pre>
        </>
      )}
    </div>
  );
}
