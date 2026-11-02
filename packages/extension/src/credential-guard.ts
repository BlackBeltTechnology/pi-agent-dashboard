/**
 * Agent credential guard: blocks pi tool calls that read, write or list the
 * dashboard credential files, or that invoke the data key / decrypt. Always on,
 * no configuration, no switch (a switch is the first thing an injected prompt
 * would ask for). Best-effort protection against ACCIDENTAL disclosure, not a
 * sandbox: relative names from a nearby cwd, variable / string indirection,
 * encoded strings and scripts written to disk are NOT detected.
 *
 * Two rule families, decided before the interactive path gate prompts:
 *  - path rules (`read`/`edit`/`write`/`ls`/`find`/`grep`): the canonical target
 *    (shared `tool-path-resolve` resolver, follows symlinks) is a protected file
 *    or a sibling `<name>.*`; `grep` is also blocked on a directory that DIRECTLY
 *    contains a protected file (rg reads hidden files). A missing/empty `path` on
 *    `grep`/`find`/`ls` is the session cwd, as in pi.
 *  - text rules (EVERY tool, built-in / extension / MCP): string values under the
 *    command-bearing fields only (`SCANNED_FIELDS`), never the `write`/`edit`
 *    content fields; path-like protected references (no bare basenames), the data
 *    key service + a keychain verb, `security dump-keychain`, `credentials decrypt`.
 *
 * Fail closed: an internal error blocks only the call being evaluated. Log lines
 * name the tool and the rule id, never the command text or file content.
 * See change: encrypt-credentials-at-rest (D12).
 */
import nodePath from "node:path";
import {
  CREDENTIAL_FILE_BASENAMES,
  CREDENTIAL_KEYCHAIN_SERVICE,
  DATA_KEY_FILE_ENV,
} from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import {
  canonicalizeTarget,
  defaultResolveEnv,
  type ResolveEnv,
  resolveReadTarget,
  resolveToolPath,
} from "./path-gate/resolve.js";

/** Rule ids carried by the `match=` token of the block log line. */
export type CredentialGuardRule = "path" | "grep-dir" | "text-path" | "text-keychain" | "text-dump" | "text-decrypt" | "depth";

export interface CredentialGuardDeps {
  env: NodeJS.ProcessEnv;
  homedir: string;
  /** One line per block / error. Never receives command text or file content. */
  log?: (line: string) => void;
  /** Resolver environment (tests). Default: the real host with `homeDir` = `homedir`. */
  resolveEnv?: ResolveEnv;
  /** Canonicaliser (tests inject a throwing one). Default: shared `canonicalizeTarget`. */
  canonicalize?: (absPath: string, env: ResolveEnv) => string;
}

export interface GuardEvent {
  toolName?: string;
  toolCallId?: string;
  input?: unknown;
}

export interface GuardCtx {
  cwd?: string;
  hasUI?: boolean;
}

export type GuardResult = { block: true; reason: string } | undefined;

/** Tools decided by the path rule (their `path` argument is a filesystem target). */
const PATH_TOOLS = ["read", "edit", "write", "ls", "find", "grep"] as const;
/** Tools whose missing/empty `path` means the session cwd (pi's behaviour). */
const CWD_DEFAULT_TOOLS = ["grep", "find", "ls"] as const;
/** String values are scanned only under these field names (any depth). */
const SCANNED_FIELDS: ReadonlySet<string> = new Set([
  "command", "script", "code", "args", "url", "path", "file", "filePath", "cwd", "pattern", "glob",
]);
/** `write`/`edit` content fields: never scanned (their targets are covered by the path rule). */
const CONTENT_FIELDS: ReadonlySet<string> = new Set(["content", "newText", "oldText", "edits"]);
const CONTENT_TOOLS: ReadonlySet<string> = new Set(["write", "edit"]);
const MAX_DEPTH = 32;

const KEYCHAIN_VERBS = [
  "find-generic-password",
  "delete-generic-password",
  "secret-tool",
  "get-storedcredential",
  "credentialmanager",
  "cmdkey",
] as const;
const DUMP_RE = /security\s+dump-keychain/i;
const DECRYPT_RE = /credentials\s+decrypt/i;

