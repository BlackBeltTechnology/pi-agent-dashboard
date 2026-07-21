import { describe, it, expect, afterEach, vi } from "vitest";
import { createElement, StrictMode } from "react";
import { render, cleanup } from "@testing-library/react";
import {
  registerEscapeLayer,
  unregisterEscapeLayer,
  useEscapeDismiss,
  __resetEscapeStack,
} from "../escape-stack.js";

afterEach(() => {
  cleanup();
  __resetEscapeStack();
});

function pressEscape(init: KeyboardEventInit = {}): KeyboardEvent {
  const ev = new KeyboardEvent("keydown", {
    key: "Escape",
    bubbles: true,
    cancelable: true,
    ...init,
  });
  document.dispatchEvent(ev);
  return ev;
}

describe("escape-stack — topmost-only dispatch", () => {
  it("E1 topmost-only: only the top layer's onEscape fires", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerEscapeLayer("A", a);
    registerEscapeLayer("B", b);
    pressEscape();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("E2 successive peel: three Escapes dismiss C, B, A in order", () => {
    const order: string[] = [];
    registerEscapeLayer("A", () => {
      order.push("A");
      unregisterEscapeLayer("A");
    });
    registerEscapeLayer("B", () => {
      order.push("B");
      unregisterEscapeLayer("B");
    });
    registerEscapeLayer("C", () => {
      order.push("C");
      unregisterEscapeLayer("C");
    });
    pressEscape();
    pressEscape();
    pressEscape();
    expect(order).toEqual(["C", "B", "A"]);
  });

  it("E3 lone layer: single layer still dismisses", () => {
    const a = vi.fn();
    registerEscapeLayer("A", a);
    pressEscape();
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe("escape-stack — lifecycle", () => {
  it("E4 order-independent unregister: removing A by id leaves B live", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerEscapeLayer("A", a);
    registerEscapeLayer("B", b);
    unregisterEscapeLayer("A");
    pressEscape();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("E11 latest handler without re-registration: re-register same id uses cb2", () => {
    const cb1 = vi.fn();
    const cb2 = vi.fn();
    registerEscapeLayer("A", cb1);
    registerEscapeLayer("A", cb2); // same id → refresh, not a second entry
    pressEscape();
    expect(cb2).toHaveBeenCalledTimes(1);
    expect(cb1).not.toHaveBeenCalled();
  });
});

describe("escape-stack — consume + passthrough", () => {
  it("E5 empty passthrough: no layers → event not consumed, window spy fires", () => {
    const spy = vi.fn();
    window.addEventListener("keydown", spy);
    const ev = pressEscape();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(ev.defaultPrevented).toBe(false);
    window.removeEventListener("keydown", spy);
  });

  it("E6 consume blocks window: layer dismisses, window spy does not fire", () => {
    const a = vi.fn();
    const spy = vi.fn();
    window.addEventListener("keydown", spy);
    registerEscapeLayer("A", a);
    const ev = pressEscape();
    expect(a).toHaveBeenCalledTimes(1);
    expect(spy).not.toHaveBeenCalled();
    expect(ev.defaultPrevented).toBe(true);
    window.removeEventListener("keydown", spy);
  });
});

describe("escape-stack — guards", () => {
  it("E7 key-repeat guard: repeat dismisses nothing, non-repeat dismisses B", () => {
    const a = vi.fn();
    const b = vi.fn();
    registerEscapeLayer("A", a);
    registerEscapeLayer("B", b);
    pressEscape({ repeat: true });
    expect(a).not.toHaveBeenCalled();
    expect(b).not.toHaveBeenCalled();
    pressEscape({ repeat: false });
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
  });

  it("E8 defaultPrevented opt-out: layer stays, onEscape not called", () => {
    const a = vi.fn();
    registerEscapeLayer("A", a);
    // A focused input already handled Escape (defaultPrevented) before it bubbles
    // to document — simulate via a capture-phase listener that preventDefaults.
    const pre = (e: KeyboardEvent) => e.preventDefault();
    document.addEventListener("keydown", pre, { capture: true });
    pressEscape();
    expect(a).not.toHaveBeenCalled();
    document.removeEventListener("keydown", pre, { capture: true });
    // A is still registered → a clean Escape now dismisses it.
    pressEscape();
    expect(a).toHaveBeenCalledTimes(1);
  });
});

describe("escape-stack — hook lifecycle", () => {
  it("E9 StrictMode id stability: one entry, fires once, no leak/drop", () => {
    const onEscape = vi.fn();
    function Layer() {
      useEscapeDismiss(true, onEscape);
      return null;
    }
    render(createElement(StrictMode, null, createElement(Layer)));
    pressEscape();
    expect(onEscape).toHaveBeenCalledTimes(1);
  });
});

describe("escape-stack — attach-once / never-detach", () => {
  it("E10 attaches document keydown once, no duplicate across empty→refill", () => {
    __resetEscapeStack(); // clean module state: detached
    const addSpy = vi.spyOn(document, "addEventListener");
    registerEscapeLayer("A", vi.fn()); // first registration attaches
    unregisterEscapeLayer("A"); // stack empty, listener stays attached
    registerEscapeLayer("B", vi.fn()); // already attached → no new listener
    const keydownAdds = addSpy.mock.calls.filter((c) => c[0] === "keydown");
    expect(keydownAdds).toHaveLength(1);
    addSpy.mockRestore();
  });
});
