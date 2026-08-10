import { Dialog } from "@blackbelt-technology/pi-dashboard-client-utils/Dialog";
import React, { useState } from "react";
import { checkoutBranch, gitInit, stashPop } from "../../lib/git/git-api.js";
import { t as i18nT } from "../../lib/i18n/i18n.js";
import { BranchPicker } from "./BranchPicker.js";

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
      setStep({ type: "error", message: err.message ?? i18nT("err.checkout_failed", undefined, "Checkout failed") });
    }
  };

  const handleStashAndSwitch = async (branch: string) => {
    setStep({ type: "switching", branch });
    try {
      const result = await checkoutBranch(cwd, branch, true);
      if (!result.success) {
        setStep({ type: "error", message: i18nT("err.checkoutFailedAfterStash", undefined, "Checkout failed even after stash") });
        return;
      }
      if (result.stashed) {
        setStep({ type: "ask-pop", branch });
      } else {
        onClose();
      }
    } catch (err: any) {
      setStep({ type: "error", message: err.message ?? i18nT("err.stashCheckoutFailed", undefined, "Stash & checkout failed") });
    }
  };

  const handlePop = async () => {
    try {
      const result = await stashPop(cwd);
      if (result.conflicts) {
        setStep({ type: "error", message: i18nT("err.stashPopConflicts", undefined, "Stash popped with merge conflicts. Please resolve them manually.") });
      } else {
        onClose();
      }
    } catch (err: any) {
      setStep({ type: "error", message: err.message ?? i18nT("err.stash_pop_failed", undefined, "Stash pop failed") });
    }
  };

  return (
    <Dialog open onClose={onClose} ariaLabel={i18nT("git.switchBranch", undefined, "Switch branch")} size="sm" testId="branch-switch-dialog">
          {step.type === "pick" && (
            <>
              <h3 className="text-sm font-medium mb-3">{i18nT("git.switchBranch2", undefined, "Switch Branch")}</h3>
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
              <h3 className="text-sm font-medium mb-2">{i18nT("git.noGitRepository", undefined, "No Git Repository")}</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                {i18nT("git.thisDirectoryIsNotAGit", undefined, "This directory is not a git repository. Initialize one?")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("common.cancel", undefined, "Cancel")}
                </button>
                <button
                  onClick={async () => {
                    try {
                      await gitInit(cwd);
                      onClose();
                    } catch (err: any) {
                      setStep({ type: "error", message: err.message ?? i18nT("err.initFailed", undefined, "Init failed") });
                    }
                  }}
                  className="px-3 py-1.5 rounded text-sm bg-[var(--accent-primary)] text-white hover:opacity-90"
                >
                  {i18nT("git.initializeGit", undefined, "Initialize Git")}
                </button>
              </div>
            </>
          )}

          {step.type === "switching" && (
            <div className="py-8 text-center text-sm text-[var(--text-secondary)]">
              {i18nT("common.switchingTo", undefined, "Switching to")} <span className="font-mono text-[var(--text-primary)]">{step.branch}</span>…
            </div>
          )}

          {step.type === "dirty" && (
            <>
              <h3 className="text-sm font-medium mb-2">{i18nT("common.uncommittedChanges", undefined, "Uncommitted Changes")}</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-2">
                {step.files.length} file{step.files.length !== 1 ? "s" : ""} {i18nT("common.withUncommittedChanges", undefined, "with uncommitted changes:")}
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
                  {i18nT("common.cancel", undefined, "Cancel")}
                </button>
                <button
                  onClick={() => handleStashAndSwitch(step.branch)}
                  className="px-3 py-1.5 rounded text-sm bg-[var(--accent-primary)] text-white hover:opacity-90"
                >
                  {i18nT("git.stashSwitch", undefined, "Stash & Switch")}
                </button>
              </div>
            </>
          )}

          {step.type === "ask-pop" && (
            <>
              <h3 className="text-sm font-medium mb-2">{i18nT("common.switchedTo", undefined, "Switched to")} <span className="font-mono">{step.branch}</span></h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">
                {i18nT("git.yourChangesWereStashedPopStash", undefined, "Your changes were stashed. Pop stash on this branch?")}
              </p>
              <div className="flex justify-end gap-2">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("git.noKeepStashed", undefined, "No, keep stashed")}
                </button>
                <button
                  onClick={handlePop}
                  className="px-3 py-1.5 rounded text-sm bg-[var(--accent-primary)] text-white hover:opacity-90"
                >
                  {i18nT("common.pop", undefined, "Pop")}
                </button>
              </div>
            </>
          )}

          {step.type === "error" && (
            <>
              <h3 className="text-sm font-medium mb-2 text-red-400">{i18nT("status.error2", undefined, "Error")}</h3>
              <p className="text-xs text-[var(--text-secondary)] mb-3">{step.message}</p>
              <div className="flex justify-end">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 rounded text-sm text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)]"
                >
                  {i18nT("common.close", undefined, "Close")}
                </button>
              </div>
            </>
          )}
    </Dialog>
  );
}
