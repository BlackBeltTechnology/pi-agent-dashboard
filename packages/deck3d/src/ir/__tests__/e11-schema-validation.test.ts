/**
 * E11 (task 10.11) — ir: IR is schema-validated.
 *
 * `render` runs the schema first. A wrong-typed override leaf reports the JSON
 * path plus `expected number`; an unknown leaf key is named as unknown. Neither
 * case writes an `.html` file.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const BIN = new URL("../../../bin/deck3d", import.meta.url).pathname;

function runCli(args: string[], cwd: string) {
  return spawnSync(BIN, args, { cwd, encoding: "utf8" });
}

function clone(deck: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(deck)) as Record<string, unknown>;
}

describe("E11 IR schema validation before render", () => {
  it("rejects a wrong-typed camera distance with its JSON path, no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e11-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown>;

    const bad = clone(deck);
    (bad.overrides as Record<string, unknown>).slides = { intro: { camera: { distance: "far" } } };
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad, null, 2));

    const r = runCli(["render", "bad.json", "-o", "bad.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["intro"].camera.distance');
    expect(r.stderr).toContain("expected number");
    expect(existsSync(join(dir, "bad.html"))).toBe(false);
  });

  it("rejects an unknown node override key naming it as unknown, no html", () => {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e11-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);
    const deck = JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown>;

    const bad = clone(deck);
    (bad.overrides as Record<string, unknown>).nodes = { "intro/A": { colour: "#fff" } };
    writeFileSync(join(dir, "bad.json"), JSON.stringify(bad, null, 2));

    const r = runCli(["render", "bad.json", "-o", "bad.html"], dir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.nodes["intro/A"]');
    expect(r.stderr).toContain("unknown key");
    expect(r.stderr).toContain("colour");
    expect(existsSync(join(dir, "bad.html"))).toBe(false);
  });
});

/**
 * A one-slide deck parsed once, reused by the override-shape suites below.
 * Each case rewrites `overrides.slides.intro.diagram` and re-validates.
 */
function deckDir(prefix: string): { dir: string; deck: Record<string, unknown> } {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
  const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
  expect(parsed.status, parsed.stderr).toBe(0);
  return { dir, deck: JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown> };
}

function validateWithDiagram(diagram: unknown): { status: number | null; stderr: string } {
  const { dir, deck } = deckDir("deck3d-e16-");
  const next = clone(deck);
  (next.overrides as Record<string, unknown>).slides = { intro: { diagram } };
  writeFileSync(join(dir, "case.json"), JSON.stringify(next, null, 2));
  const r = runCli(["validate", "case.json"], dir);
  return { status: r.status, stderr: r.stderr };
}

// test-plan #E16 — an override may force a BUILT topology, never a markdown-derived one.
describe("E16 overrides diagram.kind admits built kinds only", () => {
  const BUILT = ["none", "brain", "loop", "swarm", "bars", "funnel", "timeline-rail", "globe", "orbit-cluster", "stack"];
  const DERIVED = ["flowchart", "sequence", "pie"];

  it.each(BUILT)("accepts diagram.kind = %s", (kind) => {
    const r = validateWithDiagram({ kind });
    expect(r.status, r.stderr).toBe(0);
  });

  it.each(DERIVED)("rejects diagram.kind = %s naming the path and the enum", (kind) => {
    const r = validateWithDiagram({ kind });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["intro"].diagram.kind');
    expect(r.stderr).toContain("expected one of");
    expect(r.stderr).toContain("orbit-cluster");
  });
});

// test-plan #E17 — series magnitudes are non-negative numbers; 0 is legal (a zero bar).
describe("E17 diagram.data.values bounds", () => {
  it.each([[[0]], [[0.0001]]])("accepts values %j", (values) => {
    const r = validateWithDiagram({ kind: "bars", data: { values } });
    expect(r.status, r.stderr).toBe(0);
  });

  it.each([
    [[-0.0001], 0, "must be >= 0"],
    [[3, -1], 1, "must be >= 0"],
    [["3"], 0, "expected number"],
  ])("rejects values %j at index %i", (values, index, message) => {
    const r = validateWithDiagram({ kind: "bars", data: { values } });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(`overrides.slides["intro"].diagram.data.values[${index}]`);
    expect(r.stderr).toContain(message as string);
  });
});

