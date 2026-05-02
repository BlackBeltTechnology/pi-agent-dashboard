/**
 * Pre-flight dialog for the fold-back operation. Doesn't run jj itself —
 * its job is to explain what's about to happen and let the user pick a
 * mode. Confirmation results in a prompt being typed into the agent's
 * chat invoking the `jj-workspace-fold-back` skill (per design Decision 5:
 * "Fold-back is a skill, not a button").
 *
 * For Phase 4 we copy the prompt to the clipboard and show a toast-style
 * confirmation; full prompt-injection into the active session lands when
 * the slot prop contract is extended to expose `sendPrompt`.
 *
 * See change: add-jj-workspace-plugin.
 */
import React, { useState } from "react";

type Mode = "preserve" | "squash" | "pr";

export function JjFoldBackDialog({
  workspaceName,
  onClose,
}: {
  workspaceName: string;
  onClose: () => void;
}): React.ReactElement {
  const [mode, setMode] = useState<Mode>("preserve");
  const [copied, setCopied] = useState(false);

  const prompt = buildFoldBackPrompt(workspaceName, mode);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(prompt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center"
      data-testid="jj-fold-back-dialog"
    >
      <div className="absolute inset-0 bg-[var(--bg-overlay)]" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] border border-[var(--border-secondary)] rounded-lg p-4 max-w-lg mx-4 space-y-3">
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">
          Fold workspace <code>{workspaceName}</code> onto trunk
        </h3>
        <p className="text-xs text-[var(--text-secondary)]">
          This skill never invokes <code className="font-mono">git commit</code>
          {" "}or <code className="font-mono">git merge</code>. The new commit on
          trunk is produced by <code className="font-mono">jj git push --bookmark</code>,
          which translates jj history into git refs safely.
        </p>

        <fieldset className="space-y-1.5 text-xs text-[var(--text-secondary)]">
          <legend className="font-semibold mb-1 text-[var(--text-primary)]">Mode</legend>
          {[
            { value: "preserve", label: "Preserve commit history (recommended)" },
            { value: "squash", label: "Squash into a single commit" },
            { value: "pr", label: "Open a PR instead (requires gh CLI)" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                name="jj-fold-mode"
                value={opt.value}
                checked={mode === opt.value}
                onChange={() => setMode(opt.value as Mode)}
              />
              <span>{opt.label}</span>
            </label>
          ))}
        </fieldset>

        <div className="text-[10px] font-mono bg-[var(--bg-primary)] p-2 rounded border border-[var(--border-secondary)] max-h-32 overflow-y-auto whitespace-pre-wrap">
          {prompt}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded border border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            data-testid="jj-fold-cancel"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCopy}
            className="text-xs px-3 py-1.5 rounded bg-indigo-600 text-white hover:bg-indigo-500"
            data-testid="jj-fold-copy"
          >
            {copied ? "Copied!" : "Copy prompt"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function buildFoldBackPrompt(workspaceName: string, mode: Mode): string {
  const modeLine =
    mode === "preserve"
      ? "Use the default flavor (preserve commit history)."
      : mode === "squash"
      ? "Use `mode: squash` to collapse the workspace into one commit."
      : "Use `mode: pr` to push the bookmark and open a GitHub PR.";
  return [
    `Run the jj-workspace-fold-back skill for workspace \`${workspaceName}\`.`,
    modeLine,
    "Bookmark name: workspace name verbatim.",
    "Stop and report if any precondition fails (dirty index, conflicts, empty working copy, non-colocated repo).",
  ].join(" ");
}