/** Path-like reference form: lowercase, `\` → `/`. */
const norm = (s: string): string => s.replaceAll("\\", "/").toLowerCase();
/** Path comparison form: NFC + lowercase (never fail open on a case-folding volume). */
const fold = (s: string): string => s.normalize("NFC").toLowerCase();
/** Tool names reach the log: keep only a short, harmless token. */
const safeName = (s: unknown): string => String(s ?? "unknown").replace(/[^\w.:-]/g, "_").slice(0, 64);

/** Collect scanned strings: any depth, only under a scanned field name. False when nested too deep. */
function collectScanned(value: unknown, scanned: boolean, skipContent: boolean, depth: number, out: string[]): boolean {
  if (depth > MAX_DEPTH) return false;
  if (typeof value === "string") {
    if (scanned) out.push(value);
    return true;
  }
  if (Array.isArray(value)) return value.every((v) => collectScanned(v, scanned, skipContent, depth + 1, out));
  if (value && typeof value === "object") return collectFromObject(value as Record<string, unknown>, scanned, skipContent, depth, out);
  return true;
}

function collectFromObject(obj: Record<string, unknown>, scanned: boolean, skipContent: boolean, depth: number, out: string[]): boolean {
  for (const [k, v] of Object.entries(obj)) {
    if (skipContent && CONTENT_FIELDS.has(k)) continue;
    if (!collectScanned(v, scanned || SCANNED_FIELDS.has(k), skipContent, depth + 1, out)) return false;
  }
  return true;
}

/** The tool's path argument; a missing/empty `path` on grep/find/ls is the session cwd (pi's behaviour). */
function targetPathOf(tool: string, input: Record<string, unknown>, cwd: string): string | undefined {
  const raw = input.path;
  const missing = raw === undefined || raw === null || raw === "";
  const raw2 = missing && (CWD_DEFAULT_TOOLS as readonly string[]).includes(tool) ? cwd : raw;
  return typeof raw2 === "string" && raw2 !== "" ? raw2 : undefined; // else pi rejects it itself
}

