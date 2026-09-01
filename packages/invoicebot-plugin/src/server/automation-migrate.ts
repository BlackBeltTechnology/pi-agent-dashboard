/**
 * Migrate a DEPLOYED intake automation onto the work-source fan-out contract
 * (decision D-YAML).
 *
 * The problem: the intake `automation.yaml` is authored by the invoice engine
 * and, once written, is byte-preserved forever (the engine only writes it when
 * absent). Its legacy shape drives fan-out from a payload discriminator:
 *
 *     on:     { kind: schedule, cron: "*\/2 * * * *" }
 *     action: { payload: { scope: per-invoice, inputs/env using ${invoice_id} } }
 *
 * The automation plugin no longer understands either token: fan-out is declared
 * by the TRIGGER (`on: { kind: schedule.batch, source }`) and the per-child value
 * arrives as `${{trigger}}`. So a deployed workspace would silently stop draining
 * — the automation would parse as a plain schedule and fire ONE run carrying a
 * literal `${invoice_id}`.
 *
 * WHO CALLS WHOM. The engine owns the emitted YAML shape and ships its OWN
 * one-way migrator (`engine.migrateIntakeAutomation(cwd)`), which the host
 * PREFERS — see `index.ts`. But the engine emits automation YAML and never READS
 * a deployed one at fire time (the host's automation plugin does), so
 * migrate-on-READ is only implementable here. The host therefore owns WHEN the
 * migration runs; the engine owns the rewrite.
 *
 * This implementation is the FALLBACK for that rewrite, used when the engine
 * binding cannot do it (the fixture binding, i.e. CI / a worktree / release-cut,
 * where the `file:` sibling is absent). It targets the EXACT shape the engine
 * emits — `inputs.work_item: "${{trigger}}"`, `on.source: invoicebot-queued`, no
 * `payload.scope` — because two migrators emitting different shapes is precisely
 * the drift this relocation exists to end.
 *
 * Why not the other D-YAML routes: a migrator inside the automation plugin would
 * put the words "per-invoice"/"invoice_id" back into a generic, domain-free
 * package, and dual-shape support in the generic schema would keep the retired
 * discriminator alive forever. (The FLOW does keep dual-shape support for its own
 * inputs, so an un-migrated deployment keeps working meanwhile — nothing breaks
 * while a workspace waits for its first touch.)
 *
 * The rewrite is in-place via the `yaml` Document API (comments and every other
 * field survive), atomic (tmp + rename), re-validated before the write, and
 * IDEMPOTENT: an already-migrated file is left byte-identical.
 *
 * See change: relocate-fanout-to-work-source.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseDocument, parse as parseYaml } from "yaml";

/** Work-source id the migrated automation names in `on.source`. */
export const QUEUED_INVOICE_SOURCE_ID = "invoicebot-queued";

/** The intake drain automation's name (engine-authored). */
export const INTAKE_AUTOMATION_NAME = "invoicebot-intake";

/** Retired per-invoice payload discriminator. */
const LEGACY_SCOPE = "per-invoice";
/** Retired single-brace token; `${{trigger}}` replaces it. */
const LEGACY_TOKEN_RE = /\$\{invoice_id\}/g;
/** Non-global twin for assertions (a /g regex's `test` is stateful). */
const HAS_LEGACY_TOKEN = /\$\{invoice_id\}/;
/** The only substitution token the automation plugin resolves. */
const TRIGGER_TOKEN = "${{trigger}}";
/** Retired per-invoice flow input key. */
const LEGACY_INPUT_KEY = "invoice_id";
/** The leased-item input key the flow consumes (engine's emitted shape). */
const WORK_ITEM_KEY = "work_item";

export interface MigrateResult {
  /** True when this call rewrote the file. */
  migrated: boolean;
  /** Absolute path considered. */
  path: string;
  /** Why no rewrite happened (absent / already migrated / not the legacy shape). */
  reason?: string;
}

/** Recursively rewrite `${invoice_id}` → `${{trigger}}` in a parsed value. */
function retokenize(value: unknown): unknown {
  if (typeof value === "string") return value.replace(LEGACY_TOKEN_RE, TRIGGER_TOKEN);
  if (Array.isArray(value)) return value.map(retokenize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, retokenize(v)]));
  }
  return value;
}

