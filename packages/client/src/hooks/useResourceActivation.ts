/**
 * Owns the Resources-surface activation UX: optimistic enable/disable overrides,
 * the one-click "Reload N sessions" pending state, failure surfacing, and the
 * project-trust dialog a folder-scope write can require.
 *
 * pi reads resource arrays at session start, so a toggle only takes effect on
 * reload — hence the pending-reload affordance.
 *
 * A folder-scope disable of a *global* resource re-declares it in the folder's
 * settings, so pi afterwards reports it at project scope. The row is kept where
 * the user acted on it and marked folder-controlled rather than silently
 * jumping sections. See change: folder-resource-activation-toggle,
 * project-scope-disable-global-resources.
 */

import type { PiResource } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import { useCallback, useState } from "react";
import {
  type ResourceScope,
  type ResourceTrustOption,
  type ResourceType,
  reloadResourceSessions,
  submitResourceTrust,
  toggleResource,
} from "../lib/api/resources-api.js";

export interface PendingReload {
  scope: ResourceScope;
  cwd?: string;
  count: number;
}

/** A toggle failure the user must see. `kind` distinguishes a server refusal
 *  from a request that never reached the server. */
export interface ToggleError {
  filePath: string;
  message: string;
  kind: "server" | "network";
}

export interface TrustPrompt {
  cwd: string;
  message: string;
  options: ResourceTrustOption[];
  implicitlyTrusted: boolean;
}

interface ToggleArgs {
  scope: ResourceScope;
  cwd?: string;
  r: PiResource;
  type: ResourceType;
  next: boolean;
  packageSource?: string;
}

export interface ResourceActivationController {
  /** Displayed enabled state, honoring any optimistic override. */
  isEnabled: (r: PiResource) => boolean;
  /** Toggle a resource for a scope. `packageSource` set for package-contributed resources. */
  toggle: (r: PiResource, scope: ResourceScope, packageSource?: string) => void;
  /** True when this folder has taken over a globally-defined resource's activation. */
  isFolderControlled: (r: PiResource) => boolean;
  pending: PendingReload | null;
  reload: () => void;
  clearPending: () => void;
  error: ToggleError | null;
  clearError: () => void;
  trustPrompt: TrustPrompt | null;
  /** Persist the chosen trust option and retry the toggle; `decline` reverts. */
  resolveTrust: (optionId: ResourceTrustOption["id"]) => void;
  /** Dismiss without choosing: revert the control, write nothing. */
  dismissTrust: () => void;
}

