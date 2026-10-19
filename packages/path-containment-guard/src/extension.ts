/**
 * pi-path-containment-guard — extension entry point (loaded only via `-e` /
 * `scope.extensions`, never by discovery).
 *
 * The factory is TOTAL: it never throws and always registers exactly one
 * `tool_call` handler. pi drops an extension whose factory throws, and on a
 * session reload it then continues without it — which would silently un-guard
 * the session. So any load-time failure becomes a block-everything config.
 * The handler never prompts: it returns `{ block: true, reason }`.
 * See change: add-path-containment-guard-extension (D3, D4).
 */

import { defaultResolveEnv, type ResolveEnv } from "@blackbelt-technology/pi-dashboard-shared/tool-path-resolve.js";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { type GuardConfig, parseGuardConfig } from "./config.js";
import { decideGuard, type GuardCode, type GuardDecision } from "./decide.js";

export interface GuardExtensionDeps {
  env?: Readonly<Record<string, string | undefined>>;
  resolveEnv?: ResolveEnv;
  /** Injectable for fault tests. */
  parseConfig?: typeof parseGuardConfig;
  /** One call per rejection (default: stderr). */
  log?: (line: string) => void;
}

/** Escape control characters (incl. U+2028/U+2029) so a crafted name cannot forge a log record. */
function esc(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, (c) => {
    if (c === "\n") return "\\n";
    if (c === "\r") return "\\r";
    if (c === "\t") return "\\t";
    return `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

function reasonOf(code: GuardCode, tool: string, canonical: string | undefined, config: GuardConfig): string {
  let reason: string = code;
  if (code !== "config_invalid" || tool) reason += `: ${tool}`;
  if (canonical !== undefined) reason += ` ${canonical}`;
  if (code === "path_outside_roots" && config.ok) reason += ` — allowed roots: ${config.roots.join(", ")}`;
  return reason;
}

export function createGuardExtension(deps: GuardExtensionDeps = {}): (pi: ExtensionAPI) => void {
  return function pathContainmentGuard(pi: ExtensionAPI): void {
    let resolveEnv: ResolveEnv | undefined;
    let config: GuardConfig;
    try {
      // inside the try: anything that goes wrong at load (even `os.homedir()`) must still register the block-all handler
      resolveEnv = deps.resolveEnv ?? defaultResolveEnv();
      config = (deps.parseConfig ?? parseGuardConfig)(deps.env ?? process.env, { resolveEnv });
    } catch {
      config = { ok: false, scope: "all" };
    }
    const log = deps.log ?? ((line: string) => void process.stderr.write(`${line}\n`));

    const evaluate = (
      event: { toolName?: unknown; input?: unknown } | undefined,
      ctx: { cwd?: unknown } | undefined,
    ): GuardDecision => {
      const tool = typeof event?.toolName === "string" ? event.toolName : String(event?.toolName);
      try {
        const cwd = typeof ctx?.cwd === "string" && ctx.cwd !== "" ? ctx.cwd : process.cwd();
        return decideGuard(tool, event?.input, cwd, config, { env: resolveEnv });
      } catch {
        return { allow: false, code: "error", tool };
      }
    };

    pi.on("tool_call", async (event, ctx) => {
      const decision = evaluate(event, ctx);
      if (decision.allow) return undefined;
      try {
        log(
          `[path-containment-guard] ${decision.code} tool=${esc(decision.tool)}${
            decision.canonical === undefined ? "" : ` path=${esc(decision.canonical)}`
          }`,
        );
      } catch {
        // logging must never turn a rejection into an allow
      }
      return { block: true, reason: reasonOf(decision.code, decision.tool, decision.canonical, config) };
    });
  };
}

export default createGuardExtension();
