/**
 * Tests for `polyfillMultiselect`'s fallback chain. After the
 * fix-multiselect-auto-cancel-on-dashboard change, the polyfill prefers a
 * bridge-patched `ctx.ui.multiselect` (the PromptBus path that surfaces in
 * the dashboard browser) and falls back to the legacy `ctx.ui.custom` +
 * `MultiSelectList` overlay only when the patch is absent (older pi
 * versions or non-bridge embeddings).
 *
 * See change: fix-multiselect-auto-cancel-on-dashboard.
 */
import { describe, it, expect, vi } from "vitest";
import { polyfillMultiselect } from "../multiselect-polyfill.js";

describe("polyfillMultiselect — fallback chain", () => {
  it("delegates to ctx.ui.multiselect when present (primary, bus-routed path)", async () => {
    const multiselectFn = vi.fn().mockResolvedValue(["a"]);
    const customFn = vi.fn();
    const ctx = {
      ui: {
        multiselect: multiselectFn,
        custom: customFn,
      },
    };

    const result = await polyfillMultiselect(ctx as any, "Pick", ["a", "b"]);

    expect(result).toEqual(["a"]);
    expect(multiselectFn).toHaveBeenCalledTimes(1);
    expect(multiselectFn).toHaveBeenCalledWith("Pick", ["a", "b"], undefined);
    expect(customFn).not.toHaveBeenCalled();
  });

  it("forwards opts.message to ctx.ui.multiselect when present", async () => {
    const multiselectFn = vi.fn().mockResolvedValue([]);
    const ctx = { ui: { multiselect: multiselectFn, custom: vi.fn() } };

    await polyfillMultiselect(ctx as any, "Pick", ["a"], { message: "ctx" });

    expect(multiselectFn).toHaveBeenCalledWith("Pick", ["a"], { message: "ctx" });
  });

  it("propagates undefined (cancellation) through the primary path", async () => {
    const multiselectFn = vi.fn().mockResolvedValue(undefined);
    const ctx = { ui: { multiselect: multiselectFn, custom: vi.fn() } };

    await expect(polyfillMultiselect(ctx as any, "t", ["a"])).resolves.toBeUndefined();
  });

  it("falls back to ctx.ui.custom when ctx.ui.multiselect is absent (TUI path)", async () => {
    let capturedDone: ((r: string[] | undefined) => void) | undefined;
    const customFn = vi.fn().mockImplementation((factory: any) => {
      return new Promise<string[] | undefined>((resolve) => {
        const done = (r: string[] | undefined) => resolve(r);
        capturedDone = done;
        const component = factory({}, {}, {}, done);
        // Simulate user confirming after the factory wires the component.
        component?.onConfirm?.(["b"]);
      });
    });
    const ctx = { ui: { custom: customFn } };

    const result = await polyfillMultiselect(ctx as any, "Pick", ["a", "b"]);

    expect(result).toEqual(["b"]);
    expect(customFn).toHaveBeenCalledTimes(1);
    expect(capturedDone).toBeTypeOf("function");
  });

  it("falls back to ctx.ui.custom and resolves undefined on cancel", async () => {
    const customFn = vi.fn().mockImplementation((factory: any) => {
      return new Promise<string[] | undefined>((resolve) => {
        const component = factory({}, {}, {}, (r: any) => resolve(r));
        component?.onCancel?.();
      });
    });
    const ctx = { ui: { custom: customFn } };

    await expect(polyfillMultiselect(ctx as any, "Pick", ["a"])).resolves.toBeUndefined();
  });

  it("does NOT fall back to ctx.ui.custom when ctx.ui.multiselect resolves to []", async () => {
    // Empty selection is a valid answer — must NOT trigger the legacy fallback.
    const multiselectFn = vi.fn().mockResolvedValue([]);
    const customFn = vi.fn();
    const ctx = { ui: { multiselect: multiselectFn, custom: customFn } };

    const result = await polyfillMultiselect(ctx as any, "t", ["a"]);

    expect(result).toEqual([]);
    expect(customFn).not.toHaveBeenCalled();
  });
});
