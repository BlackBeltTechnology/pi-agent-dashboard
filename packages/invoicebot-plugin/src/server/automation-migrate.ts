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
 * The route chosen (of migrate-on-read / one-shot migrator / dual-shape):
 * MIGRATE-ON-READ, HERE, in the invoice plugin. Rationale:
 *   - it is the only route that also fixes YAML the UNCHANGED engine writes
 *     fresh tomorrow, so no engine-repo change is needed and no version skew
 *     between the two repos can leave a workspace un-drained;
 *   - a migrator inside the automation plugin would put the words
 *     "per-invoice"/"invoice_id" back into a generic, domain-free package —
 *     exactly the separation this relocation exists to establish;
 *   - dual-shape support would keep the retired discriminator alive in the
 *     generic schema forever.
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
  // Re-token every string under the payload (flow `inputs` AND the `env` block —
  // the env map is authorization-bearing, so its values must resolve too).
  for (const key of ["inputs", "env"]) {
    const sub = payload?.[key];
    if (sub && typeof sub === "object") doc.setIn(["action", "payload", key], retokenize(sub));
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
  const valid =
    afterOn?.kind === "schedule.batch" &&
    afterOn?.source === sourceId &&
    afterOn?.cron === on?.cron &&
    afterPayload?.scope === undefined &&
    !HAS_LEGACY_TOKEN.test(out) &&
    envBefore.length === envAfter.length &&
    envBefore.every((k) => envAfter.includes(k));
  if (!valid) throw new Error(`intake automation migration re-validation failed for ${yamlPath}`);

  const tmp = `${yamlPath}.tmp`;
  writeFileSync(tmp, out);
  renameSync(tmp, yamlPath);
  return { migrated: true, path: yamlPath };
}
