/** pluginMeta seam (#E7 #E12 #X14). See change: add-browser-editor-pane-tab (D6). */
import { describe, expect, it, vi } from "vitest";
import { buildPromptMeta, PLUGIN_META_MAX_BYTES } from "../prompt-meta.js";

const warn = () => vi.fn();
/** An object whose JSON is exactly `n` UTF-8 bytes. */
const sized = (n: number): Record<string, unknown> => {
  const overhead = Buffer.byteLength(JSON.stringify({ k: "" }), "utf8");
  return { k: "x".repeat(n - overhead) };
};

describe("buildPromptMeta", () => {
  it("keeps today's behavior: message + toolCallId, undefined when neither", () => {
    expect(buildPromptMeta({ message: "m", toolCallId: "t" })).toEqual({ message: "m", toolCallId: "t" });
    expect(buildPromptMeta({})).toBeUndefined();
    expect(buildPromptMeta(undefined)).toBeUndefined();
    expect(buildPromptMeta({}, "explicit")).toEqual({ message: "explicit" });
  });

  it("#E7 2048 bytes accepted, 2049 dropped with a warning (prompt still built)", () => {
    const w = warn();
    expect(Buffer.byteLength(JSON.stringify(sized(PLUGIN_META_MAX_BYTES)))).toBe(PLUGIN_META_MAX_BYTES);
    expect(buildPromptMeta({ message: "m", pluginMeta: sized(PLUGIN_META_MAX_BYTES) }, undefined, w)?.plugin).toBeDefined();
    expect(w).not.toHaveBeenCalled();
    const over = buildPromptMeta({ message: "m", pluginMeta: sized(PLUGIN_META_MAX_BYTES + 1) }, undefined, w);
    expect(over).toEqual({ message: "m" });
    expect(w).toHaveBeenCalledTimes(1);
  });

  it("counts UTF-8 bytes, not characters", () => {
    const w = warn();
    // 700 × 3-byte chars = 2100 bytes but only 700 chars
    expect(buildPromptMeta({ message: "m", pluginMeta: { k: "€".repeat(700) } }, undefined, w)).toEqual({ message: "m" });
  });

  it("#E12 a pluginMeta-only dialog still yields metadata", () => {
    expect(buildPromptMeta({ pluginMeta: { kind: "browser-takeover", instanceId: "i" } })).toEqual({
      plugin: { kind: "browser-takeover", instanceId: "i" },
    });
  });

  it("#E12/#X14 drops class instances, BigInt and throwing serializers; prompt still built", () => {
    class Foo { a = 1; }
    const throwing = { toJSON() { throw new Error("boom"); } };
    for (const bad of [new Foo(), { n: 1n }, throwing, [1, 2], "str", 5, null, new Date()]) {
      const w = warn();
      const out = buildPromptMeta({ message: "m", pluginMeta: bad }, undefined, w);
      expect(out, String(bad)).toEqual({ message: "m" });
      expect(w).toHaveBeenCalled();
    }
  });

  it("accepts a null-prototype object", () => {
    const o = Object.create(null) as Record<string, unknown>;
    o.a = 1;
    expect(buildPromptMeta({ pluginMeta: o })?.plugin).toEqual({ a: 1 });
  });

  it("never overrides core keys; plugin data stays under `plugin`", () => {
    const out = buildPromptMeta({
      message: "real",
      toolCallId: "tc",
      pluginMeta: { message: "spoof", toolCallId: "spoof", kind: "file-access" },
    });
    expect(out).toEqual({ message: "real", toolCallId: "tc", plugin: { message: "spoof", toolCallId: "spoof", kind: "file-access" } });
    expect(out?.kind).toBeUndefined();
  });
});
