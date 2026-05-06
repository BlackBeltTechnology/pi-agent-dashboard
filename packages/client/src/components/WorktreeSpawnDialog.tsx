import React, { useState, useCallback } from "react";
import { getApiBase } from "../lib/api-context.js";
import { BranchPicker } from "./BranchPicker.js";
import { DialogPortal } from "./DialogPortal.js";
import { useMobile } from "../hooks/useMobile.js";
import { Icon } from "@mdi/react";
import { mdiSourceBranch, mdiPlus } from "@mdi/js";

interface Props {
  cwd: string;
  onClose: () => void;
  /** Called when spawn starts — to show loading indicator in the session list */
  onSpawning?: (cwd: string) => void;
}

export function WorktreeSpawnDialog({ cwd, onClose, onSpawning }: Props) {
  const [baseBranch, setBaseBranch] = useState<string | null>(null);
  const [newBranch, setNewBranch] = useState("");
  const isMobile = useMobile();

  const handleSpawn = useCallback(() => {
    const branch = newBranch.trim();
    if (!baseBranch || !branch) return;

    onSpawning?.(cwd);
    onClose();

    // Fire-and-forget: server returns 202 immediately, work happens in background
    fetch(`${getApiBase()}/api/session/spawn`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cwd, spawnMode: "worktree", branch, baseBranch }),
    }).catch(() => {});
  }, [cwd, baseBranch, newBranch, onClose, onSpawning]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const isValid = baseBranch && newBranch.trim();

  const branchContent = (
    <>
      {/* Base branch picker */}
      <div className="mb-4">
        <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
          <Icon path={mdiSourceBranch} size={0.45} className="inline mr-1" />
          Base branch
        </label>
        <BranchPicker
          cwd={cwd}
          selected={baseBranch}
          onSelect={(branch) => {
            setBaseBranch(branch);
            if (!newBranch) {
              const slug = branch.replace(/^origin\//, "").replace(/[^a-zA-Z0-9._-]/g, "-");
              setNewBranch(`${slug}-`);
            }
          }}
          onCancel={() => {}}
          rows={6}
        />
      </div>

      {/* New branch name */}
      <div className="mb-4">
        <label className="block text-xs text-[var(--text-secondary)] mb-1.5">
          <Icon path={mdiPlus} size={0.45} className="inline mr-1" />
          New branch name
        </label>
        <input
          type="text"
          value={newBranch}
          onChange={(e) => {
            setNewBranch(e.target.value);
          }}
          placeholder={`e.g., feature/my-task`}
          className="w-full bg-[var(--bg-tertiary)] rounded px-3 py-2.5 text-base font-mono border border-[var(--border-secondary)] focus:border-blue-500 focus:outline-none"
          style={{ minHeight: "44px" }}
        />
        {baseBranch && (
          <div className="text-[10px] text-[var(--text-muted)] mt-1">
            Branching off <span className="text-[var(--text-secondary)] font-mono">{baseBranch}</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-lg text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          style={{ minHeight: "44px" }}
        >
          Cancel
        </button>
        <button
          onClick={handleSpawn}
          disabled={!isValid}
          className="flex-1 py-3 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          style={{ minHeight: "44px" }}
        >
          Create & Spawn
        </button>
      </div>
    </>
  );

  if (isMobile) {
    return (
      <DialogPortal>
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={handleBackdropClick}
        >
          <div
            className="w-full h-full bg-[var(--bg-primary)] rounded-t-2xl shadow-xl overflow-y-auto animate-slide-up"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-[var(--border-secondary)]" />
            </div>
            <div className="px-4 pb-6">
              <h2 className="text-base font-semibold mb-4 text-[var(--text-primary)]">
                Spawn in Worktree
              </h2>
              {branchContent}
            </div>
          </div>
        </div>
      </DialogPortal>
    );
  }

  return (
    <DialogPortal>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={handleBackdropClick}
      >
        <div
          className="bg-[var(--bg-primary)] rounded-xl shadow-xl border border-[var(--border-secondary)] p-6 w-full max-w-[520px] max-h-[90vh] overflow-y-auto"
          onClick={(e) => e.stopPropagation()}
        >
          <h2 className="text-base font-semibold mb-4 text-[var(--text-primary)]">
            Spawn in Worktree
          </h2>
          {branchContent}
        </div>
      </div>
    </DialogPortal>
  );
}
