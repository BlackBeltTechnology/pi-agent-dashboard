import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import React from "react";
import { UrlLink } from "../UrlLink.js";

describe("UrlLink", () => {
  it("renders <a target=_blank rel=noopener noreferrer> for https URL", () => {
    const { container } = render(<UrlLink href="https://example.com/foo">https://example.com/foo</UrlLink>);
    const a = container.querySelector("a")!;
    expect(a).not.toBeNull();
    expect(a.getAttribute("href")).toBe("https://example.com/foo");
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
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
});