/**
 * test-plan #E1 — the `local:` id grammar. A name is a filename, so it must be
 * bounded and lower-case; a rejected id has to say which rule it broke.
 */
describe("E1 local effect id grammar", () => {
  const validateId = (id: string) => {
    const { dir, deck } = deckDir("deck3d-e1-");
    const next = clone(deck);
    (next.overrides as Record<string, unknown>).slides = {
      intro: { effects: [{ id, sha256: "0".repeat(64) }] },
    };
    writeFileSync(join(dir, "case.json"), JSON.stringify(next, null, 2));
    return runCli(["validate", "case.json"], dir);
  };

  // Accepted by the grammar; they then fail on the MISSING FILE, not the name.
  it.each([["local:a"], [`local:a${"b".repeat(63)}`]])("accepts the shape of %s", (id) => {
    const r = validateId(id);
    expect(r.stderr).not.toContain("must match");
    expect(r.stderr).toContain("missing local effect file");
  });

  it.each([[`local:a${"b".repeat(64)}`], ["local:9x"], ["local:A1"], ["local:a_b"]])("rejects %s naming the grammar", (id) => {
    const r = validateId(id);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("must match");
  });
});

/**
 * test-plan #E6 — module shape. The leading `export default function` is what
 * lets `render` rewrite the module without searching, so it is enforced, and
 * the banned-identifier lint must not fire on the `function` keyword.
 */
