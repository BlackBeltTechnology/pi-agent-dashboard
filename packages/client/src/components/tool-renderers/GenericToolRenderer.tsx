import React from "react";
import type { ToolRendererProps } from "./types.js";

/** Fallback renderer: shows raw JSON args and plain text output */
export function GenericToolRenderer({ args, result }: ToolRendererProps) {
  return (
    <div className="space-y-2">
      <pre className="text-code text-[var(--text-secondary)]">{JSON.stringify(args, null, 2)}</pre>
      {result && (
        <>
          <div className="text-[var(--text-tertiary)] font-medium text-xs">Output:</div>
          <pre className="whitespace-pre-wrap text-code text-[var(--text-secondary)]">{result}</pre>
        </>
      )}
    </div>
  );
}
