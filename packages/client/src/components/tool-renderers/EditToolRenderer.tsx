import React from "react";
import { createTwoFilesPatch } from "diff";
import type { ToolRendererProps } from "./types.js";
import { OpenFileButton } from "./OpenFileButton.js";
import { useMobile } from "../../hooks/useMobile.js";
import { RichDiff } from "../diff/RichDiff.js";

// --- Mobile-only diff renderer ---

function HomegrownDiff({ oldText, newText, filePath }: { oldText: string; newText: string; filePath: string }) {
  const patch = createTwoFilesPatch(filePath, filePath, oldText, newText, "before", "after", { context: 3 });
  const lines = patch.split("\n");

  return (
    <div className="font-mono text-code leading-relaxed overflow-auto max-h-80">
      {lines.map((line, i) => {
        let className = "text-[var(--text-tertiary)] px-2"; // default (header lines)
        if (line.startsWith("+++") || line.startsWith("---")) {
          className = "text-[var(--text-tertiary)] px-2 font-bold";
        } else if (line.startsWith("@@")) {
          className = "text-[var(--accent-blue)] px-2 bg-[color-mix(in_srgb,var(--accent-blue)_15%,transparent)]";
        } else if (line.startsWith("+")) {
          className = "text-[var(--accent-green)] px-2 bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]";
        } else if (line.startsWith("-")) {
          className = "text-[var(--accent-red)] px-2 bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]";
        }
        return (
          <div key={i} className={className}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// --- Pre-computed diff renderer (for toolDetails.diff) ---

function UnifiedDiffView({ diff }: { diff: string }) {
  const lines = diff.split("\n");

  return (
    <div className="font-mono text-code leading-relaxed overflow-auto max-h-80">
      {lines.map((line, i) => {
        let className = "text-[var(--text-tertiary)] px-2";
        if (line.startsWith("+++") || line.startsWith("---")) {
          className = "text-[var(--text-tertiary)] px-2 font-bold";
        } else if (line.startsWith("@@")) {
          className = "text-[var(--accent-blue)] px-2 bg-[color-mix(in_srgb,var(--accent-blue)_15%,transparent)]";
        } else if (line.startsWith("+")) {
          className = "text-[var(--accent-green)] px-2 bg-[color-mix(in_srgb,var(--accent-green)_15%,transparent)]";
        } else if (line.startsWith("-")) {
          className = "text-[var(--accent-red)] px-2 bg-[color-mix(in_srgb,var(--accent-red)_15%,transparent)]";
        }
        return (
          <div key={i} className={className}>
            {line || "\u00A0"}
          </div>
        );
      })}
    </div>
  );
}

// --- Type guards for edits ---

interface HashlineEditOp {
  op?: string;
  pos?: string;
  end?: string;
  lines?: string[];
  oldText?: string;
  newText?: string;
}

function isTextEdit(e: HashlineEditOp): e is HashlineEditOp & { oldText: string; newText: string } {
  return typeof e.oldText === "string" && typeof e.newText === "string";
}

function isHashlineOp(e: HashlineEditOp): boolean {
  return typeof e.op === "string" && !isTextEdit(e);
}

function HashlineEditSummary({ edit }: { edit: HashlineEditOp }) {
  const lines = Array.isArray(edit.lines) ? edit.lines : [];

  const header = () => {
    switch (edit.op) {
      case "replace":
        return `● Replace at ${edit.pos}`;
      case "append":
        return `● Insert after ${edit.pos ?? "EOF"}:`;
      case "prepend":
        return `● Insert before ${edit.pos ?? "BOF"}:`;
      default:
        return `● Hashline edit (${edit.op}):`;
    }
  };

  return (
    <div className="px-2 py-1">
      <div className="font-mono text-xs text-[var(--text-secondary)] mb-0.5">{header()}</div>
      <div className="font-mono text-xs leading-relaxed">
        {lines.map((line, i) => (
          <div key={i} className="text-[var(--accent-green)] px-2">+ {line}</div>
        ))}
      </div>
    </div>
  );
}

// --- Main renderer ---

export function EditToolRenderer({ args, status, result, toolDetails, context }: ToolRendererProps) {
  const isMobile = useMobile();
  const filePath = args?.path as string | undefined;
  const oldText = args?.oldText as string | undefined;
  const newText = args?.newText as string | undefined;
  const rawEdits = Array.isArray(args?.edits) ? (args.edits as HashlineEditOp[]) : null;

  // Defensive: filter edits to only those we can actually render a diff for
  const textEdits = rawEdits?.filter(isTextEdit);
  const hashlineOps = rawEdits?.filter(isHashlineOp);

  const renderDiffs = () => {
    // Priority 1: toolDetails.diff (pre-computed from pi-hashline-edit)
    if (typeof toolDetails?.diff === "string" && toolDetails.diff.length > 0) {
      return (
        <div className="rounded bg-[var(--bg-code)] overflow-hidden text-code">
          <UnifiedDiffView diff={toolDetails.diff} />
        </div>
      );
    }

    // Priority 2: top-level oldText/newText (built-in edit format)
    if (typeof oldText === "string" && typeof newText === "string") {
      return (
        <div className="rounded bg-[var(--bg-code)] overflow-hidden text-code" style={{ fontSize: "12px" }}>
          {isMobile
            ? <HomegrownDiff oldText={oldText} newText={newText} filePath={filePath ?? "file"} />
            : <RichDiff oldText={oldText} newText={newText} filePath={filePath ?? "file"} maxHeight="20rem" />}
        </div>
      );
    }

    // Priority 3: edits[] with replace_text (hashline compat)
    if (textEdits && textEdits.length > 0) {
      return (
        <div className="rounded bg-[var(--bg-code)] overflow-hidden text-code" style={{ fontSize: "12px" }}>
          {textEdits.map((edit, i) => (
            <div key={i} className={i > 0 ? "border-t border-[var(--border-secondary)]" : ""}>
              {isMobile
                ? <HomegrownDiff oldText={edit.oldText} newText={edit.newText} filePath={filePath ?? "file"} />
                : <RichDiff oldText={edit.oldText} newText={edit.newText} filePath={filePath ?? "file"} maxHeight="20rem" />}
            </div>
          ))}
        </div>
      );
    }

    // Priority 4: hashline replace/append/prepend — render descriptions
    if (hashlineOps && hashlineOps.length > 0) {
      return (
        <div className="rounded bg-[var(--bg-code)] overflow-hidden">
          {hashlineOps.map((edit, i) => (
            <div key={i} className={i > 0 ? "border-t border-[var(--border-secondary)]" : ""}>
              <HashlineEditSummary edit={edit} />
            </div>
          ))}
        </div>
      );
    }

    // Fallback: show raw JSON args
    return <pre className="text-code text-[var(--text-secondary)]">{JSON.stringify(args, null, 2)}</pre>;
  };

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <span className="text-xs text-[var(--text-secondary)] font-mono">{filePath ?? "file"}</span>
        <OpenFileButton filePath={filePath} context={context} />
      </div>

      {renderDiffs()}

      {result && status !== "running" && (
        result.startsWith("---")
          ? <pre className="text-xs text-[var(--text-secondary)] whitespace-pre-wrap">{result}</pre>
          : <div className="text-xs text-[var(--text-tertiary)] italic">{result}</div>
      )}
    </div>
  );
}
