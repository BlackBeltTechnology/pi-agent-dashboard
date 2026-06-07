/**
 * Self-contained "Initialize" button for a directory / worktree row.
 *
 * Probes `GET /api/git/worktree/init-status` lazily for `cwd` and renders
 * an Initialize button iff the row declares a hook AND its gate reports
 * `needsInit`. Clicking runs the hook via `POST /api/git/worktree/init`:
 *   - untrusted hook → trust-confirm dialog naming the gate + run; on
 *     confirm, re-issues with `confirmHash`.
 *   - progress streams to a live tail (via the worktree-init bus).
 *   - failure renders a spawn-error-style card (code + stderr/log tail).
 *   - success re-fetches init-status; the gate flips and the button
 *     disappears.
 *
 * Fail-open: any probe error hides the button.
 *
 * See change: generalize-worktree-init-hook.
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "@mdi/react";
import { mdiCogPlayOutline, mdiAlertCircleOutline } from "@mdi/js";
import { Confirm } from "@blackbelt-technology/pi-dashboard-client-utils/Confirm";
import {
  fetchWorktreeInitStatus,
  runWorktreeInit,
  type WorktreeInitHook,
  type WorktreeInitStatus,
} from "../lib/git-api.js";
import { subscribeInit, type WorktreeInitEvent } from "../lib/worktree-init-bus.js";

let reqCounter = 0;
function mintRequestId(): string {
  return `winit-${Date.now()}-${reqCounter++}`;
}

function describeRun(hook: WorktreeInitHook): string {
  return hook.run.type === "script"
    ? `command: ${hook.run.command}`
    : `agent prompt: ${hook.run.prompt}${hook.run.model ? ` (model ${hook.run.model})` : ""}`;
}

interface Props {
  cwd: string;
}

export function WorktreeInitButton({ cwd }: Props) {
  const [status, setStatus] = useState<WorktreeInitStatus | null>(null);
  const [phase, setPhase] = useState<"idle" | "running" | "failed">("idle");
  const [tail, setTail] = useState("");
  const [error, setError] = useState<{ code: string; message: string; stderr?: string } | null>(null);
  const [confirm, setConfirm] = useState<{ hook: WorktreeInitHook; hash: string } | null>(null);
  const reqRef = useRef<string | null>(null);

  const refetch = useCallback(() => {
    return fetchWorktreeInitStatus(cwd).then(setStatus);
  }, [cwd]);

  // Lazy per-row probe.
  useEffect(() => {
    let alive = true;
    fetchWorktreeInitStatus(cwd).then((s) => { if (alive) setStatus(s); });
    return () => { alive = false; };
  }, [cwd]);

  // Stream progress while a run is in flight.
  useEffect(() => {
    if (phase !== "running" || !reqRef.current) return;
    const unsub = subscribeInit(reqRef.current, (ev: WorktreeInitEvent) => {
      if (ev.type === "worktree_init_progress") {
        setTail(ev.line);
      } else if (ev.type === "worktree_init_done") {
        setPhase("idle");
        setTail("");
        void refetch();
      } else if (ev.type === "worktree_init_failed") {
        setPhase("failed");
        setError({ code: ev.code, message: ev.message, stderr: ev.stderr });
      }
    });
    return unsub;
  }, [phase, refetch]);

  const doRun = useCallback(async (confirmHash?: string) => {
    const requestId = mintRequestId();
    reqRef.current = requestId;
    setError(null);
    setTail("");
    setPhase("running");
    try {
      const res = await runWorktreeInit({ cwd, requestId, confirmHash });
      if (res.ok) {
        setPhase("idle");
        void refetch();
      } else if (res.untrusted) {
        // Hold until the user confirms; pause the running phase.
        setPhase("idle");
        setConfirm({ hook: res.hook, hash: res.hash });
      } else {
        setPhase("failed");
        setError({ code: res.code, message: res.error, stderr: res.stderr });
      }
    } catch (err) {
      // Network / JSON failure — surface it instead of staying stuck "running".
      setPhase("failed");
      setError({ code: "network_failure", message: err instanceof Error ? err.message : "init failed" });
    }
  }, [cwd, refetch]);

  // Show when init is needed, OR when a hook exists but isn't trusted yet (the
  // gate hasn't run server-side, so `needsInit` is unknown until the user
  // confirms trust). See change: generalize-worktree-init-hook (#10).
  const showButton = !!status && status.hasHook === true && (status.trusted === false || status.needsInit === true);
  if (!showButton && phase !== "failed" && phase !== "running") return null;

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        onClick={(e) => { e.stopPropagation(); void doRun(); }}
        disabled={phase === "running"}
        data-testid="worktree-init-btn"
        className={`text-[10px] px-1.5 py-0.5 rounded border ${
          phase === "running"
            ? "border-[var(--border-secondary)] text-[var(--text-secondary)] opacity-60 cursor-not-allowed"
            : "text-amber-400 border-amber-500/40 bg-amber-500/5 hover:text-amber-300 hover:border-amber-500/70"
        }`}
        title="Initialize this checkout (run its declared worktree-init hook)"
      >
        <span className="inline-flex items-center gap-0.5">
          <Icon path={mdiCogPlayOutline} size={0.5} />
          {phase === "running" ? "Initializing…" : "Initialize"}
        </span>
      </button>

      {phase === "running" && tail && (
        <pre
          data-testid="worktree-init-tail"
          className="text-[10px] whitespace-pre-wrap bg-[var(--bg-tertiary)] p-2 rounded border border-[var(--border-subtle)] max-h-40 overflow-auto font-mono"
        >{tail}</pre>
      )}

      {phase === "failed" && error && (
        <div className="text-[11px]" data-testid="worktree-init-error">
          <div className="text-red-300 inline-flex items-center gap-1">
            <Icon path={mdiAlertCircleOutline} size={0.5} />
            <span className="font-mono">{error.code}</span>: {error.message}
          </div>
          {error.stderr && (
            <pre className="mt-1 text-[10px] whitespace-pre-wrap bg-[var(--bg-tertiary)] p-2 rounded border border-[var(--border-subtle)] max-h-32 overflow-auto">{error.stderr}</pre>
          )}
        </div>
      )}

      {confirm && (
        <Confirm
          open
          title="Run worktree-init hook?"
          message={
            `Run this project's worktree-init hook?\n\ngate: ${confirm.hook.gate}\n${describeRun(confirm.hook)}\n\n` +
            `This executes repo-provided code on your machine.`
          }
          confirmLabel="Run"
          onConfirm={() => { const hash = confirm.hash; setConfirm(null); void doRun(hash); }}
          onClose={() => setConfirm(null)}
        />
      )}
    </div>
  );
}
