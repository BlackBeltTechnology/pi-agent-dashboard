/**
 * The client bundle must never VALUE-import a shared module that pulls a
 * `node:` built-in.
 *
 * This exists because of a real defect, and because of HOW it presented. A
 * single value import of `pi-dashboard-shared/config.js` from `SettingsPanel`
 * (for `DEFAULT_MEMORY_LIMITS`) dragged `node:fs` / `node:os` / `node:path`
 * into the browser bundle. The whole SPA then died at boot with
 * `uv.homedir is not a function` — a BLANK PAGE, with:
 *
 *   - `tsc --noEmit` green,
 *   - the entire vitest suite green (15k+ tests, jsdom has the shims),
 *   - and no build error at all.
 *
 * Only the docker browser harness caught it, and only because every spec's
 * `gotoDashboard` timed out. Nothing cheaper than a full container run could
 * see it, which is exactly the gap this test closes.
 *
 * `import type` is fine and deliberately allowed: type imports are erased, so
 * `import type { KnownServer } from ".../config.js"` never reaches the bundle.
 * The distinction between a type import and a value import is the whole rule.
 *
 * Anything the client needs as a VALUE belongs in a browser-safe shared module
 * (see `packages/shared/src/memory-limits.ts`).
 *
 * See change: fix-lazy-history-backfill-ux (D7).
 */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const CLIENT_SRC = path.resolve(__dirname, "..");
const SHARED_SRC = path.resolve(__dirname, "../../../shared/src");
const SPECIFIER = "@blackbelt-technology/pi-dashboard-shared/";

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "dist") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/**
 * Shared modules that reach a `node:` built-in, directly or through another
 * shared module. Computed rather than hardcoded, so a shared module that GAINS
 * a `node:` import is covered without anyone remembering to update a list.
 */
function nodeOnlySharedModules(): Set<string> {
  const files = walk(SHARED_SRC).filter((f) => !f.includes(`${path.sep}__tests__${path.sep}`));
  const sources = new Map<string, string>();
  for (const f of files) sources.set(f, fs.readFileSync(f, "utf8"));

  const direct = new Set<string>();
  for (const [f, src] of sources) {
    if (/from\s+"node:/.test(src)) direct.add(f);
  }
  // Propagate through relative re-exports/imports until the set stops growing.
  let grew = true;
  while (grew) {
    grew = false;
    for (const [f, src] of sources) {
      if (direct.has(f)) continue;
      for (const m of src.matchAll(/(?<!\btype\s)from\s+"(\.[^"]+)"/g)) {
        const resolved = path.resolve(path.dirname(f), m[1].replace(/\.js$/, ".ts"));
        if (direct.has(resolved)) {
          direct.add(f);
          grew = true;
          break;
        }
      }
    }
  }
  // Reduce to the specifier suffix a client import would use, e.g. "config".
  return new Set([...direct].map((f) => path.relative(SHARED_SRC, f).replace(/\.tsx?$/, "")));
}

/** Every `from "@blackbelt-technology/pi-dashboard-shared/..."` VALUE import. */
function valueImportsOfShared(src: string): string[] {
  const out: string[] = [];
  // `import ... from "<spec>"` — captures the clause so `import type` can be
  // excluded. Inline `import { type X }` is a value import statement and is
  // treated as one, which is correct: it still emits a runtime import unless
  // every binding is a type, and being strict here is the safe direction.
  for (const m of src.matchAll(/import\s+([\s\S]*?)\s*from\s+"([^"]+)"/g)) {
    const clause = m[1];
    const spec = m[2];
    if (!spec.startsWith(SPECIFIER)) continue;
    if (/^type\b/.test(clause.trim())) continue; // `import type { ... }` — erased
    // A clause where EVERY binding is `type`-qualified is also fully erased.
    const named = clause.match(/^\{([\s\S]*)\}$/);
    if (named) {
      const bindings = named[1].split(",").map((b) => b.trim()).filter(Boolean);
      if (bindings.length > 0 && bindings.every((b) => b.startsWith("type "))) continue;
    }
    out.push(spec.slice(SPECIFIER.length).replace(/\.js$/, ""));
  }
  return out;
}

describe("client bundle purity — no node-only shared modules", () => {
  it("the detector actually finds node-only shared modules (fails closed)", () => {
    const nodeOnly = nodeOnlySharedModules();
    // `config` is the canonical one: it imports node:fs/os/path at module scope.
    expect(nodeOnly.has("config")).toBe(true);
    // ...and the browser-safe replacement is NOT flagged, or the rule would be
    // unsatisfiable and everyone would learn to ignore it.
    expect(nodeOnly.has("memory-limits")).toBe(false);
  });

  it("no client source value-imports a shared module that reaches node:", () => {
    const nodeOnly = nodeOnlySharedModules();
    const offenders: string[] = [];
    for (const file of walk(CLIENT_SRC)) {
      const src = fs.readFileSync(file, "utf8");
      for (const mod of valueImportsOfShared(src)) {
        if (nodeOnly.has(mod)) {
          offenders.push(`${path.relative(CLIENT_SRC, file)} → ${mod}`);
        }
      }
    }
    expect(
      offenders,
      "value-importing these from the client puts node: built-ins in the browser bundle; " +
        "the SPA then dies at boot with `uv.homedir is not a function`. " +
        "Use `import type`, or move the value into a browser-safe shared module.",
    ).toEqual([]);
  });
});
