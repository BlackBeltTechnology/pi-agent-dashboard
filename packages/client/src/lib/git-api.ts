/**
 * Client-side git API helpers for the BranchPicker / BranchSwitchDialog.
 */
import type { GitBranchesResult, GitStashPopResult } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { getApiBase } from "./api-context.js";

export async function fetchBranches(cwd: string): Promise<GitBranchesResult> {
  if (!cwd) throw new Error("cwd is required");
  const res = await fetch(`${getApiBase()}/api/git/branches?cwd=${encodeURIComponent(cwd)}`);
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "failed to list branches");
  return json.data;
}

export interface CheckoutOk {
  success: true;
  stashed?: boolean;
}

export interface CheckoutDirty {
  success: false;
  dirty: true;
  files: string[];
}

export type CheckoutResult = CheckoutOk | CheckoutDirty;

export async function checkoutBranch(
  cwd: string,
  branch: string,
  stash: boolean = false
): Promise<CheckoutResult> {
  const res = await fetch(`${getApiBase()}/api/git/checkout`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd, branch, stash }),
  });
  const json = await res.json();
  if (res.status === 409 && json.dirty) {
    return { success: false, dirty: true, files: json.files };
  }
  if (!json.success) throw new Error(json.error ?? "checkout failed");
  return { success: true, stashed: json.data?.stashed };
}

export async function gitInit(cwd: string): Promise<void> {
  const res = await fetch(`${getApiBase()}/api/git/init`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "init failed");
}

export async function stashPop(cwd: string): Promise<GitStashPopResult> {
  const res = await fetch(`${getApiBase()}/api/git/stash-pop`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cwd }),
  });
  const json = await res.json();
  if (!json.success) throw new Error(json.error ?? "stash pop failed");
  return json.data;
}
