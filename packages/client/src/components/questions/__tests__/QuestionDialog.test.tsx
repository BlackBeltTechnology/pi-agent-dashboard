/**
 * QuestionDialog (test-plan #F4, #F5, #F6 dialog half, text-only answers,
 * plain-text rendering). See change: add-pending-question-stack.
 */
import type { QuestionDetail } from "@blackbelt-technology/pi-dashboard-shared/question-types.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import { sweepPromptDrafts } from "../../../hooks/useDraftSweep.js";
import {
  getPromptDraftImages,
  hasPromptDraft,
  PROMPT_DRAFT_DEBOUNCE_MS,
  promptDraftStats,
  resetPromptDraftMemory,
  setPromptDraftImages,
} from "../../../lib/state/prompt-draft-storage.js";
import { InputRenderer } from "../../interactive-renderers/InputRenderer.js";
import { SelectRenderer } from "../../interactive-renderers/SelectRenderer.js";
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

// test-plan #F9 #X1 — See change: add-ask-user-inline-other
describe("inline Other in the dialog", () => {
  const opted = () => detail({ id: "q1", allowOther: true });
  const serveOk = () => serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(opted())));

  it("F9: Escape inside the Other field collapses it only; the next Escape closes; Enter posts the text", async () => {
    serveOk();
    const { onClose } = open(opted());
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    const field = screen.getByRole("textbox", { name: "Other answer" });
    fireEvent.change(field, { target: { value: "C" } });
    fireEvent.keyDown(field, { key: "Escape" });
    expect(screen.queryByRole("textbox", { name: "Other answer" })).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("question-dialog")).toBeTruthy();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("F9: Enter in the Other field posts {answer}", async () => {
    serveOk();
    const { onClose } = open(opted());
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    const field = screen.getByRole("textbox", { name: "Other answer" });
    fireEvent.change(field, { target: { value: "C" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: "C" });
  });

  it("a prompt without the opt-in shows no Other row", async () => {
    serve(() => ok(detail({ id: "q1" })));
    open(detail({ id: "q1" }));
    await settle();
    expect(screen.queryByTestId("other-option")).toBeNull();
  });

  it("X1: a 400 from a stale server keeps the dialog open and shows the error", async () => {
    serve((url, init) => (init?.method === "POST" ? err(400, "answer is not one of the options") : ok(opted())));
    const { onClose } = open(opted());
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    const field = screen.getByRole("textbox", { name: "Other answer" });
    fireEvent.change(field, { target: { value: "C" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("question-answer-error")).toBeTruthy());
    expect(screen.getByTestId("question-answer-error").textContent).toContain("answer is not one of the options");
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByTestId("question-dialog")).toBeTruthy();
  });
});

