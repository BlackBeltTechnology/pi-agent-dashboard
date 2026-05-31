import React from "react";
import type { ToolRendererProps } from "./types.js";
import { LinkifiedText } from "./LinkifiedText.js";

// Strip ANSI escape sequences (CSI / SGR codes like \x1b[31m) so the
// linkifier sees clean text. See change: linkify-tool-output. The previous
// implementation rendered `result` through `ansi-to-react` to preserve
// colours, but spec `agent-tool-rendering` requires linkification of file
// references and URLs in the bash result block. Stripping the codes is the
// simplest way to make both work; ANSI colour preservation is a follow-up.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1B\[[0-9;]*[A-Za-z]/g;
function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function BashToolRenderer({ args, status, result, context }: ToolRendererProps) {
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
          <pre className="whitespace-pre-wrap text-code font-mono">
            <LinkifiedText text={stripAnsi(String(result))} context={context} />
          </pre>
        </div>
      )}
    </div>
  );
}
