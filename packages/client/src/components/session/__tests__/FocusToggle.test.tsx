import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardSectionsProvider } from "../../../lib/state/CardSectionsContext.js";
import { FocusToggle } from "../FocusToggle.js";

afterEach(cleanup);

const mount = (prefs: object, extra: object = {}) => {
  const send = vi.fn();
  render(
    <CardSectionsProvider value={{ prefs, send, ...extra }}>
      <FocusToggle />
    </CardSectionsProvider>,
  );
  return { send, btn: screen.getByTestId("focus-toggle-btn") as HTMLButtonElement };
};

describe("FocusToggle (sidebar toggle)", () => {
  it("is a native button reporting aria-pressed; activating toggles Focus", () => {
    const off = mount({});
    expect(off.btn.tagName).toBe("BUTTON");
    expect(off.btn.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(off.btn);
    expect(off.send).toHaveBeenLastCalledWith({ type: "set_focus_mode", enabled: true });
    cleanup();
    const on = mount({ focus: { enabled: true } });
    expect(on.btn.getAttribute("aria-pressed")).toBe("true");
    expect(on.btn.className).toContain("text-blue-400");
    fireEvent.click(on.btn);
    expect(on.send).toHaveBeenLastCalledWith({ type: "set_focus_mode", enabled: false });
  });
  it("is disabled while the socket is down", () => {
    expect(mount({}, { connected: false }).btn.disabled).toBe(true);
  });
});