export function createCredentialGuard(deps: CredentialGuardDeps) {
  const log = deps.log ?? (() => {});
  const canonicalize = deps.canonicalize ?? canonicalizeTarget;
  const resolveEnv = (): ResolveEnv => deps.resolveEnv ?? { ...defaultResolveEnv(), homeDir: deps.homedir };

  /** Protected files, lexical (env read per call: cheap, and always current). */
  const protectedLexical = (): string[] => {
    const out = [
      nodePath.join(deps.homedir, ".pi", "agent", CREDENTIAL_FILE_BASENAMES["plugin-credentials"]),
      nodePath.join(deps.homedir, ".pi", "dashboard", CREDENTIAL_FILE_BASENAMES.vault),
    ];
    const agentDir = deps.env.PI_CODING_AGENT_DIR;
    if (agentDir) out.push(nodePath.resolve(agentDir, CREDENTIAL_FILE_BASENAMES["plugin-credentials"]));
    const keyFile = deps.env[DATA_KEY_FILE_ENV];
    if (keyFile) out.push(nodePath.resolve(keyFile));
    return out;
  };

  /**
   * The env-configured paths AS WRITTEN (not resolved). On win32 a POSIX-style value
   * (`/home/pi/.pi-key/data-key`) resolves to `D:\home\...`, which a command quoting
   * the configured string never contains; text rules match both forms.
   */
  const configuredLexical = (): string[] => {
    const out: string[] = [];
    const agentDir = deps.env.PI_CODING_AGENT_DIR;
    if (agentDir) out.push(`${agentDir.replace(/[\\/]+$/, "")}/${CREDENTIAL_FILE_BASENAMES["plugin-credentials"]}`);
    const keyFile = deps.env[DATA_KEY_FILE_ENV];
    if (keyFile) out.push(keyFile);
    return out;
  };

  const block = (tool: string, rule: CredentialGuardRule): GuardResult => {
    log(`[credential-guard] blocked tool=${safeName(tool)} match=${rule}`);
    return { block: true, reason: `credential_guard: ${safeName(tool)} targets dashboard credential storage` };
  };

  /** Path rule on one canonical target; `isGrep` adds the directory rule. */
  function pathRule(canonical: string, protectedCanon: string[], isGrep: boolean): CredentialGuardRule | undefined {
    const t = fold(canonical);
    const dir = fold(nodePath.dirname(canonical));
    const base = fold(nodePath.basename(canonical));
    for (const p of protectedCanon) {
      const pf = fold(p);
      if (t === pf) return "path";
      // sibling `<name>.*` in the same directory (lock, temp, .corrupt-*, .undecryptable-*)
      if (dir === fold(nodePath.dirname(p)) && base.startsWith(`${fold(nodePath.basename(p))}.`)) return "path";
      if (isGrep && t === fold(nodePath.dirname(p))) return "grep-dir";
    }
    return undefined;
  }

  function decidePath(tool: string, input: Record<string, unknown>, ctx: GuardCtx): CredentialGuardRule | undefined {
    if (!(PATH_TOOLS as readonly string[]).includes(tool)) return undefined;
    const cwd = ctx.cwd || process.cwd();
    const raw = targetPathOf(tool, input, cwd);
    if (raw === undefined) return undefined;
    const env = resolveEnv();
    const protectedCanon = protectedLexical().map((p) => canonicalize(p, env));
    const resolved = resolveToolPath(raw, cwd, env);
    const targets = [canonicalize(resolved, env)];
    if (tool === "read") targets.push(canonicalize(resolveReadTarget(resolved, env), env));
    for (const t of targets) {
      const rule = pathRule(t, protectedCanon, tool === "grep");
      if (rule) return rule;
    }
    return undefined;
  }

  function textRule(s: string, needles: string[]): CredentialGuardRule | undefined {
    const n = norm(s);
    if (needles.some((needle) => n.includes(needle))) return "text-path";
    if (n.includes(CREDENTIAL_KEYCHAIN_SERVICE) && KEYCHAIN_VERBS.some((v) => n.includes(v))) return "text-keychain";
    if (DUMP_RE.test(s)) return "text-dump";
    if (DECRYPT_RE.test(s)) return "text-decrypt";
    return undefined;
  }

  function decideText(tool: string, input: unknown): CredentialGuardRule | undefined {
    const strings: string[] = [];
    if (!collectScanned(input, false, CONTENT_TOOLS.has(tool), 0, strings)) return "depth";
    if (strings.length === 0) return undefined;
    const needles = [
      `.pi/agent/${CREDENTIAL_FILE_BASENAMES["plugin-credentials"]}`,
      `.pi/dashboard/${CREDENTIAL_FILE_BASENAMES.vault}`,
      ...protectedLexical().slice(2).map(norm),
      ...configuredLexical().map(norm),
    ];
    for (const s of strings) {
      const rule = textRule(s, needles);
      if (rule) return rule;
    }
    return undefined;
  }

  function handler(event: GuardEvent, ctx: GuardCtx): GuardResult {
    const tool = typeof event?.toolName === "string" ? event.toolName : "";
    try {
      const input = event?.input ?? {};
      const asRecord = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
      const rule = decidePath(tool, asRecord, ctx ?? {}) ?? decideText(tool, input);
      return rule ? block(tool, rule) : undefined;
    } catch {
      // Fail closed for THIS call only; never log the error text (it may carry a path).
      log(`[credential-guard] error tool=${safeName(tool)}`);
      return { block: true, reason: `credential_guard: ${safeName(tool)} could not be checked` };
    }
  }

  return { handler };
}

/**
 * The `tool_call` handler `bridge.ts` registers: a no-op for a stale bridge
 * instance (after /reload), otherwise the guard. Deliberately NOT wrapped in the
 * fail-open `safe()`: the guard itself maps an internal error to a block.
 */
export function createCredentialGuardToolCallHandler(
  guard: ReturnType<typeof createCredentialGuard>,
  isActive: () => boolean,
): (event: GuardEvent, ctx: GuardCtx) => GuardResult {
  return (event, ctx) => {
    if (!isActive()) return undefined;
    return guard.handler(event, ctx);
  };
}
