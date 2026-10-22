/**
 * Navigation chokepoints — blocked targets never open (harden-client-sinks, test-plan #E10).
 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { SafeLink, useSafeNavigation } from "../safe-navigation.js";

afterEach(() => {
  cleanup();
  document.getElementById("pi-link-blocked-notice")?.remove();
  vi.restoreAllMocks();
});

function withNav(cb: (nav: ReturnType<typeof useSafeNavigation>) => void, path = "/") {
  const { hook, history } = memoryLocation({ path, record: true });
  function Probe() {
    cb(useSafeNavigation());
    return null;
  }
  render(
    <Router hook={hook}>
      <Probe />
    </Router>,
  );
  return history;
}

describe("useSafeNavigation().openUrl (#E10)", () => {
  it("blocked data: URL → false, no window.open, one role=status notice", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    let nav!: ReturnType<typeof useSafeNavigation>;
    withNav((n) => {
      nav = n;
    });
    let result: boolean | undefined;
    act(() => {
      result = nav.openUrl("data:text/html,<script>1</script>");
    });
    expect(result).toBe(false);
    expect(open).toHaveBeenCalledTimes(0);
    expect(screen.getAllByRole("status")).toHaveLength(1);
    // a second blocked attempt refreshes, never stacks
    act(() => {
      nav.openUrl("javascript:alert(1)");
    });
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  it("external target opens with noopener,noreferrer", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    let nav!: ReturnType<typeof useSafeNavigation>;
    withNav((n) => {
      nav = n;
    });
    expect(nav.openUrl("https://github.com/x")).toBe(true);
    expect(open).toHaveBeenCalledWith("https://github.com/x", "_blank", "noopener,noreferrer");
  });

  it("navigateTo pushes internal paths through history, never location", () => {
    let nav!: ReturnType<typeof useSafeNavigation>;
    const history = withNav((n) => {
      nav = n;
    });
    act(() => {
      expect(nav.navigateTo("/settings/general?x=1")).toBe(true);
    });
    expect(history.at(-1)).toBe("/settings/general?x=1");
    expect(nav.navigateTo("javascript:alert(1)")).toBe(false);
  });
});

describe("SafeLink", () => {
  it("renders a blocked target as inert text with no href", () => {
    const { container } = render(<SafeLink href="javascript:alert(1)">click</SafeLink>);
    expect(container.textContent).toBe("click");
    expect(container.querySelector("[href]")).toBeNull();
  });

  it("external link always carries rel=noopener noreferrer", () => {
    const { container } = render(
      <SafeLink href="https://example.com" target="_blank" rel="opener">
        x
      </SafeLink>,
    );
    const a = container.querySelector("a");
    expect(a?.getAttribute("href")).toBe("https://example.com");
    expect(a?.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("SafeLink internal hrefs", () => {
  it("keeps fragment / query / root-relative hrefs as written and re-roots absolute same-origin URLs", () => {
    const render1 = (h: string) => render(<SafeLink href={h}>x</SafeLink>).container.querySelector("a")?.getAttribute("href");
    expect(render1("#section")).toBe("#section");
    expect(render1("?tab=1")).toBe("?tab=1");
    expect(render1("/settings/general")).toBe("/settings/general");
    expect(render1(`${window.location.origin}/folder/x/view?path=a.md#h`)).toBe("/folder/x/view?path=a.md#h");
  });
});
