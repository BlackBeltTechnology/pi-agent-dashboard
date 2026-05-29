import React from "react";
import AnsiImport from "ansi-to-react";
import type { ToolRendererProps } from "./types.js";

// Handle CJS interop: ansi-to-react may resolve as {default: fn} in production builds
const Ansi: React.ComponentType<{children: string}> =
  typeof AnsiImport === "function"
    ? AnsiImport
    : typeof (AnsiImport as any)?.default === "function"
      ? (AnsiImport as any).default
      : (({ children }: { children: string }) => <>{children}</>) as any;

export function BashToolRenderer({ args, status, result }: ToolRendererProps) {
  const command = args?.command as string | undefined;
  const timeout = args?.timeout as number | undefined;

  return (
    <div className="space-y-1">
      <div className="flex items-start gap-2">
        <span className="text-xs text-[var(--accent-green)] font-mono">$</span>
        <span className="text-xs text-[var(--text-secondary)] font-mono whitespace-pre-wrap break-all">{command ?? "command"}</span>
        {timeout && <span className="text-[10px] text-[var(--text-muted)]">(timeout: {timeout}s)</span>}
      </div>

      {status === "running" && !result && (
        <div className="text-xs text-[var(--text-muted)] italic">Running…</div>
      )}

      {result && (
        <div className="max-h-80 overflow-auto rounded bg-[var(--bg-code)] p-2">
          <pre className="whitespace-pre-wrap text-xs font-mono">
            <Ansi>{String(result)}</Ansi>
          </pre>
        </div>
      )}
    </div>
  );
}
