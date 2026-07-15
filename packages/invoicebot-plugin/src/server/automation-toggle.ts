/**
 * Operator enable/disable surface for invoicebot schedule automations.
 *
 * Flips ONLY the `disabled` field on a named automation's on-disk
 * `<cwd>/.pi/automation/<name>/automation.yaml`, via the `yaml` Document API
 * (design D3) so comments + every other field survive the round-trip. This is
 * the first invoicebot-plugin surface that does a direct filesystem write
 * rather than wrapping the engine port: no `ib_*` tool touches `disabled` (the
 * engine `cadence` action only rewrites the `cron:` line).
 *
 * The write is single-target, in-place, and never creates: a flip against an
 * absent automation is rejected. The automation-plugin's recursive `fs.watch`
 * on `.pi/automation/` re-scans + re-arms the scheduler on any `automation.yaml`
 * write (≈300ms debounce), so a flip takes effect live without a reload.
 *
 * See change: surface-automation-enable.
 */
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml, parseDocument } from "yaml";

/** Prefix identifying the invoicebot schedule automations (intake / pull). */
const IB_PREFIX = "invoicebot";

/** Names allowed inside `.pi/automation/` (mirrors the automation-plugin guard). */
const NAME_RE = /^[A-Za-z0-9._-]+$/;

/**
 * Reject an automation name that could escape the automation dir: empty,
 * path separators, `..`/`.`, NUL, the reserved `runs` dir, or any char outside
 * the safe set. Returns an error string, or `null` when valid.
 */
export function badAutomationName(name: unknown): string | null {
  if (typeof name !== "string" || name.trim() === "") return "name is required";
  if (name.includes("\0")) return "name is invalid";
  if (name === "." || name === ".." || name === "runs") return "name is invalid";
  if (!NAME_RE.test(name)) return "name is invalid";
  return null;
}

function yamlPathFor(cwd: string, name: string): string {
  return join(cwd, ".pi", "automation", name, "automation.yaml");
}

export interface FlipResult {
  /** Resulting enabled state — negation of the `disabled` field on disk. */
  enabled: boolean;
}

/** Thrown when the named automation has no `automation.yaml` on disk. */
export class AutomationNotFoundError extends Error {
  constructor(name: string) {
    super(`automation not found: ${name}`);
    this.name = "AutomationNotFoundError";
  }
}

/**
 * Flip ONLY the `disabled` node in place and write the file back atomically
 * (tmp + rename), preserving comments and every other field. Re-validates that
 * the result still parses and `disabled` is a boolean before the write.
 *
 * @throws AutomationNotFoundError when the automation does not exist (never creates).
 */
export function flipAutomationDisabled(cwd: string, name: string, enabled: boolean): FlipResult {
  const yamlPath = yamlPathFor(cwd, name);
  if (!existsSync(yamlPath)) throw new AutomationNotFoundError(name);

  const raw = readFileSync(yamlPath, "utf8");
  const doc = parseDocument(raw);
  doc.set("disabled", !enabled);
  const out = String(doc);

  // Re-validate: still valid YAML and `disabled` resolved to a boolean.
  const reparsed = parseYaml(out) as { disabled?: unknown } | null;
  if (!reparsed || typeof reparsed.disabled !== "boolean") {
    throw new Error("re-validation failed: disabled is not a boolean after flip");
  }

  const tmp = `${yamlPath}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, yamlPath);

  return { enabled: reparsed.disabled === false };
}

export interface AutomationState {
  name: string;
  enabled: boolean;
}

/**
 * Enumerate the invoicebot schedule automations under `<cwd>/.pi/automation/`
 * with each one's current enabled state (negation of `disabled`). Tolerates a
 * missing automation dir (returns `[]`) and skips entries that fail to parse.
 * Sorted by name for a stable UI list.
 */
export function listInvoicebotAutomations(cwd: string): AutomationState[] {
  const root = join(cwd, ".pi", "automation");
  let entries: import("node:fs").Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return []; // no automation dir in this workspace
  }

  const out: AutomationState[] = [];
  for (const ent of entries) {
    if (!ent.isDirectory()) continue;
    if (!ent.name.startsWith(IB_PREFIX)) continue;
    const yamlPath = join(root, ent.name, "automation.yaml");
    let raw: string;
    try {
      raw = readFileSync(yamlPath, "utf8");
    } catch {
      continue; // no automation.yaml — skip
    }
    let parsed: { disabled?: unknown } | null;
    try {
      parsed = parseYaml(raw) as { disabled?: unknown } | null;
    } catch {
      continue; // unparseable — skip
    }
    out.push({ name: ent.name, enabled: parsed?.disabled !== true });
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}