// See change: fix-input-state-consistency (#1116, S26).
describe("own Other collapses in the dialog", () => {
  it("S26: opted-in select listing its own Other shows only the inline row; typed text posts as the answer", async () => {
    const d = detail({ id: "q1", allowOther: true, options: ["Approve", "Other (describe)"] });
    serve((url, init) => (init?.method === "POST" ? ok({ transmitted: true }) : ok(d)));
    const { onClose } = open(d);
    await settle();
    expect(screen.queryByText("Other (describe)")).toBeNull();
    expect(screen.getByText("Approve")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    const field = screen.getByRole("textbox", { name: "Other answer" });
    fireEvent.change(field, { target: { value: "later" } });
    fireEvent.keyDown(field, { key: "Enter" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ answer: "later" });
  });
});

// See change: fix-input-state-consistency (#1117): prompt-draft sharing between the chat card and the dialog.
describe("prompt drafts shared across surfaces", () => {
  beforeEach(() => {
    sessionStorage.clear();
    resetPromptDraftMemory();
  });
  afterEach(() => {
    sessionStorage.clear();
    resetPromptDraftMemory();
  });

  const optedDetail = (over: Partial<QuestionDetail> = {}) =>
    detail({ id: "q1", promptId: "p1", sessionId: "s1", allowOther: true, options: ["A", "B"], ...over });
  const card = (props: Record<string, unknown> = {}) => (
    <SelectRenderer
      requestId="p1"
      sessionId="s1"
      method="select"
      params={{ title: "Pick", options: ["A", "B"], allowOther: true }}
      status="pending"
      onRespond={() => {}}
      onCancel={() => {}}
      {...props}
    />
  );
  const otherField = () => screen.getByRole("textbox", { name: "Other answer" }) as HTMLInputElement;

  it("S47: the dialog initialises from the card's Other text (key = detail.sessionId + detail.promptId, not the store id)", async () => {
    const cardView = render(card());
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(otherField(), { target: { value: "foo" } });
    cardView.unmount();
    serve(() => ok(optedDetail()));
    open(optedDetail());
    await settle();
    expect(otherField().value).toBe("foo");
  });

  it("S48: latest edit wins; a surface that never edited never writes", async () => {
    const cardView = render(card());
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(otherField(), { target: { value: "a" } });
    serve(() => ok(optedDetail()));
    const first = open(optedDetail());
    await settle();
    expect(screen.getAllByRole("textbox", { name: "Other answer" })).toHaveLength(2);
    // The card is edited AFTER the dialog mounted.
    fireEvent.change(screen.getAllByRole("textbox", { name: "Other answer" })[0], { target: { value: "ab" } });
    first.view.unmount();
    serve(() => ok(optedDetail()));
    open(optedDetail());
    await settle();
    const dialogField = within(screen.getByRole("dialog")).getByRole("textbox", { name: "Other answer" }) as HTMLInputElement;
    expect(dialogField.value).toBe("ab");
    cardView.unmount();
  });

  it("S50: images are not restored in the dialog and its image map is neither read nor written", async () => {
    setPromptDraftImages("s1", "p1", -1, [{ type: "image", data: "AAA", mimeType: "image/png" }]);
    const before = promptDraftStats().imageEntries;
    const cardView = render(
      <InputRenderer requestId="p1" sessionId="s1" method="input" params={{ title: "t" }} status="pending" onRespond={() => {}} onCancel={() => {}} />,
    );
    expect(cardView.container.querySelectorAll("img.h-16")).toHaveLength(1); // the card restores it
    fireEvent.change(cardView.container.querySelector("textarea") as HTMLTextAreaElement, { target: { value: "t" } });
    cardView.unmount();
    const d = detail({ id: "q1", promptId: "p1", sessionId: "s1", type: "input", options: undefined });
    serve(() => ok(d));
    open(d);
    await settle();
    const dlg = screen.getByRole("dialog");
    expect((dlg.querySelector("textarea") as HTMLTextAreaElement).value).toBe("t");
    expect(dlg.querySelectorAll("img.h-16")).toHaveLength(0);
    expect(promptDraftStats().imageEntries).toBe(before);
    expect(getPromptDraftImages("s1", "p1")).toHaveLength(1);
  });

  it("an old server's detail without promptId is ephemeral: nothing persisted, nothing shared", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const d = optedDetail({ promptId: undefined });
      serve(() => ok(d));
      open(d);
      await settle();
      fireEvent.click(screen.getByRole("button", { name: "Other" }));
      fireEvent.change(otherField(), { target: { value: "x" } });
      vi.advanceTimersByTime(PROMPT_DRAFT_DEBOUNCE_MS * 2);
      expect(Object.keys(sessionStorage).filter((k) => k.startsWith("ask-draft:"))).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("S59/S72: a failed delivery keeps the draft (store + sessionStorage) and the typed text", async () => {
    const d = optedDetail();
    serve((url, init) => (init?.method === "POST" ? err(500, "boom") : ok(d)));
    const { onClose } = open(d);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(otherField(), { target: { value: "keep me" } });
    fireEvent.keyDown(otherField(), { key: "Enter" });
    await waitFor(() => expect(screen.getByTestId("question-answer-error")).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();
    expect(hasPromptDraft("s1", "p1")).toBe(true);
    window.dispatchEvent(new Event("pagehide")); // flush the debounced mirror now
    expect(sessionStorage.getItem("ask-draft:s1:p1")).toContain("keep me");
    expect(otherField().value).toBe("keep me");
  });

  it("S73: a slow answer keeps the draft until the request leaves `pending` — cleared by state, not at the click", async () => {
    const d = optedDetail();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    serve(async (url, init) => {
      if (init?.method === "POST") {
        await gate;
        return ok({ transmitted: true });
      }
      return ok(d);
    });
    const { onClose } = open(d);
    await settle();
    fireEvent.click(screen.getByRole("button", { name: "Other" }));
    fireEvent.change(otherField(), { target: { value: "slow" } });
    fireEvent.keyDown(otherField(), { key: "Enter" });
    await settle();
    expect(hasPromptDraft("s1", "p1")).toBe(true); // in flight
    release();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(hasPromptDraft("s1", "p1")).toBe(true); // still pending in state: the dialog itself never clears
    sweepPromptDrafts(new Map([["s1", { interactiveRequests: [{ requestId: "p1", method: "select", params: {}, status: "resolved" as const }] }]]));
    expect(hasPromptDraft("s1", "p1")).toBe(false);
  });
});