export function useResourceActivation(cwd?: string): ResourceActivationController {
  const [overrides, setOverrides] = useState<Map<string, boolean>>(new Map());
  const [folderControlled, setFolderControlled] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingReload | null>(null);
  const [error, setError] = useState<ToggleError | null>(null);
  const [trustPrompt, setTrustPrompt] = useState<TrustPrompt | null>(null);
  // The toggle a trust prompt interrupted, replayed verbatim on approval.
  const [deferred, setDeferred] = useState<{
    args: ToggleArgs;
    revert: () => void;
    apply: () => void;
  } | null>(null);

  const isEnabled = useCallback(
    (r: PiResource) => (overrides.has(r.filePath) ? (overrides.get(r.filePath) as boolean) : r.enabled),
    [overrides],
  );

  const isFolderControlled = useCallback((r: PiResource) => folderControlled.has(r.filePath), [folderControlled]);

  const runToggle = useCallback(async (args: ToggleArgs, revert: () => void, apply: () => void): Promise<void> => {
    const scopeCwd = args.scope === "local" ? args.cwd : undefined;
    try {
      const res = await toggleResource({
        scope: args.scope,
        // The folder is carried even at global scope so the resource resolves
        // against the folder the user is looking at, not the server's own cwd.
        cwd: args.cwd,
        type: args.type,
        filePath: args.r.filePath,
        enabled: args.next,
        packageSource: args.packageSource,
      });
      if (res.trustRequired && res.trustOptions && args.cwd) {
        // Nothing was written, so the control must NOT sit in the requested
        // state while the dialog is open. It flips only once the write lands.
        revert();
        setDeferred({ args, revert, apply });
        setTrustPrompt({
          cwd: args.cwd,
          message: res.error ?? "",
          options: res.trustOptions,
          implicitlyTrusted: res.implicitlyTrusted === true,
        });
        return;
      }
      if (!res.ok) {
        revert();
        setError({
          filePath: args.r.filePath,
          message: res.error ?? `Request failed (${res.status})`,
          kind: "server",
        });
        return;
      }
      // A folder-scope disable of a global resource is what flips its scope.
      setFolderControlled((s) => {
        const next = new Set(s);
        if (args.scope === "local" && !args.next) next.add(args.r.filePath);
        else next.delete(args.r.filePath);
        return next;
      });
      setPending(
        res.affectedSessions.length > 0
          ? { scope: args.scope, cwd: scopeCwd, count: res.affectedSessions.length }
          : null,
      );
    } catch (err) {
      // The request never reached the server: report that distinctly from a
      // refusal the server sent back.
      revert();
      setError({
        filePath: args.r.filePath,
        message: (err as Error)?.message ?? "The request did not reach the server.",
        kind: "network",
      });
    }
  }, []);

  const toggle = useCallback(
    (r: PiResource, scope: ResourceScope, packageSource?: string) => {
      // Agents have no pi activation dimension; the card never renders a toggle
      // for them, but guard here too. See change: resources-card-tabs.
      if (r.type === "agent") return;
      const type: ResourceType = r.type;
      const prev = overrides.has(r.filePath) ? (overrides.get(r.filePath) as boolean) : r.enabled;
      const next = !prev;
      setError(null);
      const apply = () => setOverrides((m) => new Map(m).set(r.filePath, next));
      const revert = () => setOverrides((m) => new Map(m).set(r.filePath, prev));
      // Optimistic flip.
      apply();
      void runToggle({ scope, cwd, r, type, next, packageSource }, revert, apply);
    },
    [cwd, overrides, runToggle],
  );

  const dismissTrust = useCallback(() => {
    deferred?.revert();
    setDeferred(null);
    setTrustPrompt(null);
  }, [deferred]);

  const resolveTrust = useCallback(
    (optionId: ResourceTrustOption["id"]) => {
      const promptCwd = trustPrompt?.cwd;
      const pendingToggle = deferred;
      setTrustPrompt(null);
      setDeferred(null);
      if (optionId === "decline" || !promptCwd || !pendingToggle) {
        pendingToggle?.revert();
        return;
      }
      void (async () => {
        try {
          const res = await submitResourceTrust(promptCwd, optionId);
          if (!res.ok) {
            pendingToggle.revert();
            setError({
              filePath: pendingToggle.args.r.filePath,
              message: res.error ?? `Could not record the trust decision (${res.status})`,
              kind: "server",
            });
            return;
          }
          // Trust is recorded; re-apply the optimistic flip and replay.
          pendingToggle.apply();
          await runToggle(pendingToggle.args, pendingToggle.revert, pendingToggle.apply);
        } catch (err) {
          pendingToggle.revert();
          setError({
            filePath: pendingToggle.args.r.filePath,
            message: (err as Error)?.message ?? "The request did not reach the server.",
            kind: "network",
          });
        }
      })();
    },
    [deferred, runToggle, trustPrompt],
  );

  const reload = useCallback(() => {
    if (!pending) return;
    void (async () => {
      try {
        const res = await reloadResourceSessions(pending.scope, pending.cwd);
        if (res.ok) setPending(null);
      } catch {
        // Network error: keep the pending banner so the user can retry.
      }
    })();
  }, [pending]);

  const clearPending = useCallback(() => setPending(null), []);
  const clearError = useCallback(() => setError(null), []);

  return {
    isEnabled,
    toggle,
    isFolderControlled,
    pending,
    reload,
    clearPending,
    error,
    clearError,
    trustPrompt,
    resolveTrust,
    dismissTrust,
  };
}
