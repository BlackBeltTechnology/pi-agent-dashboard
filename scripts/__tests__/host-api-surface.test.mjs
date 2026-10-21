/**
 * Host API surface snapshot gate (`scripts/host-api-surface.mjs`), test-plan #E29.
 *
 * The bump rule is a pure function of two snapshots, so each scenario edits a copy
 * of the committed snapshot and asks `checkBump`. The real-tree tests prove the
 * committed snapshot is current and that the CLI exits non-zero when it is stale.
 *
 * See change: decouple-plugins-from-core.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PLUGIN_HOST_API_VERSION } from "../../packages/shared/src/dashboard-plugin/host-api.ts";
import { HOST_IMPORT_MAP_SPECIFIERS } from "../../packages/shared/src/dashboard-plugin/host-import-map.ts";
import { bumpKind, checkBump, computeSurface, diffSurface, IMPORT_MAP_SPECIFIERS, parseHostDesignTokens } from "../host-api-surface.mjs";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..");
const SNAPSHOT = path.join(REPO_ROOT, "packages/dashboard-plugin-runtime/host-api-surface.json");
const SCRIPT = path.join(REPO_ROOT, "scripts/host-api-surface.mjs");
const snapshot = () => JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));

/** A copy of the committed snapshot mutated by `mutate`, stamped with `version`. */
function variant(mutate, version) {
  const s = snapshot();
  mutate(s);
  s.version = version;
  return s;
}
const [MAJOR, MINOR, PATCH] = snapshot().version.split(".").map(Number);
const BUMPS = { none: `${MAJOR}.${MINOR}.${PATCH}`, patch: `${MAJOR}.${MINOR}.${PATCH + 1}`, minor: `${MAJOR}.${MINOR + 1}.0`, major: `${MAJOR + 1}.0.0` };

const MUTATIONS = {
  "delete useLanguage": { mutate: (s) => (s.publicExports = s.publicExports.filter((n) => n !== "useLanguage")), needs: "major", names: "useLanguage" },
  "add an export": { mutate: (s) => s.publicExports.push("useBrandNewThing"), needs: "minor", names: "useBrandNewThing" },
  'change UiPrimitiveMap["ui:confirm-dialog"] props': {
    mutate: (s) => (s.uiPrimitiveProps["ui:confirm-dialog"] += "; extra"),
    needs: "minor",
    names: "ui:confirm-dialog",
  },
  "rename --bg-surface": {
    mutate: (s) => (s.cssCustomProperties = s.cssCustomProperties.map((n) => (n === "--bg-surface" ? "--bg-panel" : n))),
    needs: "major",
    names: "--bg-surface",
  },
  "rename --accent-orange-text": {
    mutate: (s) => (s.cssCustomProperties = s.cssCustomProperties.map((n) => (n === "--accent-orange-text" ? "--accent-amber-text" : n))),
    needs: "major",
    names: "--accent-orange-text",
  },
};
const RANK = { none: 0, patch: 1, minor: 2, major: 3 };

describe("host API surface bump rule (#E29)", () => {
  for (const [label, { mutate, needs, names }] of Object.entries(MUTATIONS)) {
    describe(label, () => {
      for (const [bump, version] of Object.entries(BUMPS)) {
        const ok = RANK[bump] >= RANK[needs];
        it(`${bump} bump → ${ok ? "passes" : "fails naming the entry"}`, () => {
          const lines = checkBump(snapshot(), variant(mutate, version));
          if (ok) expect(lines).toEqual([]);
          else expect(lines.join("\n")).toContain(names);
        });
      }
    });
  }

  it("an internal CSS variable is not recorded, so renaming it passes at any bump", () => {
    const css = fs.readFileSync(path.join(REPO_ROOT, "packages/client/src/index.css"), "utf8");
    const recorded = new Set(snapshot().cssCustomProperties);
    const internal = [...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]).find((t) => !recorded.has(t));
    expect(internal, "index.css declares at least one non-public property").toBeTruthy();
    // Renaming it changes nothing the snapshot records, so the surface is identical.
    expect(diffSurface(snapshot(), snapshot())).toEqual({ removed: [], added: [], changed: [] });
    for (const version of Object.values(BUMPS)) expect(checkBump(snapshot(), variant(() => {}, version))).toEqual([]);
  });

  it("a version that goes backwards fails", () => {
    expect(checkBump(variant(() => {}, "1.2.0"), variant(() => {}, "1.1.0")).join("\n")).toMatch(/backwards/);
  });

  it("bumpKind classifies versions", () => {
    expect(["1.0.0", "1.0.1", "1.1.0", "2.0.0", "0.9.0"].map((v) => bumpKind("1.0.0", v))).toEqual(["none", "patch", "minor", "major", "down"]);
  });

  it("diffSurface separates removed / added / changed", () => {
    const next = variant((s) => {
      s.publicExports = s.publicExports.filter((n) => n !== "useT").concat("zzNew");
      s.hostFxClasses.ring = "card-ring-v2";
    }, "2.0.0");
    const d = diffSurface(snapshot(), next);
    expect(d.removed).toContainEqual({ section: "public export", name: "useT" });
    expect(d.added).toContainEqual({ section: "public export", name: "zzNew" });
    expect(d.changed).toContainEqual({ section: "host FX class", name: "ring" });
  });
});

