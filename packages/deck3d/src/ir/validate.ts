/**
 * IR validation.
 *
 *  1. JSON Schema (ajv) — unknown fields, wrong types, bad enums, out-of-range.
 *  2. Derived-data referential integrity — an edge/group/message pointing at a
 *     missing id is an ERROR (derived data is engine-generated, so it is a bug).
 *  3. Overrides referencing a vanished target is a WARNING (kept, inert).
 *  4. `meta.derivedHash` mismatch is a WARNING (edited outside `overrides`).
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import Ajv, { type ErrorObject } from "ajv";
import { localRefs, resolveLocalEffect } from "../fx/local.js";
import { isPersistentFx } from "../fx/persistent.js";
import { realInside } from "../util/confine.js";
import { pkgRoot } from "../util/paths.js";
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
  // Package-root-relative, not `import.meta.url`: the bundled `dist/cli.js`
  // would otherwise look for `dist/schema.json`.
  const path = join(pkgRoot(), "src", "ir", "schema.json");
  return JSON.parse(readFileSync(path, "utf8")) as object;
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
    // An all-digit segment under a non-map parent is an array index: `values[1]`.
    else if (/^\d+$/.test(seg)) out += `[${seg}]`;
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

export interface ValidateOptions {
  /** Cached prop byte counts keyed `<source>-<id>` (from `.deck3d/props/`). */
  propBytes?: Record<string, number>;
  /** Directory holding the deck's `fx/`. Absent ⇒ `local:` referents are not resolved. */
  deckDir?: string;
}

/** Resolve every `local:` reference against `fx/` beside the deck (design D1). */
function validateLocalEffects(deck: DeckIR, deckDir: string): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const { ref, path } of localRefs(deck.overrides)) {
    for (const issue of resolveLocalEffect(ref, deckDir).issues) {
      errors.push({ path: `${path}${issue.suffix}`, message: issue.message });
    }
  }
  return errors;
}

/**
 * Resolve every `overrides.assets` entry against the deck directory (spec
 * deck3d-slide-layers "Deck asset bundle"): unique id, `font-` prefix iff
 * a font, path inside the deck directory, file present, sha256 pinned.
 */
export function validateAssets(deck: DeckIR, deckDir: string): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const seen = new Set<string>();
  const root = resolve(deckDir);
  (deck.overrides.assets ?? []).forEach((a, i) => {
    const at = `overrides.assets[${i}]`;
    if (seen.has(a.id)) errors.push({ path: `${at}.id`, message: `duplicate asset id '${a.id}'` });
    seen.add(a.id);
    const font = a.mime === "font/ttf" || a.mime === "font/otf";
    if (font && !a.id.startsWith("font-")) errors.push({ path: `${at}.id`, message: `font asset id '${a.id}' must start with 'font-'` });
    if (!font && a.id.startsWith("font-")) errors.push({ path: `${at}.id`, message: `'font-' ids are reserved for font assets (mime is ${a.mime})` });
    const file = resolve(root, a.path);
    const rel = relative(root, file);
    if (isAbsolute(a.path) || rel.startsWith("..") || isAbsolute(rel)) {
      errors.push({ path: `${at}.path`, message: `'${a.path}' is outside the deck directory` });
      return;
    }
    if (!existsSync(file) || !statSync(file).isFile()) {
      errors.push({ path: `${at}.path`, message: `missing file ${a.path}` });
      return;
    }
    // The spelling is inside; the REAL path (symlinks followed) must be too.
    if (!realInside(root, file)) {
      errors.push({ path: `${at}.path`, message: `'${a.path}' resolves outside the deck directory (symlink)` });
      return;
    }
    const sha = createHash("sha256").update(readFileSync(file)).digest("hex");
    if (sha !== a.sha256) errors.push({ path: `${at}.sha256`, message: `${a.path} has sha256 ${sha}, pinned ${a.sha256} (re-pin after editing the file)` });
  });
  return errors;
}

