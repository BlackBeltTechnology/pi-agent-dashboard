/** Client routing of `editor_tab_open` (#F14 unit half). See change: add-browser-editor-pane-tab. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EDITOR_TAB_OPEN_EVENT, isOnSessionRoute, useEditorTabOpenListener } from "../layout/editor-tab-open.js";

afterEach(cleanup);

describe("isOnSessionRoute", () => {
  it.each([
    ["/session/S", "S", true],
    ["/session/S/", "S", true],
    ["/session/S/editor", "S", true],
    ["/session/S%201/editor", "S 1", true],
    ["/session/T", "S", false],
    ["/session/S/flow/x", "S", false],
    ["/settings", "S", false],
    ["/", "S", false],
    ["/session/%E0%A4%A", "S", false],
  ])("%s for %s → %s", (p, s, want) => expect(isOnSessionRoute(p, s)).toBe(want));
});

function Host({ pathname, navigate }: { pathname: string; navigate: () => void }) {
  useEditorTabOpenListener(pathname, navigate);
  return null;
}
const fire = (sessionId: string, path: string) =>
  window.dispatchEvent(new CustomEvent(EDITOR_TAB_OPEN_EVENT, { detail: { sessionId, path } }));

describe("useEditorTabOpenListener", () => {
  it("on the session's route → one navigation to ?tab= with an openNonce", () => {
    const nav = vi.fn();
    render(<Host pathname="/session/S" navigate={nav} />);
    fire("S", "browser:i:42");
    expect(nav).toHaveBeenCalledTimes(1);
    expect(nav.mock.calls[0][0]).toBe("/session/S/editor?tab=browser%3Ai%3A42");
  });
  it.each(["/session/T", "/settings", "/"])("on %s → no navigation", (pathname) => {
    const nav = vi.fn();
    render(<Host pathname={pathname} navigate={nav} />);
    fire("S", "browser:i:42");
    expect(nav).not.toHaveBeenCalled();
  });
  it("malformed detail is ignored", () => {
    const nav = vi.fn();
    render(<Host pathname="/session/S" navigate={nav} />);
    fire("S", 5 as unknown as string);
    expect(nav).not.toHaveBeenCalled();
  });
});