describe("committed snapshot", () => {
  it("is current vs source and stamped with PLUGIN_HOST_API_VERSION", () => {
    expect(computeSurface(REPO_ROOT)).toEqual(snapshot());
    expect(snapshot().version).toBe(PLUGIN_HOST_API_VERSION);
  });

  it("records the 6 expanded accent-text tokens and no literal <hue>", () => {
    const tokens = snapshot().cssCustomProperties;
    for (const hue of ["purple", "blue", "green", "orange", "red", "yellow"]) expect(tokens).toContain(`--accent-${hue}-text`);
    expect(JSON.stringify(snapshot())).not.toContain("<hue>");
    expect(tokens.filter((t) => /[<>{}]/.test(t))).toEqual([]);
  });

  it("keeps PLUGIN_HOST_API_VERSION / satisfiesHostApi out of ./sdk and puts them in public", () => {
    const s = snapshot();
    for (const n of ["PLUGIN_HOST_API_VERSION", "satisfiesHostApi"]) {
      expect(s.sdkExports).not.toContain(n);
      expect(s.publicExports).toContain(n);
    }
    expect(s.sdkExports).toContain("satisfiesHostApiRange");
  });

  it("records the import-map specifiers (task 7.1 appended embedded-app, app-kit/react, wouter)", () => {
    expect(snapshot().importMapSpecifiers).toEqual([
      "react",
      "react/jsx-runtime",
      "react-dom",
      "react-dom/client",
      "@blackbelt-technology/dashboard-plugin-runtime",
      "@blackbelt-technology/dashboard-plugin-runtime/embedded-app",
      "@blackbelt-technology/pi-dashboard-app-kit/react",
      "wouter",
    ]);
  });

  it("the CLI passes on the real tree", () => {
    const r = spawnSync(process.execPath, [SCRIPT, "--check"], { encoding: "utf8" });
    expect(r.status, r.stderr).toBe(0);
  });
});

describe("parseHostDesignTokens", () => {
  it("expands the accent-text pattern, records concrete tokens, ignores tabulated patterns", () => {
    const md = "Use `--accent-<hue>-text` and `var(--bg-surface)`; never `--accent-<hue>`; `--severity-<level>-{bg,fg,border}` e.g. `--severity-error-bg`.";
    const t = parseHostDesignTokens(md);
    expect(t).toContain("--accent-yellow-text");
    expect(t).toContain("--bg-surface");
    expect(t).toContain("--severity-error-bg");
    expect(t.filter((x) => /[<>{}]/.test(x))).toEqual([]);
  });

  it("fails on a code span holding an unexpanded pattern it does not know", () => {
    expect(() => parseHostDesignTokens("Use `--tone-<name>-fg` for chips.")).toThrow(/unexpanded pattern/);
  });
});

describe("import-map specifiers: one list for the server and the surface snapshot (decouple 6.4)", () => {
  it("the surface's pinned specifiers equal the server's host import map keys, in order", () => {
    expect([...IMPORT_MAP_SPECIFIERS]).toEqual([...HOST_IMPORT_MAP_SPECIFIERS]);
  });
});