/** A persistent card anywhere but deck-scope `overrides.effects` is an error. */
function validatePersistentScope(deck: DeckIR): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  for (const [id, slide] of Object.entries(deck.overrides.slides ?? {})) {
    (slide.effects ?? []).forEach((ref, i) => {
      if (isPersistentFx(ref.id)) {
        errors.push({ path: `overrides.slides["${id}"].effects[${i}]`, message: `'${ref.id}' is persistent: deck-scope only (list it in overrides.effects)` });
      }
    });
  }
  return errors;
}

const PROP_COUNT_BUDGET = 5;
const PROP_BYTES_BUDGET = 10 * 1024 * 1024;

/** Prop warnings: dangling `node:<id>` role, count budget, total byte budget. */
function validateProps(deck: DeckIR, opts: ValidateOptions): ValidationIssue[] {
  const warnings: ValidationIssue[] = [];
  const props = deck.overrides.props ?? [];
  props.forEach((prop, i) => {
    if (!prop.role.startsWith("node:")) return;
    const nodeId = prop.role.slice("node:".length);
    const slide = deck.slides.find((s) => s.id === prop.slide);
    const exists = (slide?.diagram.nodes ?? []).some((n) => n.id === nodeId);
    if (!exists) {
      warnings.push({ path: `overrides.props[${i}].role`, message: `prop '${prop.id}' targets missing node '${nodeId}' on slide '${prop.slide}' (kept, inert)` });
    }
  });
  if (props.length > PROP_COUNT_BUDGET) {
    warnings.push({ path: "overrides.props", message: `${props.length} props exceed the budget of ${PROP_COUNT_BUDGET}` });
  }
  const bytes = props.reduce((total, p) => total + (opts.propBytes?.[`${p.source}-${p.id}`] ?? 0), 0);
  if (bytes > PROP_BYTES_BUDGET) {
    warnings.push({ path: "overrides.props", message: `${bytes} bytes exceed the budget of ${PROP_BYTES_BUDGET}` });
  }
  return warnings;
}

/**
 * Camera-path coherence the schema cannot express: keys strictly ordered, and
 * `cameraPath` ⇔ the slide's RESOLVED transition is `path` (own > cycle > default).
 */
function validateCameraPaths(deck: DeckIR): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const fallback = deck.overrides.deck?.transition ?? deck.defaults.transition;
  const cycle = deck.overrides.deck?.transitionCycle ?? deck.defaults.transitionCycle;
  deck.slides.forEach((slide, i) => {
    const ov = deck.overrides.slides?.[slide.id];
    const at = `overrides.slides["${slide.id}"]`;
    const kind = ov?.transition ?? (cycle?.length ? cycle[i % cycle.length] : (fallback ?? "dolly"));
    const keys = ov?.cameraPath?.keys ?? [];
    for (let k = 1; k < keys.length; k++) {
      if (!(keys[k].t > keys[k - 1].t)) errors.push({ path: `${at}.cameraPath.keys[${k}].t`, message: `must be greater than keys[${k - 1}].t (${keys[k - 1].t})` });
    }
    if (ov?.cameraPath && kind !== "path") errors.push({ path: `${at}.cameraPath`, message: `ignored unless the slide's transition is "path" (resolved: "${kind}")` });
    if (!ov?.cameraPath && kind === "path") errors.push({ path: `${at}.transition`, message: `"path" needs overrides.slides["${slide.id}"].cameraPath` });
  });
  return errors;
}

/** Validates an overrides-grammar fragment (a `style.json` variant) against the IR schema. */
const validateFragmentSchema = ajv.compile({ definitions: (loadSchema() as { definitions: object }).definitions, $ref: "#/definitions/overrides" });

export function validateOverridesFragment(fragment: unknown): ValidationIssue[] {
  if (validateFragmentSchema(fragment)) return [];
  return (validateFragmentSchema.errors ?? []).map((e) => ({ path: formatPath(e.instancePath).replace(/^\(root\)$/, "(root)"), message: humanMessage(e) }));
}

export function validate(ir: unknown, opts: ValidateOptions = {}): ValidationResult {
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
  errors.push(...validateCameraPaths(deck));
  errors.push(...validatePersistentScope(deck));
  if (opts.deckDir !== undefined) {
    errors.push(...validateLocalEffects(deck, opts.deckDir));
    errors.push(...validateAssets(deck, opts.deckDir));
  }
  warnings.push(...validateProps(deck, opts));

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
