/**
 * NewWorkspaceDialog — single text input to create a workspace.
 * Validates: trimmed, 1–80 chars. Calls `onCreate(name)` on submit.
 * See change: folder-workspaces.
 */

import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { t as i18nT } from "../../lib/i18n/i18n.js";

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
    <Dialog open onClose={onCancel} title={i18nT("folders.newWorkspace2", undefined, "New Workspace")} size="md" testId="new-workspace-dialog">
        <form onSubmit={submit} className="space-y-1">
          <input
            ref={inputRef}
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={i18nT("folders.workspaceName", undefined, "Workspace name")}
            maxLength={NAME_MAX}
            className="w-full px-3 py-2 text-sm rounded bg-[var(--bg-primary)] border border-[var(--border-subtle)] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent-blue)]"
            data-testid="new-workspace-input"
            aria-label={i18nT("folders.workspaceName", undefined, "Workspace name")}
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
              {i18nT("common.create", undefined, "Create")}
            </button>
          </Dialog.Footer>
        </form>
    </Dialog>
  );
}
