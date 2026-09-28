/**
 * `DenialNotice`: the one action rule, the no-loop rule, distinct outcome copy,
 * non-denials, and "the notice never grants" (change:
 * surface-denial-remedy-in-previews, design D4/D5/D9; test-plan #E31-#E35, #E43).
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../lib/api/api-context.js", () => ({ getApiBase: () => "" }));

import { PROMPT_OUTCOMES, type PromptOutcome } from "../../../lib/access-grants/access-grants-types.js";
import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { classifyResponse, type DenialFailure } from "../denial-fetch.js";
import { DenialNotice, noticeAction } from "../DenialNotice.js";
import { ImagePreview } from "../ImagePreview.js";

const URL_ = "/api/file/raw?cwd=%2Fp&path=a.png";
const denied = (optedOut: boolean, promptOutcome?: PromptOutcome): DenialFailure => ({
  kind: "denied",
  subject: "/private/tmp/d",
  optedOut,
  ...(promptOutcome ? { promptOutcome } : {}),
});

beforeEach(() => clearGrantChannel());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearGrantChannel();
});

describe("#E31 one action rule", () => {
  const ASK_FOR_ACCESS = new Set<PromptOutcome | undefined>([undefined, "ineligible", "busy", "unanswered", "unavailable"]);
  const ASK_AGAIN = new Set<PromptOutcome>(["busy", "unanswered", "unavailable"]);

  it.each([...PROMPT_OUTCOMES, undefined])("outcome %s", (outcome) => {
    for (const canCarry of [true, false]) {
      expect(noticeAction({ result: denied(true, outcome), canCarry, asked: false })).toBe(
        canCarry && ASK_FOR_ACCESS.has(outcome) ? "ask-for-access" : null,
      );
      expect(noticeAction({ result: denied(false, outcome), canCarry, asked: false })).toBe(
        outcome !== undefined && ASK_AGAIN.has(outcome) ? "ask-again" : null,
      );
    }
  });

  it("no control for a non-denial, and none once asked", () => {
    expect(noticeAction({ result: { kind: "unknown" }, canCarry: true, asked: false })).toBeNull();
    expect(noticeAction({ result: denied(true, "ineligible"), canCarry: true, asked: true })).toBeNull();
  });

  it("renders the Settings pointer when there is no control", () => {
    render(<DenialNotice result={denied(true, "ineligible")} url={URL_} path="a.png" onAsk={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull(); // no capability → cannot carry
    expect(screen.getByText(/Settings → Access/)).toBeTruthy();
  });
});

describe("#E32 asking does not loop", () => {
  it("an eligible re-request refused without a dialog leaves no control and sends nothing more", async () => {
    setGrantChannel("cap-live");
    const bodies = [
      { success: false, error: "path outside working directory", denialId: "d1", subject: "/x", promptOutcome: "ineligible" },
      { success: false, error: "path outside working directory", denialId: "d2", subject: "/x", promptOutcome: "unavailable" },
    ];
    const fetchSpy = vi.fn(async () => new Response(JSON.stringify(bodies.shift()), { status: 403 }));
    vi.stubGlobal("fetch", fetchSpy);
    const { rerender } = render(<ImagePreview target={{ kind: "file", cwd: "/p", path: "a.png" }} variant="full" />);
    fireEvent.click(await screen.findByRole("button", { name: "Ask for access" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(2));
    await screen.findByText(/Couldn't ask for access right now/);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText(/Settings → Access/)).toBeTruthy();
    rerender(<ImagePreview target={{ kind: "file", cwd: "/p", path: "a.png" }} variant="full" />);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
});

describe("#E33 outcomes are distinct", () => {
  it("every promptOutcome renders its own preview.denial.* message", () => {
    const texts = new Map<string, PromptOutcome>();
    for (const outcome of PROMPT_OUTCOMES) {
      const { container, unmount } = render(<DenialNotice result={denied(false, outcome)} url={URL_} path="a.png" />);
      const text = container.querySelector("p")?.textContent ?? "";
      expect(texts.has(text), `${outcome} reuses ${texts.get(text)}'s copy`).toBe(false);
      texts.set(text, outcome);
      unmount();
    }
    expect(texts.size).toBe(14);
    const byOutcome = new Map([...texts].map(([text, o]) => [o, text]));
    expect(byOutcome.get("off")).not.toBe(byOutcome.get("not-enforced"));
    expect(byOutcome.get("busy")).not.toBe(byOutcome.get("throttled"));
    expect(byOutcome.get("allowed-elsewhere")).not.toBe(byOutcome.get("declined"));
  });
});

describe("#E34 non-denials stay themselves", () => {
  it("a 403 without denialId shows the server's error, with no access wording", async () => {
    const r = await classifyResponse(
      new Response(JSON.stringify({ success: false, error: "unknown session path" }), { status: 403 }),
      true,
    );
    expect(r.kind).toBe("refused");
    const { container } = render(<DenialNotice result={r as DenialFailure} url={URL_} path="a.png" onAsk={() => {}} />);
    expect(container.textContent).toContain("unknown session path");
    expect(container.textContent).not.toMatch(/access|grant|prompt/i);
  });

  it("a 404 is not-found, with no access wording", async () => {
    const r = await classifyResponse(new Response("", { status: 404 }), true);
    expect(r.kind).toBe("not-found");
    const { container } = render(<DenialNotice result={r as DenialFailure} url={URL_} path="a.png" onAsk={() => {}} />);
    expect(container.textContent).toMatch(/not found/i);
    expect(container.textContent).not.toMatch(/access|grant|prompt/i);
  });
});

describe("#E35 the notice never grants", () => {
  it("no control of any variant reaches /api/access/grants", async () => {
    setGrantChannel("cap-live");
    const fetchSpy = vi.fn(async (_u: RequestInfo | URL) => new Response("{}", { status: 403 }));
    vi.stubGlobal("fetch", fetchSpy);
    const variants: DenialFailure[] = [
      ...[...PROMPT_OUTCOMES, undefined].flatMap((o) => [denied(true, o), denied(false, o)]),
      { kind: "refused", error: "x", optedOut: true },
      { kind: "not-found" },
      { kind: "error", message: "boom" },
      { kind: "unknown" },
    ];
    for (const v of variants) {
      const { unmount } = render(<DenialNotice result={v} url={URL_} path="a.png" onAsk={() => {}} />);
      for (const b of screen.queryAllByRole("button")) fireEvent.click(b);
      unmount();
    }
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("/api/access/grants"))).toEqual([]);
  });
});

describe("#E43 a refusal without disclosure", () => {
  it("an eligible request's withheld outcome: refusal shown with no reason and no control", () => {
    setGrantChannel("cap-live");
    const { container } = render(<DenialNotice result={denied(false)} url={URL_} path="a.png" onAsk={() => {}} />);
    expect(container.textContent).toContain("Access to this file was refused.");
    expect(screen.queryByRole("button")).toBeNull();
  });
});
