/**
 * NewWorkspaceDialog — single text input to create a workspace.
 * Validates: trimmed, 1–80 chars. Calls `onCreate(name)` on submit.
 * See change: folder-workspaces.
 */
import React, { useState, useRef, useEffect } from "react";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";

interface Props {
  onCreate: (name: string) => void;
  onCancel: () => void;
}

const NAME_MAX = 80;

export function NewWorkspaceDialog({ onCreate, onCancel }: Props) {
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const trimmed = name.trim();
  const valid = trimmed.length > 0 && trimmed.length <= NAME_MAX;

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    onCreate(trimmed);
  }

  return (
    <Dialog open onClose={onCancel} title="New Workspace" size="md" testId="new-workspace-dialog">
        <form onSubmit={submit} className="space-y-1">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Workspace name"
            maxLength={NAME_MAX}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
            data-testid="new-workspace-input"
            aria-label="Workspace name"
          />
          <div className="text-[10px] text-[var(--text-muted)] mt-1">
            {trimmed.length}/{NAME_MAX}
          </div>
          <Dialog.Footer>
            <Dialog.Cancel onClick={onCancel} testId="new-workspace-cancel" />
            <button
              type="submit"
              disabled={!valid}
              className="text-xs px-3 py-1.5 rounded bg-[var(--accent-primary)] text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
              data-testid="new-workspace-create"
            >
              Create
            </button>
          </Dialog.Footer>
        </form>
    </Dialog>
  );
}
