/**
 * QuestionDialog (test-plan #F4, #F5, #F6 dialog half, text-only answers,
 * plain-text rendering). See change: add-pending-question-stack.
 */
import type { QuestionDetail } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { QuestionDialog } from "../QuestionDialog.js";
import { detail, mockReducedMotion, row } from "./question-fixtures.js";

type Handler = (url: string, init?: RequestInit) => { status?: number; body: unknown } | Promise<{ status?: number; body: unknown }>;
const calls: Array<{ url: string; method: string; body?: any }> = [];

function serve(handler: Handler) {
  calls.length = 0;
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    const { status = 200, body } = await handler(url, init);
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  });
}
const ok = (data: unknown) => ({ body: { success: true, data } });
const err = (status: number, error: string, reason?: string) => ({ status, body: { success: false, error, reason } });

beforeEach(() => mockReducedMotion(false));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function open(d: QuestionDetail, extra: { gone?: boolean; onClose?: () => void; onOpenSession?: (id: string) => void } = {}) {
  const loc = memoryLocation({ path: "/", record: true });
  const onClose = extra.onClose ?? vi.fn();
  const view = render(
    <Router hook={loc.hook}>
      <QuestionDialog row={row({ id: d.id, briefStatus: d.briefStatus })} gone={extra.gone ?? false} onClose={onClose} onOpenSession={extra.onOpenSession} />
    </Router>,
  );
  return { onClose, loc, view };
}
const settle = () => act(async () => {});