/**
 * Migrate `<cwd>/.pi/automation/<name>/automation.yaml` to the `schedule.batch`
 * work-source shape when it still carries the legacy per-invoice payload.
 *
 * Never throws for an absent/unreadable/already-migrated file — this runs on a
 * request touch path, so a migration problem must degrade, not 500. A genuine
 * write failure propagates (the caller logs it).
 */
export function migrateIntakeAutomation(
  cwd: string,
  name: string = INTAKE_AUTOMATION_NAME,
  sourceId: string = QUEUED_INVOICE_SOURCE_ID,
): MigrateResult {
  const yamlPath = join(cwd, ".pi", "automation", name, "automation.yaml");
  if (!existsSync(yamlPath)) return { migrated: false, path: yamlPath, reason: "absent" };

  let raw: string;
  try {
    raw = readFileSync(yamlPath, "utf8");
  } catch {
    return { migrated: false, path: yamlPath, reason: "unreadable" };
  }

  let parsed: Record<string, unknown> | null;
  try {
    parsed = parseYaml(raw) as Record<string, unknown> | null;
  } catch {
    return { migrated: false, path: yamlPath, reason: "unparseable" };
  }
  if (!parsed || typeof parsed !== "object") return { migrated: false, path: yamlPath, reason: "unparseable" };

  const on = parsed.on as Record<string, unknown> | undefined;
  const action = parsed.action as Record<string, unknown> | undefined;
  const payload = action?.payload as Record<string, unknown> | undefined;
  if (on?.kind === "schedule.batch") return { migrated: false, path: yamlPath, reason: "already migrated" };
  if (payload?.scope !== LEGACY_SCOPE) return { migrated: false, path: yamlPath, reason: "not the legacy shape" };

  const doc = parseDocument(raw);
  doc.setIn(["on", "kind"], "schedule.batch");
  doc.setIn(["on", "source"], sourceId);
  doc.deleteIn(["action", "payload", "scope"]);
  // Re-token the authorization-bearing `env` block in place (keys unchanged).
  const legacyEnv = payload?.env;
  if (legacyEnv && typeof legacyEnv === "object") {
    doc.setIn(["action", "payload", "env"], retokenize(legacyEnv));
  }
  // Flow `inputs`: re-token AND rename the retired per-invoice key to the
  // leased-item key the flow now consumes, matching the engine's own migrator.
  // Built as one object and set once — a `setIn` of a plain object replaces the
  // YAML node, so a later `deleteIn` into it would have nothing to navigate.
  const legacyInputs = payload?.inputs as Record<string, unknown> | undefined;
  if (legacyInputs && typeof legacyInputs === "object") {
    const nextInputs: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(legacyInputs)) {
      const key = k === LEGACY_INPUT_KEY ? WORK_ITEM_KEY : k;
      nextInputs[key] = retokenize(v);
    }
    doc.setIn(["action", "payload", "inputs"], nextInputs);
  }

  const out = String(doc);

  // Re-validate BEFORE replacing the file: the trigger must be the batch shape
  // with a source, the retired discriminator gone, no legacy token left, and the
  // cron + env keys preserved.
  const after = parseYaml(out) as Record<string, unknown> | null;
  const afterOn = after?.on as Record<string, unknown> | undefined;
  const afterPayload = (after?.action as Record<string, unknown> | undefined)?.payload as
    | Record<string, unknown>
    | undefined;
  const envBefore = Object.keys((payload?.env as Record<string, unknown> | undefined) ?? {});
  const envAfter = Object.keys((afterPayload?.env as Record<string, unknown> | undefined) ?? {});
  const afterInputs = afterPayload?.inputs as Record<string, unknown> | undefined;
  const valid =
    afterOn?.kind === "schedule.batch" &&
    afterOn?.source === sourceId &&
    afterOn?.cron === on?.cron &&
    afterPayload?.scope === undefined &&
    (legacyInputs === undefined ||
      !Object.hasOwn(legacyInputs, LEGACY_INPUT_KEY) ||
      afterInputs?.[WORK_ITEM_KEY] === TRIGGER_TOKEN) &&
    !HAS_LEGACY_TOKEN.test(out) &&
    envBefore.length === envAfter.length &&
    envBefore.every((k) => envAfter.includes(k));
  if (!valid) throw new Error(`intake automation migration re-validation failed for ${yamlPath}`);

  const tmp = `${yamlPath}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, yamlPath);
  return { migrated: true, path: yamlPath };
}
