/**
 * Seeded eval fixture consistency (test-plan E16, E17): the answer key is well-formed,
 * covers the planned item mix, and every location resolves to real fixture lines.
 * See change: add-reverse-spec-for-rebuild.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { read, SKILL } from "./files";

interface Item {
  id: string;
  kind: string;
  location: string;
  class?: string;
  category?: string;
}

const EVAL = join(SKILL, "eval");
const key = JSON.parse(read(join(EVAL, "answer-key.json"))) as { items: Item[] };
const CATEGORIES = ["tool-command", "env-var", "cli-flag", "http-route", "ws-event", "config-key", "error-code"];
const count = (pred: (i: Item) => boolean) => key.items.filter(pred).length;

describe("eval answer key", () => {
  it("E16: every item has a unique id, a kind and a location", () => {
    const ids = key.items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const i of key.items) {
      expect(i.id, JSON.stringify(i)).toBeTruthy();
      expect(i.kind, i.id).toBeTruthy();
      expect(i.location, i.id).toMatch(/^[^:]+:\d+-\d+$/);
    }
  });

  it("E16: rules are classified explicit|implicit", () => {
    for (const i of key.items.filter((x) => x.kind === "rule")) expect(["explicit", "implicit"], i.id).toContain(i.class);
  });

  it("E16: planned item mix", () => {
    expect(count((i) => i.kind === "rule" && i.class === "explicit")).toBeGreaterThanOrEqual(5);
    expect(count((i) => i.kind === "rule" && i.class === "implicit")).toBeGreaterThanOrEqual(3);
    expect(count((i) => i.kind === "quirk")).toBe(1);
    expect(count((i) => i.kind === "gap")).toBeGreaterThanOrEqual(1);
    expect(count((i) => i.kind === "state-machine")).toBeGreaterThanOrEqual(1);
  });

  it("E16: entry points span all 7 categories", () => {
    const cats = new Set(key.items.filter((i) => i.kind === "entry-point").map((i) => i.category));
    expect([...cats].sort()).toEqual([...CATEGORIES].sort());
  });

  it.each(key.items.map((i) => [i.id, i.location] as const))("E17: %s location %s resolves", (_id, location) => {
    const [, path, a, b] = location.match(/^([^:]+):(\d+)-(\d+)$/) ?? [];
    const file = join(EVAL, "fixture", path);
    expect(existsSync(file), file).toBe(true);
    const lines = read(file).split("\n");
    const [l1, l2] = [Number(a), Number(b)];
    expect(l1).toBeGreaterThanOrEqual(1);
    expect(l2).toBeGreaterThanOrEqual(l1);
    expect(l2).toBeLessThanOrEqual(lines.length);
    expect(lines.slice(l1 - 1, l2).some((l) => l.trim() !== "")).toBe(true);
  });
});
