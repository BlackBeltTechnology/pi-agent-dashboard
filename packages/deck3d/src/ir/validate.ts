/**
 * IR validation.
 *
 *  1. JSON Schema (ajv) — unknown fields, wrong types, bad enums, out-of-range.
 *  2. Derived-data referential integrity — an edge/group/message pointing at a
 *     missing id is an ERROR (derived data is engine-generated, so it is a bug).
 *  3. Overrides referencing a vanished target is a WARNING (kept, inert).
 *  4. `meta.derivedHash` mismatch is a WARNING (edited outside `overrides`).
 */
import { readFileSync } from "node:fs";
import Ajv, { type ErrorObject } from "ajv";
import { computeDerivedHash } from "./hash.js";
import { findOrphanOverrides, orphanOverridePath } from "./merge.js";
import type { DeckIR } from "./types.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

function loadSchema(): object {
  const url = new URL("./schema.json", import.meta.url);
  return JSON.parse(readFileSync(url, "utf8")) as object;
}

const ajv = new Ajv({ allErrors: true, strict: false });
const validateSchema = ajv.compile(loadSchema());

const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const MAP_CONTAINERS = new Set(["slides", "nodes", "edges"]);

function unescapePointerSegment(seg: string): string {
  return seg.replace(/~1/g, "/").replace(/~0/g, "~");
}

/**
 * Render an ajv JSON pointer as the `overrides` grammar spelling an agent can
 * act on, e.g. `/overrides/slides/arch/camera/distance` →
 * `overrides.slides["arch"].camera.distance`.
 */
export function formatPath(instancePath: string): string {
  if (!instancePath) return "(root)";
  const segs = instancePath.split("/").slice(1).map(unescapePointerSegment);
  let out = "";
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const prev = segs[i - 1];
    if (i === 0) out = seg;
    else if (prev !== undefined && MAP_CONTAINERS.has(prev)) out += `["${seg}"]`;
    else if (IDENT.test(seg)) out += `.${seg}`;
    else out += `["${seg}"]`;
  }
  return out;
}

function humanMessage(e: ErrorObject): string {
  const p = e.params as Record<string, unknown>;
  switch (e.keyword) {
    case "type":
      return `expected ${String(p.type)}`;
    case "additionalProperties":
      return `unknown key '${String(p.additionalProperty)}'`;
    case "enum":
      return `expected one of ${JSON.stringify(p.allowedValues)}`;
    case "required":
      return `missing required key '${String(p.missingProperty)}'`;
    case "pattern":
      return `must match ${String(p.pattern)}`;
    case "minimum":
      return `must be >= ${String(p.limit)}`;
    case "maximum":
      return `must be <= ${String(p.limit)}`;
    case "exclusiveMinimum":
      return `must be > ${String(p.limit)}`;
    default:
      return e.message ?? e.keyword;
  }
}

/** Referential integrity inside DERIVED data (engine bugs → errors). */
function validateDerived(ir: DeckIR): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  ir.slides.forEach((slide, si) => {
    const d = slide.diagram;
    if (!d) return;
    const nodeIds = new Set((d.nodes ?? []).map((n) => n.id));
    (d.edges ?? []).forEach((edge, ei) => {
      if (!nodeIds.has(edge.from)) errors.push({ path: `slides[${si}].diagram.edges[${ei}].from`, message: `dangling edge source '${edge.from}'` });
      if (!nodeIds.has(edge.to)) errors.push({ path: `slides[${si}].diagram.edges[${ei}].to`, message: `dangling edge target '${edge.to}'` });
    });
    (d.groups ?? []).forEach((group, gi) => {
      for (const id of group.nodes) {
        if (!nodeIds.has(id)) errors.push({ path: `slides[${si}].diagram.groups[${gi}].nodes`, message: `dangling group member '${id}'` });
      }
    });
    const actorIds = new Set((d.actors ?? []).map((a) => a.id));
    (d.messages ?? []).forEach((msg, mi) => {
      if (!actorIds.has(msg.from)) errors.push({ path: `slides[${si}].diagram.messages[${mi}].from`, message: `dangling message sender '${msg.from}'` });
      if (!actorIds.has(msg.to)) errors.push({ path: `slides[${si}].diagram.messages[${mi}].to`, message: `dangling message receiver '${msg.to}'` });
    });
  });
  return errors;
}

export function validate(ir: unknown): ValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  if (!validateSchema(ir)) {
    for (const e of validateSchema.errors ?? []) {
      errors.push({ path: formatPath(e.instancePath), message: humanMessage(e) });
    }
    // A schema-invalid IR cannot be safely walked further.
    return { ok: false, errors, warnings };
  }

  const deck = ir as DeckIR;
  errors.push(...validateDerived(deck));

  for (const orphan of findOrphanOverrides(deck)) {
    warnings.push({ path: orphanOverridePath(orphan), message: "orphan override target no longer exists (kept, inert)" });
  }

  if (deck.meta.derivedHash && deck.meta.derivedHash !== computeDerivedHash(deck)) {
    warnings.push({
      path: "meta.derivedHash",
      message: "edited outside overrides — this change is lost on re-parse; edit `overrides` instead",
    });
  }

  return { ok: errors.length === 0, errors, warnings };
}

/** `error overrides.slides["arch"].camera.distance: expected number` */
export function formatIssue(severity: "error" | "warn", issue: ValidationIssue): string {
  return `${severity} ${issue.path}: ${issue.message}`;
}
