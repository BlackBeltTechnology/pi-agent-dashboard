/**
 * guard.mjs lint-cite — deterministic cap on `confirmed` multi-location cites
 * (test-plan E1-E8, X1-X3). See change: tune-reverse-spec-for-rebuild-eval.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { guard } from "./files";

const dir = mkdtempSync(join(tmpdir(), "rsfr-cite-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, body: string): string {
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

describe("lint-cite", () => {
  it("E1: one location confirmed passes; two locations confirmed fails naming file:line", () => {
    const one = file("one.md", "# t\n\ntext\n<!-- cite: ref=src/a.ts:1, confidence=confirmed -->\n");
    const ok = guard(dir, "lint-cite", one);
    expect(ok.code).toBe(0);
    expect(ok.stdout).toBe("");

    const two = file("two.md", "# t\n\ntext\n<!-- cite: ref=src/a.ts:1; src/b.ts:2-4, confidence=confirmed -->\n");
    const bad = guard(dir, "lint-cite", two);
    expect(bad.code).toBe(1);
    expect(bad.stdout).toMatch(new RegExp(`^${esc(two)}:4: .+`, "m"));
  });

  it("E2: any separator between locations counts", () => {
    const p = file(
      "seps.md",
      [
        "<!-- cite: ref=a.ts:1; b.ts:2, confidence=confirmed -->",
        "<!-- cite: ref=a.ts:1, b.ts:2, confidence=confirmed -->",
        "<!-- cite: ref=a.ts:1 and b.ts:2, confidence=confirmed -->",
      ].join("\n"),
    );
    const r = guard(dir, "lint-cite", p);
    expect(r.code).toBe(1);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(3);
    for (const n of [1, 2, 3]) expect(r.stdout).toMatch(new RegExp(`^${esc(p)}:${n}: `, "m"));
  });

  it("E3: the cap applies only to confirmed", () => {
    const p = file(
      "levels.md",
      [
        "<!-- cite: ref=a.ts:1; b.ts:2, confidence=inferred -->",
        "<!-- cite: ref=a.ts:1; b.ts:2, confidence=assumed -->",
        "<!-- cite: ref=a.ts:1-9, confidence=confirmed -->",
      ].join("\n"),
    );
    const r = guard(dir, "lint-cite", p);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("E4: indented, confidence-first cite is checked; ref runs to -->", () => {
    const p = file("indent.md", "- **Order**\n  <!-- cite: confidence=confirmed, ref=a.ts:1; b.ts:2 -->\n");
    const r = guard(dir, "lint-cite", p);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^${esc(p)}:2: `, "m"));
  });

  it("E5: nested fragment cite in one-line JSON with reordered keys names the JSON pointer", () => {
    const frag = {
      capability: "orders",
      entities: [
        {
          name: "Order",
          cite: "a.ts:1",
          confidence: "confirmed",
          fields: [
            { name: "id", cite: "a.ts:2", confidence: "confirmed" },
            { name: "tier", confidence: "inferred", cite: "a.ts:3; b.ts:4" },
            { confidence: "confirmed", cite: "a.ts:1; b.ts:2", name: "priority" },
          ],
        },
      ],
    };
    const p = file("frag.json", JSON.stringify(frag));
    const r = guard(dir, "lint-cite", p);
    expect(r.code).toBe(1);
    const lines = r.stdout.trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(new RegExp(`^${esc(p)}#/entities/0/fields/2: `));
  });

  it("E6: entry_points (no confidence key) are skipped", () => {
    const p = file(
      "ep.json",
      JSON.stringify({ entry_points: [{ name: "POST /x", cite: "a.ts:1; b.ts:2" }], rules: [] }, null, 2),
    );
    const r = guard(dir, "lint-cite", p);
    expect(r.code).toBe(0);
    expect(r.stdout).toBe("");
  });

  it("E7: an unterminated cite is a finding at its opening line", () => {
    const p = file("open.md", "text\n<!-- cite: ref=a.ts:1, confidence=confirmed\n-->\n");
    const r = guard(dir, "lint-cite", p);
    expect(r.code).toBe(1);
    expect(r.stdout).toMatch(new RegExp(`^${esc(p)}:2: .*unterminated`, "m"));
  });

  it("E8: multi-file call reports only the dirty file", () => {
    const clean = file("clean.md", "<!-- cite: ref=a.ts:1, confidence=confirmed -->\n");
    const dirty = file("dirty.json", JSON.stringify({ rules: [{ id: "BR-001", cite: "a.ts:1; b.ts:2", confidence: "confirmed" }] }));
    const r = guard(dir, "lint-cite", clean, dirty);
    expect(r.code).toBe(1);
    expect(r.stdout).not.toContain(clean);
    expect(r.stdout).toMatch(new RegExp(`^${esc(dirty)}#/rules/0: `, "m"));
  });

  it("X1: no file argument -> exit 2 + usage", () => {
    const r = guard(dir, "lint-cite");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("usage:");
  });

  it("X2: missing file -> exit 2 naming it", () => {
    const r = guard(dir, "lint-cite", "/nope.md");
    expect(r.code).toBe(2);
    expect(r.stderr).toContain("lint-cite: not found: /nope.md");
  });

  it("X3: invalid JSON never exits 0 and names the file", () => {
    const p = file("broken.json", "{ \"rules\": [ ");
    const r = guard(dir, "lint-cite", p);
    expect(r.code).not.toBe(0);
    expect(r.code).not.toBeNull();
    expect(r.stderr).toContain(p);
  });
});
