import { fireEvent, render } from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UrlLink } from "../UrlLink.js";

// vi.hoisted so the mock (also hoisted) can reference the spy without a TDZ.
// `box.ctx` is mutable so a test can flip the context to null.
const { openLiveTarget, box } = vi.hoisted(() => {
  const openLiveTarget = vi.fn();
  return {
    openLiveTarget,
    box: { ctx: { openLiveTarget } as { openLiveTarget: typeof openLiveTarget } | null },
  };
});
vi.mock("../../SplitWorkspaceContext.js", () => ({
  useOptionalSplitWorkspace: () => box.ctx,
}));
afterEach(() => {
  openLiveTarget.mockClear();
  box.ctx = { openLiveTarget };
});

describe("UrlLink", () => {
  it("renders <a target=_blank rel=noopener noreferrer> for https URL", () => {
    const { container } = render(<UrlLink href="https://example.com/foo">https://example.com/foo</UrlLink>);
    const a = container.querySelector("a")!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("https://example.com/foo");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("renders the <a> as non-draggable so drag-select is not hijacked", () => {
    const { container } = render(<UrlLink href="https://example.com/foo">https://example.com/foo</UrlLink>);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("draggable")).toBe("false");
  });

  it("renders <a> for http URL", () => {
    const { container } = render(<UrlLink href="http://x.test/path">x</UrlLink>);
    expect(container.querySelector("a")).not.toBeNull();
  });

  it("rejects a forged javascript: href even if the tokenizer were bypassed", () => {
    const { container } = render(<UrlLink href="javascript:alert(1)">click me</UrlLink>);
    expect(container.querySelector("a")).toBeNull();
    expect(container.textContent).toBe("click me");
  });

  it("rejects data: and vbscript: hrefs", () => {
    const dataEl = render(<UrlLink href="data:text/html,<script>">x</UrlLink>).container;
    expect(dataEl.querySelector("a")).toBeNull();
    const vbEl = render(<UrlLink href="vbscript:msgbox(1)">x</UrlLink>).container;
    expect(vbEl.querySelector("a")).toBeNull();
  });

  it("plain click on a loopback URL routes to the split viewer", () => {
    const { container } = render(<UrlLink href="http://localhost:50452/x.html">x</UrlLink>);
    const a = container.querySelector("a")!;
    const ev = fireEvent.click(a, { button: 0 });
    expect(openLiveTarget).toHaveBeenCalledWith("http://localhost:50452/x.html");
    expect(ev).toBe(false); // preventDefault
  });

  it("LAN URL (192.168.*) is NOT routed and keeps target=_blank", () => {
    const { container } = render(<UrlLink href="http://192.168.1.5:8080/">x</UrlLink>);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    fireEvent.click(a);
    expect(openLiveTarget).not.toHaveBeenCalled();
  });

  it("modifier and middle-click on a loopback URL do NOT route", () => {
    const { container } = render(<UrlLink href="http://localhost:50452/x.html">x</UrlLink>);
    const a = container.querySelector("a")!;
    fireEvent.click(a, { metaKey: true });
    fireEvent.click(a, { button: 1 });
    expect(openLiveTarget).not.toHaveBeenCalled();
  });

  it("null split-context no-ops and keeps the native anchor", () => {
    box.ctx = null;
    const { container } = render(<UrlLink href="http://localhost:50452/x.html">x</UrlLink>);
    const a = container.querySelector("a")!;
    expect(a.getAttribute("target")).toBe("_blank");
    fireEvent.click(a);
    expect(openLiveTarget).not.toHaveBeenCalled();
  });
});
