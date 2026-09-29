/**
 * Local (per-deck) effects — design D1.
 *
 * An agent may author an effect for one deck as `fx/<name>.js` + a sibling
 * `fx/<name>.meta.json` card beside `deck.json`. It reaches the render only
 * through a `sha256` pinned in `overrides`, exactly like a fetched prop: the
 * bytes are the contract, so `render` stays byte-deterministic.
 *
 * Everything here is a resolver + linter. Instantiation (shadowed globals,
 * try/catch) happens in the runtime; `check` measures the result.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import Ajv from "ajv";
import type { EffectRef } from "../ir/types.js";
import { pkgRoot } from "../util/paths.js";
import type { FxCard } from "./types.js";

export const LOCAL_PREFIX = "local:";
export const LOCAL_NAME_RE = /^[a-z][a-z0-9-]{0,63}$/;
export const LOCAL_MAX_BYTES = 64 * 1024;
/** `post`/`material`/`light`/`edge`/`transition` need hooks the handle grammar lacks. */
export const LOCAL_KINDS = ["background", "motion"] as const;

/** Identifiers a local module may not name, even unreachable (case-sensitive). */
const BANNED = ["import", "require", "eval", "Function"] as const;

export function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_PREFIX);
}

export function localName(id: string): string {
  return id.slice(LOCAL_PREFIX.length);
}

export interface LocalIssue {
  /** Appended to the caller's override path, e.g. `.sha256`. */
  suffix: string;
  message: string;
}

export interface LocalEffect {
  name: string;
  card: FxCard;
  src: string;
}

let compiledCard: ReturnType<Ajv["compile"]> | undefined;
let cardAjv: Ajv | undefined;

function validateCard(card: unknown): { ok: boolean; detail: string } {
  if (!compiledCard) {
    const schema = JSON.parse(readFileSync(join(pkgRoot(), "src", "fx", "meta.schema.json"), "utf8"));
    cardAjv = new Ajv({ allErrors: true });
    compiledCard = cardAjv.compile(schema);
  }
  const ok = compiledCard(card) as boolean;
  return { ok, detail: ok ? "" : (cardAjv?.errorsText(compiledCard.errors) ?? "") };
}

/** Source with string literals and comments blanked, for identifier linting. */
export function stripStringsAndComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) i += src[i] === "\\" ? 2 : 1;
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/**
 * Module shape (D1): after leading comments/whitespace the first statement is
 * `export default function (ctx, params)`, and there is no other `export`.
 * Anchoring on the prefix is what lets `render` replace it without searching.
 */
export function lintModule(src: string): string | undefined {
  const stripped = stripStringsAndComments(src);
  const body = stripped.replace(/^\s+/, "");
  if (!/^export\s+default\s+function\b/.test(body)) {
    return "module must start with `export default function (ctx, params)` (after optional comments)";
  }
  const exports = stripped.match(/\bexport\b/g) ?? [];
  if (exports.length > 1) return "module must have a single default export";
  for (const ident of BANNED) {
    if (new RegExp(`\\b${ident}\\b`).test(body.replace(/^export\s+default\s+/, ""))) {
      return `module must not use \`${ident}\``;
    }
  }
  return undefined;
}

/** `export default function` → `return function`, so the source can be `new Function`-ed. */
export function toFactorySource(src: string): string {
  return src.replace(/export\s+default\s+function/, "return function");
}

export function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface ResolveResult {
  effect?: LocalEffect;
  issues: LocalIssue[];
}

/**
 * Resolve one `local:` reference against `fx/` in `deckDir`. Every failure is
 * reported against the reference, never thrown, so `validate` can list them all.
 */
export function resolveLocalEffect(ref: EffectRef, deckDir: string): ResolveResult {
  const name = localName(ref.id);
  const issues: LocalIssue[] = [];
  if (!LOCAL_NAME_RE.test(name)) {
    return { issues: [{ suffix: ".id", message: `local effect name must match ${LOCAL_NAME_RE.source}` }] };
  }

  const rel = `fx/${name}.js`;
  const modulePath = join(deckDir, "fx", `${name}.js`);
  const cardPath = join(deckDir, "fx", `${name}.meta.json`);
  if (!existsSync(modulePath)) return { issues: [{ suffix: "", message: `missing local effect file ${rel}` }] };

  const bytes = statSync(modulePath).size;
  if (bytes > LOCAL_MAX_BYTES) {
    issues.push({ suffix: "", message: `${rel} is ${bytes} bytes, over the 64 KiB local effect cap` });
  }

  const raw = readFileSync(modulePath);
  const actual = sha256(raw);
  // Case-sensitive: an uppercase digest is a mismatch, not a spelling variant.
  if (ref.sha256 !== actual) {
    issues.push({ suffix: ".sha256", message: `sha256 does not match ${rel} (expected ${actual})` });
  }

  const lint = lintModule(raw.toString("utf8"));
  if (lint) issues.push({ suffix: "", message: `${rel}: ${lint}` });

  if (!existsSync(cardPath)) {
    issues.push({ suffix: "", message: `missing local effect card fx/${name}.meta.json` });
    return { issues };
  }

  let card: FxCard;
  try {
    card = JSON.parse(readFileSync(cardPath, "utf8")) as FxCard;
  } catch (err) {
    issues.push({ suffix: "", message: `fx/${name}.meta.json: invalid JSON (${(err as Error).message})` });
    return { issues };
  }

  const verdict = validateCard(card);
  if (!verdict.ok) {
    issues.push({ suffix: "", message: `fx/${name}.meta.json: invalid card (${verdict.detail})` });
  } else if (!(LOCAL_KINDS as readonly string[]).includes(card.kind)) {
    issues.push({
      suffix: "",
      message: `fx/${name}.meta.json: kind '${card.kind}' is not allowed for a local effect (one of ${LOCAL_KINDS.join(", ")})`,
    });
  }

  if (issues.length) return { issues };
  return { effect: { name, card, src: raw.toString("utf8") }, issues };
}

/** Every `local:` reference in the IR, with the override path that named it. */
export function localRefs(overrides: {
  effects?: EffectRef[];
  slides?: Record<string, { effects?: EffectRef[] }>;
}): Array<{ ref: EffectRef; path: string }> {
  const out: Array<{ ref: EffectRef; path: string }> = [];
  (overrides.effects ?? []).forEach((ref, i) => {
    if (isLocalId(ref.id)) out.push({ ref, path: `overrides.effects[${i}]` });
  });
  for (const [slideId, slide] of Object.entries(overrides.slides ?? {})) {
    (slide.effects ?? []).forEach((ref, i) => {
      if (isLocalId(ref.id)) out.push({ ref, path: `overrides.slides["${slideId}"].effects[${i}]` });
    });
  }
  return out;
}
