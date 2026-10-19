/**
 * Pure decision for the path-containment guard: given a tool call and the parsed
 * config, allow it or say why it is rejected. No prompting, no UI, no I/O beyond
 * the injected resolve env. Throws only on an unrecoverable resolver fault; the
 * handler turns a throw into code `error` (fail closed).
 * See change: add-path-containment-guard-extension (D3).
 */
import {
  canonicalizeTarget,
  defaultResolveEnv,
  isPathWithinRoots,
  type ResolveEnv,
  resolveReadTarget,
  resolveToolPath,
} from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";
import type { GuardConfig } from "./config.js";
import { captureFaults } from "./strict-env.js";

export type GuardCode = "tool_denied" | "path_outside_roots" | "invalid_path" | "config_invalid" | "error";

export type GuardDecision =
  | { allow: true }
  | { allow: false; code: GuardCode; tool: string; canonical?: string };

export interface DecideOptions {
  env?: ResolveEnv;
  /** Force volume case sensitivity (tests). */
  caseInsensitive?: boolean;
  /** Injectable volume probe (tests). */
  volumeCaseProbe?: (existingPathOrAncestor: string) => boolean;
}

const PATH_TOOLS: ReadonlySet<string> = new Set(["read", "write", "edit", "grep", "find", "ls"]);
/** `path` is mandatory here; grep/find/ls default an absent path to the cwd. */
const PATH_REQUIRED: ReadonlySet<string> = new Set(["read", "write", "edit"]);

const reject = (code: GuardCode, tool: string, canonical?: string): GuardDecision =>
  canonical === undefined ? { allow: false, code, tool } : { allow: false, code, tool, canonical };

/** The path to resolve, or `undefined` when the argument is invalid (→ `invalid_path`). */
function pathArgument(toolName: string, input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const raw = (input as { path?: unknown }).path;
  if (raw === undefined || raw === null || raw === "") return PATH_REQUIRED.has(toolName) ? undefined : ".";
  if (typeof raw !== "string" || raw.includes("\0")) return undefined;
  return raw;
}

export function decideGuard(
  toolName: string,
  input: unknown,
  cwd: string,
  config: GuardConfig,
  opts: DecideOptions = {},
): GuardDecision {
  if (!config.ok && config.scope === "all") return reject("config_invalid", toolName);
  if (config.deniedTools.has(toolName)) return reject("tool_denied", toolName);
  if (!PATH_TOOLS.has(toolName)) return { allow: true };
  if (!config.ok) return reject("config_invalid", toolName);

  const target = pathArgument(toolName, input);
  if (target === undefined) return reject("invalid_path", toolName);

  const env = opts.env ?? defaultResolveEnv();
  const cap = captureFaults(env);
  const lexical = resolveToolPath(target, cwd, cap.env);
  // `read` opens pi's filename-variant fallback, not necessarily the literal name.
  const abs = toolName === "read" ? resolveReadTarget(lexical, cap.env) : lexical;
  const canonical = canonicalizeTarget(abs, cap.env);
  const fault = cap.fault();
  if (fault !== undefined) throw fault instanceof Error ? fault : new Error(String(fault));

  const inside = isPathWithinRoots(canonical, config.roots, {
    env,
    caseInsensitive: opts.caseInsensitive,
    volumeCaseProbe: opts.volumeCaseProbe,
  });
  return inside ? { allow: true } : reject("path_outside_roots", toolName, canonical);
}
