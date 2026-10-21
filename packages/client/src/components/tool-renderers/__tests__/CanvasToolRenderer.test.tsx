/**
 * CanvasToolRenderer — declared target, error line, active-only link.
 * See change: improve-canvas-html-and-url-ux (test-plan #E30, tool-renderers spec).
 */
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SplitWorkspaceProvider } from "../../split/SplitWorkspaceContext.js";
import { CanvasToolRenderer } from "../CanvasToolRenderer.js";
import { getToolRenderer } from "../registry.js";
import type { ToolContext, ToolRendererProps } from "../types.js";

vi.mock("../../../lib/canvas/probe-loopback.js", () => ({ probeLoopbackServer: vi.fn(async () => "iframe") }));

afterEach(() => cleanup());

const ctx = (canvas: ToolContext["canvas"]): ToolContext => ({ cwd: "/proj", sessionId: "s1", canvas });

function card(props: Partial<ToolRendererProps> & Pick<ToolRendererProps, "args" | "toolCallId">, canvas: ToolContext["canvas"]) {
  return render(
    <SplitWorkspaceProvider sessionId="sCard" cwd="/proj" orientation="h">
      <CanvasToolRenderer toolName="canvas" status="complete" result='{"ok":true}' context={ctx(canvas)} {...props} />
    </SplitWorkspaceProvider>,
  );
}

// An active card renders its target as a button (an in-app action, not a navigation).
const isLink = (el: HTMLElement) => el.tagName === "BUTTON";

describe("CanvasToolRenderer (E30)", () => {
  it("file declare: title, file icon, path; no raw JSON ack; active card has a link", () => {
    const { container } = card(
      { toolCallId: "c1", args: { target: { kind: "file", path: "mockups/a/index.html" }, title: "Mockup" } },
      { key: "file:/proj:mockups/a/index.html", sourceCallId: "c1" },
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Mockup");
    expect(text).toContain("mockups/a/index.html");
    expect(text).not.toContain('{"ok":true}');
    expect(screen.getByRole("img", { name: "File target" })).toBeTruthy();
    expect(isLink(screen.getByTestId("canvas-tool-target"))).toBe(true);
    expect(screen.getByTestId("canvas-tool-card").getAttribute("data-active")).toBe("true");
  });

  it("url declare: active card links the URL", () => {
    card({ toolCallId: "c2", args: { target: { kind: "url", url: "https://example.com/doc" } } }, { key: "url:https://example.com/doc", sourceCallId: "c2" });
    expect(screen.getByRole("img", { name: "URL target" })).toBeTruthy();
    expect(isLink(screen.getByTestId("canvas-tool-target"))).toBe(true);
  });

  it("server declare shows :port; active when it owns the chip", () => {
    card({ toolCallId: "c3", args: { target: { kind: "server", port: 5173 } } }, { key: "server:5173", chipDeclarationId: "c3" });
    const target = screen.getByTestId("canvas-tool-target");
    expect(target.textContent).toBe(":5173");
    expect(isLink(target)).toBe(true);
    expect(screen.getByRole("img", { name: "Server target" })).toBeTruthy();
    // A pending server declare says nothing was fetched yet.
    expect(screen.getByTestId("canvas-tool-unconfirmed")).toBeTruthy();
  });

  it("{ok:false,error} renders an error line with role=alert and no link", () => {
    card(
      { toolCallId: "c4", result: '{"ok":false,"error":"canvas: url target must be a valid URL"}', args: { target: { kind: "url", url: "nope" } } },
      { key: null, sourceCallId: "c4" },
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("canvas: url target must be a valid URL");
    expect(isLink(screen.getByTestId("canvas-tool-target"))).toBe(false);
    expect(screen.getByTestId("canvas-tool-card").getAttribute("data-active")).toBe("false");
  });

  it("a superseded file card is plain text (and says why)", () => {
    card(
      { toolCallId: "old", args: { target: { kind: "file", path: "a.html" } } },
      { key: "file:/proj:b.html", sourceCallId: "new" },
    );
    expect(isLink(screen.getByTestId("canvas-tool-target"))).toBe(false);
    expect(screen.getByTestId("canvas-tool-superseded")).toBeTruthy();
    expect(screen.queryByTestId("canvas-tool-open")).toBeNull();
  });

  it("two cards declaring the same URL: only the later one links", () => {
    const canvas = { key: "url:https://example.com/", sourceCallId: "second" };
    const args = { target: { kind: "url", url: "https://example.com/" } };
    render(
      <SplitWorkspaceProvider sessionId="sCard2" cwd="/proj" orientation="h">
        <div data-testid="first">
          <CanvasToolRenderer toolName="canvas" toolCallId="first" status="complete" result='{"ok":true}' args={args} context={ctx(canvas)} />
        </div>
        <div data-testid="second">
          <CanvasToolRenderer toolName="canvas" toolCallId="second" status="complete" result='{"ok":true}' args={args} context={ctx(canvas)} />
        </div>
      </SplitWorkspaceProvider>,
    );
    expect(isLink(within(screen.getByTestId("first")).getByTestId("canvas-tool-target"))).toBe(false);
    expect(isLink(within(screen.getByTestId("second")).getByTestId("canvas-tool-target"))).toBe(true);
  });

  it("with no session canvas at all (e.g. after a restart) every card is plain, no Superseded pill", () => {
    card({ toolCallId: "c9", args: { target: { kind: "file", path: "a.html" } } }, undefined);
    expect(isLink(screen.getByTestId("canvas-tool-target"))).toBe(false);
    expect(screen.queryByTestId("canvas-tool-superseded")).toBeNull();
  });

  it("outside a split workspace the target is plain even when active", () => {
    render(
      <CanvasToolRenderer
        toolName="canvas"
        toolCallId="c1"
        status="complete"
        result='{"ok":true}'
        args={{ target: { kind: "file", path: "a.html" } }}
        context={ctx({ key: "file:/proj:a.html", sourceCallId: "c1" })}
      />,
    );
    expect(isLink(screen.getByTestId("canvas-tool-target"))).toBe(false);
  });

  it("code-styled target text carries the unified code font-size class", () => {
    card({ toolCallId: "c1", args: { target: { kind: "file", path: "a.html" } } }, { key: "k", sourceCallId: "c1" });
    expect(screen.getByTestId("canvas-tool-target").className.split(/\s+/)).toContain("text-code");
  });

  it("the registry maps `canvas` to the (lazy) CanvasToolRenderer, not the generic JSON dump", async () => {
    const Registered = getToolRenderer("canvas");
    expect(Registered).not.toBe(getToolRenderer("some_unmapped_tool"));
    render(
      <SplitWorkspaceProvider sessionId="sCard" cwd="/proj" orientation="h">
        <Registered
          toolName="canvas"
          toolCallId="c9"
          status="complete"
          result='{"ok":true}'
          args={{ target: { kind: "file", path: "a.html" }, title: "Via registry" }}
          context={ctx({ key: "k", sourceCallId: "c9" })}
        />
      </SplitWorkspaceProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("canvas-tool-card").textContent).toContain("Via registry"));
    expect(screen.getByTestId("canvas-tool-card").textContent).not.toContain('{"ok":true}');
  });
});
