/**
 * `automation.yaml` schema parser + validator.
 *
 * Parses raw YAML text into a validated `AutomationConfig`, applying
 * defaults and isolating invalid automations (an invalid file marks ONLY
 * that automation invalid — siblings keep loading). Trigger-kind validity
 * is checked against the set of registered kinds passed in by the caller
 * (the trigger registry), so the schema layer needs no knowledge of which
 * kinds exist.
 *
 * See change: add-automation-plugin.
 */
import { parse as parseYaml } from "yaml";
import type {
  AutomationConfig,
  AutomationAction,
  Concurrency,
  RunMode,
  Sandbox,
  Visibility,
} from "../shared/automation-types.js";
import {
  TRIGGER_TAXONOMY,
  onKindForCategory,
  categoryForOnKind,
} from "./trigger-registry.js";

/** On-disk `on.kind` values the taxonomy recognizes (schedule, openspec, …). */
const TAXONOMY_KINDS = new Set(
  TRIGGER_TAXONOMY.map((c) => onKindForCategory(c.category)),
);
/** Categories that require a non-empty `on.events[]`. */
const MULTI_TYPE_CATEGORIES = new Set(
  TRIGGER_TAXONOMY.filter((c) => c.multiType).map((c) => c.category),
);

const MODES: RunMode[] = ["worktree", "local"];
const SANDBOXES: Sandbox[] = ["read-only", "workspace-write", "full-access"];
const CONCURRENCIES: Concurrency[] = ["skip", "queue", "parallel"];
const VISIBILITIES: Visibility[] = ["hidden", "shown"];

const DEFAULT_MODE: RunMode = "worktree";
const DEFAULT_SANDBOX: Sandbox = "workspace-write";
const DEFAULT_CONCURRENCY: Concurrency = "skip";

export interface ParseResult {
  config?: AutomationConfig;
  error?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Parse + validate `automation.yaml` text.
 *
 * @param rawText  The file contents.
 * @param knownKinds  Set of registered trigger kinds (e.g. `{"schedule"}`).
 *                    An `on.kind` outside this set fails validation with an
 *                    error naming the kind.
 */
export function parseAutomationYaml(
  rawText: string,
  knownKinds: ReadonlySet<string>,
): ParseResult {
  let doc: unknown;
  try {
    doc = parseYaml(rawText);
  } catch (e) {
    return { error: `YAML parse error: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!isRecord(doc)) {
    return { error: "automation.yaml must be a mapping" };
  }

  // ── on (trigger) ─────────────────────────────────────────────────────
  const on = doc.on;
  if (!isRecord(on)) {
    return { error: "missing or invalid `on:` trigger block" };
  }
  const kind = on.kind;
  if (typeof kind !== "string" || kind.length === 0) {
    return { error: "`on.kind` must be a non-empty string" };
  }
  // A kind is valid when it is registered (armable) OR advertised in the
  // static taxonomy (parseable-but-dormant until its handler registers).
  if (!knownKinds.has(kind) && !TAXONOMY_KINDS.has(kind)) {
    return { error: `unknown trigger kind: "${kind}"` };
  }
  // Multi-type categories (e.g. openspec, git, file) require a non-empty
  // `events: string[]`; single-type categories (scheduled, webhook) do not.
  const category = categoryForOnKind(kind);
  let events: string[] | undefined;
  if (on.events !== undefined) {
    if (
      !Array.isArray(on.events) ||
      on.events.length === 0 ||
      !on.events.every((e) => typeof e === "string" && e.length > 0)
    ) {
      return { error: "`on.events` must be a non-empty array of event-type strings" };
    }
    events = on.events as string[];
  }
  if (MULTI_TYPE_CATEGORIES.has(category) && !events) {
    return {
      error: `trigger category "${category}" requires a non-empty \`on.events\` selection`,
    };
  }

  // ── action ───────────────────────────────────────────────────────────
  const action = doc.action;
  if (!isRecord(action)) {
    return { error: "missing or invalid `action:` block" };
  }
  const actionResult = validateAction(action);
  if ("error" in actionResult) return { error: actionResult.error };

  // ── model ────────────────────────────────────────────────────────────
  const model = doc.model;
  if (typeof model !== "string" || model.length === 0) {
    return { error: "`model` must be a non-empty string (a provider/model id or @role)" };
  }

  // ── mode / sandbox / concurrency / visibility (with defaults) ─────────
  const mode = pickEnum(doc.mode, MODES, DEFAULT_MODE, "mode");
  if ("error" in mode) return { error: mode.error };
  const sandbox = pickEnum(doc.sandbox, SANDBOXES, DEFAULT_SANDBOX, "sandbox");
  if ("error" in sandbox) return { error: sandbox.error };
  const concurrency = pickEnum(doc.concurrency, CONCURRENCIES, DEFAULT_CONCURRENCY, "concurrency");
  if ("error" in concurrency) return { error: concurrency.error };

  let visibility: Visibility | undefined;
  if (doc.visibility !== undefined) {
    if (typeof doc.visibility !== "string" || !VISIBILITIES.includes(doc.visibility as Visibility)) {
      return { error: `\`visibility\` must be one of ${VISIBILITIES.join(" | ")}` };
    }
    visibility = doc.visibility as Visibility;
  }

  let disabled: boolean | undefined;
  if (doc.disabled !== undefined) {
    if (typeof doc.disabled !== "boolean") {
      return { error: "`disabled` must be a boolean" };
    }
    disabled = doc.disabled;
  }

  const config: AutomationConfig = {
    on: { ...on, kind, ...(events ? { events } : {}) },
    action: actionResult.value,
    model,
    mode: mode.value,
    sandbox: sandbox.value,
    concurrency: concurrency.value,
    ...(visibility ? { visibility } : {}),
    ...(disabled ? { disabled } : {}),
  };
  return { config };
}

function validateAction(
  action: Record<string, unknown>,
): { value: AutomationAction } | { error: string } {
  const kind = action.kind;
  if (kind === "prompt") {
    const prompt = action.prompt;
    if (typeof prompt !== "string" || prompt.length === 0) {
      return { error: "`action.prompt` must be a path string for prompt actions" };
    }
    return { value: { kind: "prompt", prompt } };
  }
  if (kind === "skill") {
    const skill = action.skill;
    if (typeof skill !== "string" || skill.length === 0) {
      return { error: "`action.skill` must be a `$skill-name` string for skill actions" };
    }
    return { value: { kind: "skill", skill } };
  }
  return { error: '`action.kind` must be "prompt" or "skill"' };
}

function pickEnum<T extends string>(
  raw: unknown,
  allowed: T[],
  fallback: T,
  field: string,
): { value: T } | { error: string } {
  if (raw === undefined) return { value: fallback };
  if (typeof raw !== "string" || !allowed.includes(raw as T)) {
    return { error: `\`${field}\` must be one of ${allowed.join(" | ")}` };
  }
  return { value: raw as T };
}
