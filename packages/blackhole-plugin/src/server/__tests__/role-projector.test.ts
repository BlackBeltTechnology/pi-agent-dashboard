/**
 * blackhole role projector (Kind B): field allow-list, merge-preserving write,
 * unmanaged-key safety, external-write conflict. See change: add-role-aware-model-refs.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ProjectionConflictError, projectModelField } from "../config-io.js";
import { acceptsField, createBlackholeProjector } from "../role-projector.js";

let dir: string;
let file: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "bh-proj-"));
  file = path.join(dir, "pi-blackhole-config.json");
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const seed = (o: Record<string, unknown>) => fs.writeFileSync(file, JSON.stringify(o, null, 2));
const read = () => JSON.parse(fs.readFileSync(file, "utf-8"));

describe("acceptsField", () => {
  it("E9: primaries + indexed fallback entries only", () => {
    expect(acceptsField("observerFallbackModels[0]")).toBe(true);
    expect(acceptsField("observerFallbackModels[7]")).toBe(true);
    expect(acceptsField("observerFallbackModels[-1]")).toBe(false);
    expect(acceptsField("observerFallbackModels")).toBe(false);
    expect(acceptsField("__proto__")).toBe(false);
    expect(acceptsField("observerModel")).toBe(true);
    expect(acceptsField("compaction")).toBe(false);
    expect(acceptsField("observerFallbackModels[01]")).toBe(false);
  });
});

describe("projector write", () => {
  it("E17: cooldownHours / contextWindow survive re-projection", () => {
    seed({
      observerFallbackModels: [{ provider: "a", id: "x", cooldownHours: 2, contextWindow: 64000, thinking: "low" }],
    });
    createBlackholeProjector(() => file).write("observerFallbackModels[0]", { provider: "openai", id: "gpt-5-mini" });
    expect(read().observerFallbackModels[0]).toEqual({
      provider: "openai",
      id: "gpt-5-mini",
      cooldownHours: 2,
      contextWindow: 64000,
    });
  });

  it("E18: only the bound slot changes; unbound slot and unmanaged keys are byte-identical", () => {
    seed({
      observerModel: { provider: "a", id: "x" },
      reflectorModel: { provider: "r", id: "y", thinking: "high" },
      foo: 1,
      _comment: "keep",
    });
    const before = read();
    createBlackholeProjector(() => file).write("observerModel", { provider: "n", id: "m", level: "low" });
    const after = read();
    expect(after.observerModel).toEqual({ provider: "n", id: "m", thinking: "low" });
    expect(after.reflectorModel).toEqual(before.reflectorModel);
    expect(after.foo).toBe(1);
    expect(after._comment).toBe("keep");
    expect(Object.keys(after)).toEqual(Object.keys(before));
  });

  it("read maps thinking → level; absent field → undefined", () => {
    seed({ observerModel: { provider: "a", id: "x", thinking: "low" } });
    const p = createBlackholeProjector(() => file);
    expect(p.read("observerModel")).toEqual({ provider: "a", id: "x", level: "low" });
    expect(p.read("reflectorModel")).toBeUndefined();
    expect(p.read("observerFallbackModels[3]")).toBeUndefined();
  });

  it("an unsupported level (max) throws and writes nothing", () => {
    seed({ observerModel: { provider: "a", id: "x" } });
    const before = fs.readFileSync(file);
    expect(() => createBlackholeProjector(() => file).write("observerModel", { provider: "n", id: "m", level: "max" })).toThrow();
    expect(fs.readFileSync(file).equals(before)).toBe(true);
  });

  it("X12: file changed between read and write → conflict error, no overwrite", () => {
    seed({ observerModel: { provider: "a", id: "x" } });
    const external = JSON.stringify({ observerModel: { provider: "someone", id: "else" }, padding: "to change size" });
    expect(() =>
      projectModelField(file, "observerModel", { provider: "n", id: "m" }, () => fs.writeFileSync(file, external)),
    ).toThrow(ProjectionConflictError);
    expect(fs.readFileSync(file, "utf-8")).toBe(external);
  });
});