describe("semantics (F6, dialog half)", () => {
  it("is a modal dialog labelled by its title; Tab wraps; Esc closes", async () => {
    serve(() => ok(detail({ id: "q1" })));
    const { onClose } = open(detail({ id: "q1" }));
    await settle();
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(document.getElementById(dlg.getAttribute("aria-labelledby") ?? "")?.textContent).toBe("Session q1");
    const focusables = [...dlg.querySelectorAll<HTMLElement>("button:not([disabled]), a[href], textarea:not([disabled])")];
    const last = focusables[focusables.length - 1];
    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(focusables[0]);
    fireEvent.keyDown(focusables[0], { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dlg, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("Esc inside an input answer box closes the dialog and does NOT cancel the question", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(detail({ id: "q1", type: "input", options: undefined }))));
    const { onClose } = open(detail({ id: "q1", type: "input" }));
    await settle();
    const box = screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("'Later' closes without answering", async () => {
    serve(() => ok(detail({ id: "q1" })));
    const { onClose } = open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByTestId("question-later"));
    expect(onClose).toHaveBeenCalled();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(0);
  });

  it("'Open session' routes to the session", async () => {
    serve(() => ok(detail({ id: "q1" })));
    const onOpenSession = vi.fn();
    open(detail({ id: "q1" }), { onOpenSession });
    await settle();
    fireEvent.click(screen.getByTestId("question-open-session"));
    expect(onOpenSession).toHaveBeenCalledWith("s-q1");
  });
});

describe("states (F4)", () => {
  it("fetches the detail lazily by id", async () => {
    serve(() => ok(detail({ id: "q1" })));
    open(detail({ id: "q1" }));
    expect(screen.getByRole("dialog")).toBeTruthy();
    await settle();
    expect(calls[0]).toMatchObject({ method: "GET", url: "/api/questions/q1" });
  });

  it("pending: Summarizing indicator, context expanded, inputs usable", async () => {
    serve(() => ok(detail({ id: "q1", briefStatus: "pending", brief: undefined, briefLabel: undefined })));
    open(detail({ id: "q1", briefStatus: "pending" }));
    await settle();
    expect(screen.getByTestId("question-brief").textContent).toContain("Summarizing");
    expect((screen.getByTestId("question-context") as HTMLDetailsElement).open).toBe(true);
    const option = screen.getByRole("button", { name: /Resume/ });
    expect((option as HTMLButtonElement).disabled).toBe(false);
    expect(option.closest("fieldset[disabled]")).toBeNull();
  });

  it("generated: label 'Generated · @fast', no Summarize", async () => {
    serve(() => ok(detail({ id: "q1", briefStatus: "ready", briefLabel: "generated", brief: "A generated brief." })));
    open(detail({ id: "q1" }));
    await settle();
    const brief = screen.getByTestId("question-brief");
    expect(brief.textContent).toContain("Generated · @fast");
    expect(brief.textContent).toContain("A generated brief.");
    expect(screen.queryByTestId("question-brief-summarize")).toBeNull();
    expect((screen.getByTestId("question-context") as HTMLDetailsElement).open).toBe(false);
  });

  it("generated-limited: label 'Limited context', no Summarize", async () => {
    serve(() => ok(detail({ id: "q1", briefStatus: "ready", briefLabel: "generated-limited", brief: "Thin brief." })));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.getByTestId("question-brief").textContent).toContain("Limited context");
    expect(screen.queryByTestId("question-brief-summarize")).toBeNull();
  });

  it("provided: 'From the agent' + Summarize", async () => {
    serve(() => ok(detail({ id: "q1" })));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.getByTestId("question-brief").textContent).toContain("From the agent");
    expect(screen.getByTestId("question-brief-summarize")).toBeTruthy();
  });

  it("failed/unavailable brief: no brief text, Summarize offered", async () => {
    serve(() => ok(detail({ id: "q1", briefStatus: "failed", brief: undefined, briefLabel: undefined })));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.getByTestId("question-brief-summarize")).toBeTruthy();
  });

  it("answered elsewhere (row vanished): info callout + inputs disabled", async () => {
    serve(() => ok(detail({ id: "q1" })));
    open(detail({ id: "q1" }), { gone: true });
    await settle();
    expect(screen.getByTestId("question-answered").textContent).toMatch(/already answered/i);
    const option = screen.getByRole("button", { name: /Resume/ }) as HTMLButtonElement;
    expect(option.closest("fieldset")?.disabled).toBe(true);
  });

  it("a 404 on the detail fetch is shown as already answered", async () => {
    serve(() => err(404, "not found"));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.getByTestId("question-answered")).toBeTruthy();
  });

  it("file access: read-only, no inputs, link to the Access page", async () => {
    serve(() => ok(detail({ id: "q1", origin: "file", answerable: false, type: "confirm", question: "Allow read of /etc/hosts?" })));
    const { loc } = open(detail({ id: "q1", origin: "file" }));
    await settle();
    const dlg = screen.getByRole("dialog");
    expect(dlg.textContent).toContain("Allow read of /etc/hosts?");
    expect(dlg.querySelector("textarea, input, fieldset")).toBeNull();
    expect(within(dlg).queryByRole("button", { name: /^(Yes|No|Cancel)$/ })).toBeNull();
    const link = screen.getByTestId("question-access-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings/access");
    fireEvent.click(link);
    expect(loc.history?.at(-1)).toBe("/settings/access");
  });

  it("context snapshot: last assistant text, ≤5 tools one line each, workflow run, absent reasons", async () => {
    const tools = Array.from({ length: 7 }, (_, i) => ({ name: `tool${i}`, summary: `did thing ${i}` }));
    serve(() =>
      ok(
        detail({
          id: "q1",
          snapshot: { assistantText: "Line one\nLine two", toolCalls: tools, workflowRun: { name: "release", step: "gate" }, redactionVersion: 1 },
        }),
      ),
    );
    open(detail({ id: "q1" }));
    await settle();
    const ctx = screen.getByTestId("question-context");
    expect(ctx.textContent).toContain("Line one");
    expect(ctx.textContent).toContain("tool0");
    expect(ctx.textContent).not.toContain("tool5");
    expect(ctx.textContent).toContain("release");
    cleanup();
    serve(() => ok(detail({ id: "q1", snapshot: { assistantAbsentReason: "evicted", toolCalls: [], redactionVersion: 1 } })));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.getByTestId("question-context").textContent).toMatch(/no longer retained/i);
    cleanup();
    serve(() => ok(detail({ id: "q1", snapshot: { assistantAbsentReason: "none", toolCalls: [], redactionVersion: 1 } })));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.getByTestId("question-context").textContent).toMatch(/no assistant message/i);
  });

  it("renders the brief and snapshot as PLAIN TEXT (never markdown/HTML)", async () => {
    serve(() =>
      ok(
        detail({
          id: "q1",
          brief: "**bold** <img src=x onerror=alert(1)> [link](http://x)",
          snapshot: { assistantText: "# heading <b>b</b>", toolCalls: [{ name: "n", summary: "<i>s</i>" }], redactionVersion: 1 },
        }),
      ),
    );
    open(detail({ id: "q1" }));
    await settle();
    const dlg = screen.getByRole("dialog");
    expect(dlg.querySelector("img, b, i, strong, h1, a[href='http://x']")).toBeNull();
    expect(screen.getByTestId("question-brief").textContent).toContain("**bold** <img src=x onerror=alert(1)>");
    expect(screen.getByTestId("question-context").textContent).toContain("# heading <b>b</b>");
  });
});

