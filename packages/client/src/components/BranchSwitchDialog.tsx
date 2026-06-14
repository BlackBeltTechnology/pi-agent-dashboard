import React, { useState } from "react";
import { BranchPicker } from "./BranchPicker.js";
import { checkoutBranch, stashPop, gitInit } from "../lib/git-api.js";
import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import { t as i18nT } from "../lib/i18n";

interface Props {
  cwd: string;
  onClose: () => void;
}

type Step =
  | { type: "pick" }
  | { type: "no-git" }
  | { type: "dirty"; branch: string; files: string[] }
  | { type: "switching"; branch: string }
  | { type: "ask-pop"; branch: string }
  | { type: "error"; message: string };

export function BranchSwitchDialog({ cwd, onClose }: Props) {
  const [step, setStep] = useState<Step>({ type: "pick" });

  const handleSelect = async (branch: string) => {
    setStep({ type: "switching", branch });
    try {
      const result = await checkoutBranch(cwd, branch, false);
      if (!result.success) {
        setStep({ type: "dirty", branch, files: result.files });
        return;
      }
      onClose();
    } catch (err: any) {
      setStep({ type: "error", message: err.message ?? "Checkout failed" });
    }
  };

  const handleStashAndSwitch = async (branch: string) => {
    setStep({ type: "switching", branch });
    try {
      const result = await checkoutBranch(cwd, branch, true);
      if (!result.success) {
        setStep({ type: "error", message: "Checkout failed even after stash" });
        return;
      }
      if (result.stashed) {
        setStep({ type: "ask-pop", branch });
      } else {
        onClose();
      }
    } catch (err: any) {
      setStep({ type: "error", message: err.message ?? "Stash & checkout failed" });
    }
  };

  const handlePop = async () => {
    try {
      const result = await stashPop(cwd);
      if (result.conflicts) {
        setStep({ type: "error", message: "Stash popped with merge conflicts. Please resolve them manually." });
      } else {
        onClose();
      }
    } catch (err: any) {
      setStep({ type: "error", message: err.message ?? "Stash pop failed" });
    }
  };

  return (
    <Dialog open onClose={onClose} ariaLabel="Switch branch" size="sm" testId="branch-switch-dialog">
          {step.type === "pick" && (
            <>
              <h3 className="text-sm font-medium mb-3">{i18nT("auto.switch_branch_2", undefined, "Switch Branch")}</h3>
              <BranchPicker
                cwd={cwd}
                onSelect={handleSelect}
                onCancel={onClose}
                onNotGitRepo={() => setStep({ type: "no-git" })}
              />
            </>
          )}

          {step.type === "no-git" && (
            <>
              <h3 className="text-sm font-medium mb-2">{i18nT("auto.no_git_repository", undefined, "No Git Repository")}</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                {i18nT("auto.this_directory_is_not_a_git", undefined, "This directory is not a git repository. Initialize one?")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("auto.cancel", undefined, "Cancel")}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await gitInit(cwd);
                      onClose();
                    } catch (err: any) {
                      setStep({ type: "error", message: err.message ?? "Init failed" });
                    }
                  }}
                  className="px-3 py-1.5 rounded text-sm bg-[var(--accent-primary)] text-white hover:opacity-90"
                >
                  {i18nT("auto.initialize_git", undefined, "Initialize Git")}
                </button>
              </div>
            </>
          )}

          {step.type === "switching" && (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">
              {i18nT("auto.switching_to", undefined, "Switching to")} <span className="font-mono text-[var(--text-primary)]">{step.branch}</span>…
            </div>
          )}

          {step.type === "dirty" && (
            <>
              <h3 className="text-sm font-medium mb-2">{i18nT("auto.uncommitted_changes", undefined, "Uncommitted Changes")}</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-2">
                {step.files.length} file{step.files.length !== 1 ? "s" : ""} {i18nT("auto.with_uncommitted_changes", undefined, "with uncommitted changes:")}
              </p>
              <div className="max-h-32 overflow-y-auto bg-[var(--bg-tertiary)] rounded border border-[var(--border-secondary)] p-2 mb-3">
                {step.files.map((f) => (
                  <div key={f} className="text-xs font-mono text-[var(--text-secondary)] truncate">{f}</div>
                ))}
              </div>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("auto.cancel", undefined, "Cancel")}
                </button>
                <button
                  onClick={() => handleStashAndSwitch(step.branch)}
                  className="px-3 py-1.5 rounded text-sm bg-[var(--accent-primary)] text-white hover:opacity-90"
                >
                  {i18nT("auto.stash_switch", undefined, "Stash & Switch")}
                </button>
              </div>
            </>
          )}

          {step.type === "ask-pop" && (
            <>
              <h3 className="text-sm font-medium mb-2">{i18nT("auto.switched_to", undefined, "Switched to")} <span className="font-mono">{step.branch}</span></h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                {i18nT("auto.your_changes_were_stashed_pop_stash", undefined, "Your changes were stashed. Pop stash on this branch?")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("auto.no_keep_stashed", undefined, "No, keep stashed")}
                </button>
                <button
                  onClick={handlePop}
                  className="px-3 py-1.5 rounded text-sm bg-[var(--accent-primary)] text-white hover:opacity-90"
                >
                  {i18nT("auto.pop", undefined, "Pop")}
                </button>
              </div>
            </>
          )}

          {step.type === "error" && (
            <>
              <h3 className="text-sm font-medium mb-2 text-red-400">{i18nT("auto.error_2", undefined, "Error")}</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">{step.message}</p>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("auto.close", undefined, "Close")}
                </button>
              </div>
            </>
          )}
    </Dialog>
  );
}
