import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LayerHostProvider } from "../LayerPortal.js";
import { Popover } from "../Popover.js";

afterEach(() => cleanup());

describe("Popover layering (change: add-session-actions-flyout)", () => {
  it("paints at the popover layer token, never a bare number", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    render(
      <Popover anchorEl={anchor} onDismiss={() => {}}>
        <span>x</span>
      </Popover>,
    );
    const el = screen.getByTestId("ui-popover");
    expect(el.style.zIndex).toBe("var(--z-popover)");
    expect(el.parentElement).toBe(document.body);
    anchor.remove();
  });

  it("portals into the dialog layer host when one is provided", () => {
    const anchor = document.createElement("button");
    document.body.appendChild(anchor);
    const host = document.createElement("div");
    document.body.appendChild(host);
    render(
      <LayerHostProvider host={host}>
        <Popover anchorEl={anchor} onDismiss={() => {}}>
          <span>x</span>
        </Popover>
      </LayerHostProvider>,
    );
    const el = screen.getByTestId("ui-popover");
    expect(host.contains(el)).toBe(true);
    expect(el.parentElement).not.toBe(document.body);
    anchor.remove();
    host.remove();
  });
});
