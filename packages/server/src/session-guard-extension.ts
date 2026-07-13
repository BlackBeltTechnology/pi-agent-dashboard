/**
 * Tool-call containment guard extension (change: constrain-agent-tool-surface).
 *
 * Loaded via `-e` into every guarded invoice-bot session that carries a folder
 * policy. It rejects, before execution, any remaining (extension/custom) tool
 * call whose path argument resolves outside the allowed roots, and any call to a
 * denied tool. Because guarded sessions run with `--no-builtin-tools`, there is
 * no shell/exec primitive that can bypass this hook — so it is an authoritative
 * working-directory boundary, in-process and cross-platform.
 *
 * Policy is passed by the host via env:
 *   IB_GUARD_ALLOWED_ROOTS  path-delimiter list of allowed roots (default: cwd)
 *   IB_GUARD_DENIED_TOOLS   comma list of tool names to block outright
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { collectPathCandidates, pathWithinRoots } from "./session-guard.js";

function allowedRoots(): string[] {
  const raw = process.env.IB_GUARD_ALLOWED_ROOTS;
  const roots = (raw ? raw.split(path.delimiter) : [process.cwd()])
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => path.resolve(r));
  return roots.length ? roots : [path.resolve(process.cwd())];
}

function deniedTools(): Set<string> {
  return new Set(
    (process.env.IB_GUARD_DENIED_TOOLS ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
}

function toolNameOf(event: unknown): string {
  const e = event as Record<string, unknown> | null;
  return (
    (e?.toolName as string) ??
    (e?.name as string) ??
    (e?.tool as string) ??
    ((e?.toolCall as Record<string, unknown> | undefined)?.name as string) ??
    ""
  );
}

function inputOf(event: unknown): unknown {
  const e = event as Record<string, unknown> | null;
  return e?.input ?? (e?.toolCall as Record<string, unknown> | undefined)?.input ?? {};
}

export default function sessionGuardExtension(pi: ExtensionAPI): void {
  const roots = allowedRoots();
  const denied = deniedTools();
  const cwd = path.resolve(process.cwd());

  pi.on("tool_call", async (event: unknown) => {
    const name = toolNameOf(event);
    if (denied.has(name)) {
      return { block: true, reason: `Tool "${name}" is not permitted in this session.` };
    }
    for (const cand of collectPathCandidates(inputOf(event))) {
      if (!pathWithinRoots(cand, roots, cwd)) {
        return { block: true, reason: `path outside working directory: ${cand}` };
      }
    }
    return undefined;
  });
}
