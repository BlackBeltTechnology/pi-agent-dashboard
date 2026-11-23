/**
 * The `/pi-view?url=` overlay header carries "Open in browser" and
 * "embedded from <host>" for a web page; the body is the card (route opener →
 * no probe). See change: rich-chat-links (D11, task 8.7; test-plan #E29).
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { PreviewOverlayView } from "../PreviewOverlayView.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function mount(url: string) {
  const loc = memoryLocation({ path: "/pi-view" });
  return render(
    <Router hook={loc.hook} searchHook={loc.searchHook}>
      <PreviewOverlayView target={{ kind: "url", url }} onBack={() => {}} />
    </Router>,
  );
}

describe("PreviewOverlayView — web page", () => {
  it("shows the host label and Open in browser; renders the card without any request", () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    mount("https://example.com/docs");
    expect(screen.getByTestId("embedded-from").textContent).toBe("embedded from example.com");
    expect(screen.getAllByRole("button", { name: "Open in browser" }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole("button", { name: "Check and embed" })).toBeTruthy();
    expect(document.querySelector("iframe")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("a file target has no host label", () => {
    const loc = memoryLocation({ path: "/x" });
    render(
      <Router hook={loc.hook} searchHook={loc.searchHook}>
        <PreviewOverlayView target={{ kind: "file", cwd: "/p", path: "a.dat" }} onBack={() => {}} />
      </Router>,
    );
    expect(screen.queryByTestId("embedded-from")).toBeNull();
  });
});
