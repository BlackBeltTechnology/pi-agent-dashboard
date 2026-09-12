import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { LayerHostProvider, LayerPortal } from "../LayerPortal.js";

afterEach(() => cleanup());

describe("LayerPortal", () => {
  it("portals to document.body when no layer host is provided", () => {
    render(
      <div id="app-root">
        <LayerPortal>
          <div data-testid="panel">Hello</div>
        </LayerPortal>
      </div>,
    );

    expect(screen.getByTestId("panel").parentElement).toBe(document.body);
  });

  it("portals to the nearest layer host when one is provided", () => {
    function Host() {
      const [el, setEl] = React.useState<HTMLDivElement | null>(null);
      return (
        <div ref={setEl} data-testid="host">
          <LayerHostProvider host={el}>
            <LayerPortal>
              <div data-testid="panel">Hello</div>
            </LayerPortal>
          </LayerHostProvider>
        </div>
      );
    }
    render(<Host />);

    expect(screen.getByTestId("panel").parentElement).toBe(screen.getByTestId("host"));
  });

  it("falls back to document.body while the host element is not yet mounted", () => {
    render(
      <LayerHostProvider host={null}>
        <LayerPortal>
          <div data-testid="panel">Hello</div>
        </LayerPortal>
      </LayerHostProvider>,
    );

    expect(screen.getByTestId("panel").parentElement).toBe(document.body);
  });
});