describe("E6 local module shape and lint", () => {
  function validateModule(src: string) {
    const { dir, deck } = deckDir("deck3d-e6-");
    mkdirSync(join(dir, "fx"), { recursive: true });
    writeFileSync(join(dir, "fx", "m.js"), src);
    writeFileSync(
      join(dir, "fx", "m.meta.json"),
      JSON.stringify({
        id: "m",
        kind: "background",
        tags: { mood: ["x"], content: ["x"] },
        cost: 1,
        modes: "both",
        params: {},
        conflicts: [],
        source: "local",
        licence: "MIT",
      }),
    );
    const next = clone(deck);
    (next.overrides as Record<string, unknown>).slides = {
      intro: { effects: [{ id: "local:m", sha256: createHash("sha256").update(src).digest("hex") }] },
    };
    writeFileSync(join(dir, "case.json"), JSON.stringify(next, null, 2));
    return runCli(["validate", "case.json"], dir);
  }

  const FACTORY = "export default function (ctx, params) { return { dispose: function () {} }; }\n";

  it("accepts a licence comment before the factory", () => {
    const r = validateModule(`/* MIT */\n// notes\n${FACTORY}`);
    expect(r.status, r.stderr).toBe(0);
  });

  it("accepts inner `function` declarations (lint is case-sensitive on Function)", () => {
    const r = validateModule("export default function (ctx) { function helper() { return 1; } return { dispose: helper }; }\n");
    expect(r.status, r.stderr).toBe(0);
  });

  it("accepts the word require inside a string literal", () => {
    const r = validateModule('export default function (ctx) { const s = "require"; return { dispose: function () { return s; } }; }\n');
    expect(r.status, r.stderr).toBe(0);
  });

  it("rejects a module that does not start with the factory", () => {
    const r = validateModule(`const x = 1;\n${FACTORY}`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("must start with");
  });

  it("rejects a second export", () => {
    const r = validateModule(`${FACTORY}export const helper = 1;\n`);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("single default export");
  });

  it.each([
    ["dynamic import", 'export default function (ctx) { return { dispose: function () { import("x"); } }; }\n', "import"],
    ["new Function", "export default function (ctx) { return { dispose: function () { new Function('a'); } }; }\n", "Function"],
  ])("rejects %s naming the identifier", (_name, src, ident) => {
    const r = validateModule(src);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain(ident);
  });
});

/**
 * test-plan #E23 — the referent checks. A `local:` reference is only meaningful
 * beside its `fx/`, so the same deck.json copied elsewhere must fail rather
 * than render without the effect.
 */
describe("E23 local referent resolution", () => {
  const SRC = "export default function (ctx, params) { return { dispose: function () {} }; }\n";
  const digest = createHash("sha256").update(SRC).digest("hex");

  function seed(opts: { module?: boolean; card?: boolean }) {
    const { dir, deck } = deckDir("deck3d-e23-");
    mkdirSync(join(dir, "fx"), { recursive: true });
    if (opts.module) writeFileSync(join(dir, "fx", "globe.js"), SRC);
    if (opts.card) {
      writeFileSync(
        join(dir, "fx", "globe.meta.json"),
        JSON.stringify({
          id: "globe",
          kind: "background",
          tags: { mood: ["x"], content: ["x"] },
          cost: 1,
          modes: "both",
          params: {},
          conflicts: [],
          source: "local",
          licence: "MIT",
        }),
      );
    }
    const next = clone(deck);
    (next.overrides as Record<string, unknown>).slides = { intro: { effects: [{ id: "local:globe", sha256: digest }] } };
    writeFileSync(join(dir, "deck.json"), JSON.stringify(next, null, 2));
    return dir;
  }

  it("fails naming the path and the file when the module is missing", () => {
    const r = runCli(["validate", "deck.json"], seed({ card: true }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["intro"].effects[0]');
    expect(r.stderr).toContain("fx/globe.js");
  });

  it("fails naming the card when only the module is present", () => {
    const r = runCli(["validate", "deck.json"], seed({ module: true }));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("fx/globe.meta.json");
  });

  it("passes when both are present", () => {
    const r = runCli(["validate", "deck.json"], seed({ module: true, card: true }));
    expect(r.status, r.stderr).toBe(0);
  });

  it("fails for a copy of the same deck.json in a directory without fx/", () => {
    const src = seed({ module: true, card: true });
    const elsewhere = mkdtempSync(join(tmpdir(), "deck3d-e23-copy-"));
    writeFileSync(join(elsewhere, "deck.json"), readFileSync(join(src, "deck.json"), "utf8"));
    const r = runCli(["validate", "deck.json"], elsewhere);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("fx/globe.js");
  });
});

/**
 * E47 (task 13.2) — ir: placement knobs validate at the right scope.
 *
 * `layout` and `cardOffset` are per-slide as well as deck-wide; `spacing` is a
 * property of the slide rail itself, so it exists deck-level ONLY and a slide
 * that sets it must be reported rather than silently ignored.
 */
describe("E47 placement knobs", () => {
  function seedDeck(): { dir: string; deck: Record<string, unknown> } {
    const dir = mkdtempSync(join(tmpdir(), "deck3d-e47-"));
    writeFileSync(join(dir, "talk.md"), "# Intro\n\n- a\n");
    const parsed = runCli(["parse", "talk.md", "-o", "deck.json"], dir);
    expect(parsed.status, parsed.stderr).toBe(0);
    return { dir, deck: JSON.parse(readFileSync(join(dir, "deck.json"), "utf8")) as Record<string, unknown> };
  }

  function validateWith(patch: (o: Record<string, unknown>) => void) {
    const { dir, deck } = seedDeck();
    const next = clone(deck);
    patch(next.overrides as Record<string, unknown>);
    writeFileSync(join(dir, "deck.json"), JSON.stringify(next, null, 2));
    return runCli(["validate", "deck.json"], dir);
  }

  it("accepts deck-level layout and spacing", () => {
    const r = validateWith((o) => {
      o.deck = { ...(o.deck as object), layout: "split-reverse", spacing: 60 };
    });
    expect(r.status, r.stderr).toBe(0);
  });

  it("accepts per-slide layout and cardOffset", () => {
    const r = validateWith((o) => {
      o.slides = { intro: { layout: "split-reverse", cardOffset: { x: -0.5, y: 0.4 } } };
    });
    expect(r.status, r.stderr).toBe(0);
  });

  it("rejects per-slide spacing naming the path", () => {
    const r = validateWith((o) => {
      o.slides = { intro: { spacing: 60 } };
    });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain('overrides.slides["intro"]');
    expect(r.stderr).toContain("spacing");
  });

  it("rejects an unknown layout preset and a non-positive spacing", () => {
    const bad = validateWith((o) => {
      o.deck = { ...(o.deck as object), layout: "diagonal" };
    });
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain("overrides.deck.layout");

    const zero = validateWith((o) => {
      o.deck = { ...(o.deck as object), spacing: 0 };
    });
    expect(zero.status).not.toBe(0);
    expect(zero.stderr).toContain("overrides.deck.spacing");
  });
});