describe("Summarize (F5)", () => {
  it("failure keeps the current brief + inline error + Retry; Retry success shows the generated brief and drops Summarize", async () => {
    let attempt = 0;
    serve((url, init) => {
      if (init?.method === "POST" && url.endsWith("/summarize")) {
        attempt++;
        return attempt === 1
          ? err(502, "generation timed out", "failed")
          : ok(detail({ id: "q1", briefStatus: "ready", briefLabel: "generated", brief: "Fresh generated brief." }));
      }
      return ok(detail({ id: "q1" }));
    });
    open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByTestId("question-brief-summarize"));
    await waitFor(() => expect(screen.getByTestId("question-brief-retry")).toBeTruthy());
    const brief = screen.getByTestId("question-brief");
    expect(brief.textContent).toContain("The agent is migrating the schema");
    expect(brief.textContent).toContain("From the agent");
    expect(within(brief).getByRole("alert")).toBeTruthy();
    fireEvent.click(screen.getByTestId("question-brief-retry"));
    await waitFor(() => expect(screen.getByTestId("question-brief").textContent).toContain("Fresh generated brief."));
    expect(screen.getByTestId("question-brief").textContent).toContain("Generated · @fast");
    expect(screen.queryByTestId("question-brief-summarize")).toBeNull();
    expect(screen.queryByTestId("question-brief-retry")).toBeNull();
    expect(calls.filter((c) => c.url.endsWith("/summarize"))).toHaveLength(2);
  });

  it("unavailable (503) explains why, keeps the brief", async () => {
    serve((url, init) => (init?.method === "POST" ? err(503, "unavailable", "unavailable") : ok(detail({ id: "q1" }))));
    open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByTestId("question-brief-summarize"));
    await waitFor(() => expect(within(screen.getByTestId("question-brief")).getByRole("alert").textContent).toMatch(/@fast/));
  });
});

describe("answering", () => {
  it("select option → POST {answer}; success closes the dialog", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(detail({ id: "q1" }))));
    const { onClose } = open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Hand back/ }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")).toMatchObject({ url: "/api/questions/q1/answer", body: { answer: "Hand back" } });
  });

  it("confirm encodes as \"true\"", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(detail({ id: "q1", type: "confirm", options: undefined }))));
    open(detail({ id: "q1", type: "confirm" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Yes$/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: "true" });
  });

  it("input → POST text answer, images are never sent", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(detail({ id: "q1", type: "input", options: undefined }))));
    open(detail({ id: "q1", type: "input" }));
    await settle();
    const box = screen.getByRole("dialog").querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: "hello" });
  });

  it("multiselect encodes a JSON array of options", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(detail({ id: "q1", type: "multiselect", options: ["a", "b", "c"] }))));
    open(detail({ id: "q1", type: "multiselect" }));
    await settle();
    fireEvent.click(screen.getByRole("checkbox", { name: /^b$/ }));
    fireEvent.click(screen.getByRole("button", { name: /submit/i }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: JSON.stringify(["b"]) });
  });

  it("Cancel → POST {cancelled:true}", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(detail({ id: "q1" }))));
    open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /^Cancel$/ }));
    await waitFor(() => expect(calls.some((c) => c.method === "POST")).toBe(true));
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ cancelled: true });
  });

  it("409 answered → already-answered callout + inputs disabled; dialog stays open", async () => {
    serve((url, init) => (init?.method === "POST" ? err(409, "answered") : ok(detail({ id: "q1" }))));
    const { onClose } = open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(screen.getByTestId("question-answered")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Hand back/ }).closest("fieldset") as HTMLFieldSetElement).disabled).toBe(true);
  });

  it("transmitted:false keeps the dialog open with a retry hint and usable inputs", async () => {
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: false }) : ok(detail({ id: "q1" }))));
    const { onClose } = open(detail({ id: "q1" }));
    await settle();
    fireEvent.click(screen.getByRole("button", { name: /Resume/ }));
    await waitFor(() => expect(screen.getByTestId("question-answer-error")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /Hand back/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
