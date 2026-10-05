import { describe, expect, it, vi } from "vitest";
import { project } from "./helpers.js";
import { resolveStartTarget, targetStore } from "../state/target-store.js";

describe("target store + start target (F24)", () => {
  const projects = [project("billing"), project("crm", { available: false })];

  it("start = remembered (if usable) → first available project → own workspace", () => {
    expect(resolveStartTarget("billing", projects)).toBe("billing");
    expect(resolveStartTarget("crm", projects)).toBe("billing"); // unavailable ⇒ falls through
    expect(resolveStartTarget(null, projects)).toBe("billing");
    expect(resolveStartTarget("_ws", projects)).toBe("_ws");
    expect(resolveStartTarget("gone", [])).toBe("_ws");
    expect(resolveStartTarget(null, [project("crm", { available: false })])).toBe("_ws");
  });

  it("persists under team:target and notifies subscribers once per change", () => {
    const cb = vi.fn();
    const off = targetStore.subscribe(cb);
    targetStore.set("billing");
    targetStore.set("billing");
    expect(localStorage.getItem("team:target")).toBe("billing");
    expect(cb).toHaveBeenCalledTimes(1);
    targetStore.set("_ws");
    expect(cb).toHaveBeenCalledTimes(2);
    off();
  });
});
