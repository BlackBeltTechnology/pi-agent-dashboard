/**
 * Tests for the bridge's `ctx.ui.multiselect` PromptBus patch and the TUI
 * adapter's multiselect handling. The patch lives in `bridge.ts` but is
 * exercised here through a small reproduction harness so we don't pull in
 * the full session lifecycle.
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { decodeMultiselectAnswer } from "../multiselect-decode.js";

// ──────────────────────────────────────────────────────────────────────
// `decodeMultiselectAnswer` — pure helper used by both the runtime patch
// and the TUI adapter's response encoding round-trip.
// ──────────────────────────────────────────────────────────────────────

describe("decodeMultiselectAnswer", () => {
  it("resolves cancellation as undefined", () => {
    expect(decodeMultiselectAnswer({ cancelled: true })).toBeUndefined();
    expect(decodeMultiselectAnswer({ cancelled: true, answer: '["x"]' })).toBeUndefined();
  });

  it("resolves successful selection from JSON-encoded array", () => {
    expect(decodeMultiselectAnswer({ cancelled: false, answer: '["a","c"]' })).toEqual(["a", "c"]);
  });

  it("resolves empty selection as []", () => {
    expect(decodeMultiselectAnswer({ cancelled: false, answer: "[]" })).toEqual([]);
  });

  it("resolves null / undefined / empty answer as [] (not undefined)", () => {
    expect(decodeMultiselectAnswer({ cancelled: false, answer: undefined })).toEqual([]);
    expect(decodeMultiselectAnswer({ cancelled: false, answer: "" })).toEqual([]);
  });

  it("resolves unparseable JSON as [] without throwing", () => {
    expect(decodeMultiselectAnswer({ cancelled: false, answer: "not-json" })).toEqual([]);
    expect(decodeMultiselectAnswer({ cancelled: false, answer: "{not:array}" })).toEqual([]);
  });

  it("resolves valid JSON that is not an array as []", () => {
    expect(decodeMultiselectAnswer({ cancelled: false, answer: '"just-a-string"' })).toEqual([]);
    expect(decodeMultiselectAnswer({ cancelled: false, answer: '{"k":"v"}' })).toEqual([]);
  });
});

// ──────────────────────────────────────────────────────────────────────
// Bridge patch reproduction — emulate the assignment block in
// `bridge.ts:935-948` plus the new multiselect arm and assert behavior.
// We cannot import `bridge.ts` directly (it has heavy session-lifecycle
// imports), so we reproduce the assignment closure here. The closure
// shape MUST match `bridge.ts` exactly; if `bridge.ts` drifts, the
// regression guard test (see "ctx.ui.multiselect is assigned by the
// bridge patch block" below) re-loads the bridge source and asserts
// the assignment exists.
// ──────────────────────────────────────────────────────────────────────

interface BusRequestArgs {
  pipeline: string;
  type: string;
  question: string;
  options?: string[];
  metadata?: Record<string, unknown>;
}

interface FakeBus {
  request: (args: BusRequestArgs) => Promise<{ cancelled?: boolean; answer?: string }>;
}

function applyMultiselectPatch(
  ctx: { ui: Record<string, any> },
  bus: FakeBus,
): void {
  const existing = (ctx.ui as any).multiselect;
  if (typeof existing === "function") {
    // eslint-disable-next-line no-console
    console.warn("[bridge] ctx.ui.multiselect already exists — overriding for PromptBus routing");
  }
  (ctx.ui as any).multiselect = (title: string, options: string[], opts?: { message?: string }) =>
    bus.request({
      pipeline: "command",
      type: "multiselect",
      question: title,
      options,
      metadata: opts?.message ? { message: opts.message } : undefined,
    }).then((r) => decodeMultiselectAnswer(r));
}

describe("bridge ctx.ui.multiselect patch", () => {
  let ctx: { ui: Record<string, any> };
  let bus: FakeBus;
  let requestSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    requestSpy = vi.fn();
    bus = { request: requestSpy as any };
    ctx = { ui: {} };
  });

  it("assigns ctx.ui.multiselect as a function after the patch runs", () => {
    expect(typeof ctx.ui.multiselect).toBe("undefined");
    applyMultiselectPatch(ctx, bus);
    expect(typeof ctx.ui.multiselect).toBe("function");
  });

  it("dispatches bus.request with the right shape on call", async () => {
    applyMultiselectPatch(ctx, bus);
    requestSpy.mockResolvedValue({ cancelled: false, answer: '["a","c"]' });

    const result = await ctx.ui.multiselect("Pick", ["a", "b", "c"], { message: "ctx" });

    expect(requestSpy).toHaveBeenCalledTimes(1);
    expect(requestSpy).toHaveBeenCalledWith({
      pipeline: "command",
      type: "multiselect",
      question: "Pick",
      options: ["a", "b", "c"],
      metadata: { message: "ctx" },
    });
    expect(result).toEqual(["a", "c"]);
  });

  it("omits metadata when no message is provided", async () => {
    applyMultiselectPatch(ctx, bus);
    requestSpy.mockResolvedValue({ cancelled: false, answer: "[]" });

    await ctx.ui.multiselect("Pick", ["a", "b"]);

    expect(requestSpy).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: undefined }),
    );
  });

  it("resolves successful selection through the decoder", async () => {
    applyMultiselectPatch(ctx, bus);
    requestSpy.mockResolvedValue({ cancelled: false, answer: '["a","c"]' });
    await expect(ctx.ui.multiselect("t", ["a", "b", "c"])).resolves.toEqual(["a", "c"]);
  });

  it("resolves empty selection as []", async () => {
    applyMultiselectPatch(ctx, bus);
    requestSpy.mockResolvedValue({ cancelled: false, answer: "[]" });
    await expect(ctx.ui.multiselect("t", ["a"])).resolves.toEqual([]);
  });

  it("resolves cancellation as undefined", async () => {
    applyMultiselectPatch(ctx, bus);
    requestSpy.mockResolvedValue({ cancelled: true });
    await expect(ctx.ui.multiselect("t", ["a"])).resolves.toBeUndefined();
  });

  it("resolves unparseable answer as [] without throwing", async () => {
    applyMultiselectPatch(ctx, bus);
    requestSpy.mockResolvedValue({ cancelled: false, answer: "not-json" });
    await expect(ctx.ui.multiselect("t", ["a"])).resolves.toEqual([]);
  });

  it("warns when ctx.ui.multiselect was already a function before the patch", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    ctx.ui.multiselect = () => Promise.resolve(["pre-existing"]);

    applyMultiselectPatch(ctx, bus);

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("already exists"),
    );
    // The patch still wins — subsequent calls go through bus.request.
    requestSpy.mockResolvedValue({ cancelled: false, answer: '["winner"]' });
    return ctx.ui.multiselect("t", ["a"]).then((r: any) => {
      expect(r).toEqual(["winner"]);
      expect(requestSpy).toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});

// ──────────────────────────────────────────────────────────────────────
// Source regression guard — re-load bridge.ts as text and assert the
// multiselect patch line exists. Mirrors `no-direct-process-kill.test.ts`
// pattern: textual scan over a single file, fail with file:line if the
// expected snippet is missing or moved.
// ──────────────────────────────────────────────────────────────────────

describe("bridge.ts source regression guard", () => {
  it("contains the ctx.ui.multiselect PromptBus assignment", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const url = await import("node:url");
    const here = path.dirname(url.fileURLToPath(import.meta.url));
    const bridgePath = path.resolve(here, "../bridge.ts");
    const src = fs.readFileSync(bridgePath, "utf8");

    // The assignment must mention `multiselect` as a key on ctx.ui AND
    // dispatch through bus.request with type:"multiselect".
    expect(src).toMatch(/\(ctx\.ui as any\)\.multiselect\s*=/);
    expect(src).toMatch(/type:\s*"multiselect"/);
  });

  // Note: the previous-change assertions about `custom: ctx.ui.custom?.bind(...)`
  // capture and the TUI `prompt.type === "multiselect"` arm were removed by
  // change `fix-multiselect-tui-arm-self-cancel`. The inverse-guard for that
  // removal lives in `no-tui-multiselect-arm-regression.test.ts`.
});
