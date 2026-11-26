// @vitest-environment jsdom
/**
 * Stop member / Shut down team (test-plan S102 confirm dialog, S109 403, S110
 * 409/404, S111 stall, S112 connection drop): confirmation through
 * `ui:confirm-dialog`, exactly one POST, inline notes, no toasts, never auto-retried.
 * See change: add-agent-teams-ui.
 */
import { act, cleanup, fireEvent, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { noteOf } from "../team-controls.js";
import { CONTROL_TIMEOUT_MS } from "../teams-store.js";
import { flush, type Mounted, mountView } from "./team-view-harness.js";
import { member, snap } from "./view-fixtures.js";

let m: Mounted | undefined;
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  m?.unmount();
  m = undefined;
  cleanup();
  vi.useRealTimers();
});

const live = () => snap({ members: [member("alice", "busy", { sessionId: "S-a" })] });
const stopBtn = () => screen.getByTestId("team-member-stop") as HTMLButtonElement;
const shutBtn = () => screen.getByTestId("team-shutdown") as HTMLButtonElement;
const json = (body: unknown, status: number) => new Response(JSON.stringify(body), { status });

describe("confirm dialog (S102)", () => {
  it("Shut down opens the dialog stating the consequence and that the lead stays open; Cancel → zero POST, focus back", async () => {
    m = await mountView(live());
    fireEvent.click(shutBtn());
    expect(screen.getByTestId("confirm-dialog").textContent).toContain("The lead session stays open");
    expect(m.confirms[0]).toContain("loses its unfinished work");
    fireEvent.click(screen.getByTestId("confirm-cancel"));
    await flush();
    expect(screen.queryByTestId("confirm-dialog")).toBeNull();
    expect(m.server.posts()).toEqual([]);
    expect(document.activeElement).toBe(shutBtn());
  });

  it("Confirm → exactly one POST even when clicked twice; the button is disabled while pending; focus returns", async () => {
    let answer: (r: Response) => void = () => undefined;
    m = await mountView(live(), { post: () => new Promise<Response>((r) => (answer = r)) });
    fireEvent.click(shutBtn());
    const ok = screen.getByTestId("confirm-ok");
    fireEvent.click(ok);
    fireEvent.click(ok);
    await flush();
    expect(m.server.posts()).toHaveLength(1);
    expect(m.server.posts()[0]).toMatch(/\/teams\/t1\/shutdown$/);
    expect(shutBtn().disabled).toBe(true);
    expect(shutBtn().textContent).toBe("Closing…");
    fireEvent.click(shutBtn());
    expect(screen.queryByTestId("confirm-dialog")).toBeNull(); // a disabled button opens nothing
    await act(async () => answer(json({ closing: true }, 202)));
    await flush(600);
    expect(m.server.posts()).toHaveLength(1);
  });
});

describe("403 (S109)", () => {
  it("Stop → inline permission message on the card, button re-enabled, no retry loop, no toast", async () => {
    m = await mountView(live(), { post: () => json({ error: "forbidden" }, 403) });
    fireEvent.click(stopBtn());
    await flush();
    const err = screen.getByTestId("team-member-stop-error");
    expect(err.textContent).toContain("permission");
    expect(stopBtn().disabled).toBe(false);
    expect(stopBtn().getAttribute("aria-describedby")).toBe(err.id);
    await flush(60_000);
    expect(m.server.posts()).toHaveLength(1);
    expect(screen.queryAllByRole("alert")).toHaveLength(1);
  });

  it("Shut down → inline permission message by the header", async () => {
    m = await mountView(live(), { post: () => json({ error: "forbidden" }, 403) });
    fireEvent.click(shutBtn());
    fireEvent.click(screen.getByTestId("confirm-ok"));
    await flush();
    expect(screen.getByTestId("team-shutdown-error").textContent).toContain("permission");
    expect(shutBtn().disabled).toBe(false);
    expect(m.server.posts()).toHaveLength(1);
  });
});

describe("409 / 404 (S110)", () => {
  it.each([
    ["not_busy", "no longer working"],
    ["not_connected", "no live connection"],
  ])("Stop → 409 %s: plain-language inline text and a snapshot refresh", async (code, text) => {
    m = await mountView(live(), { post: () => json({ error: code }, 409) });
    const before = m.server.gets().length;
    fireEvent.click(stopBtn());
    await flush(600);
    expect(screen.getByTestId("team-member-stop-error").textContent).toContain(text);
    expect(screen.getByTestId("team-member-stop-error").textContent).not.toContain(code);
    expect(m.server.gets().length).toBeGreaterThan(before);
  });

  it("Shut down → 409 team_closed: inline text", async () => {
    m = await mountView(live(), { post: () => json({ error: "team_closed" }, 409) });
    fireEvent.click(shutBtn());
    fireEvent.click(screen.getByTestId("confirm-ok"));
    await flush();
    expect(screen.getByTestId("team-shutdown-error").textContent).toContain("already closed");
  });

  it("404 → the not-found state (cache dropped) because a previously resolved team now answers 404; no inline message", async () => {
    m = await mountView(live(), {
      post: () => {
        (m as Mounted).server.snapshot = undefined;
        return json({ error: "not_found" }, 404);
      },
    });
    fireEvent.click(stopBtn());
    await flush(600);
    expect(screen.getByTestId("team-not-found")).toBeTruthy();
    expect(screen.queryByTestId("team-view")).toBeNull();
  });

  it("an unexpected status shows the generic inline text, not a toast", async () => {
    m = await mountView(live(), { post: () => json({ error: "internal_error" }, 500) });
    fireEvent.click(stopBtn());
    await flush();
    expect(screen.getByTestId("team-member-stop-error").textContent).toContain("did not work");
  });

  it("one inline message per control", async () => {
    m = await mountView(snap({ members: [member("a", "busy"), member("b", "busy")] }), { post: () => json({ error: "not_busy" }, 409) });
    fireEvent.click(within(document.querySelector('[data-member="a"]') as HTMLElement).getByTestId("team-member-stop"));
    await flush();
    fireEvent.click(within(document.querySelector('[data-member="b"]') as HTMLElement).getByTestId("team-member-stop"));
    await flush();
    expect(screen.getAllByTestId("team-member-stop-error")).toHaveLength(2);
    expect(within(document.querySelector('[data-member="a"]') as HTMLElement).getAllByTestId("team-member-stop-error")).toHaveLength(1);
  });
});

describe("stall (S111)", () => {
  it("never-answering POST: disabled with a busy label; after 15 s 'no response — checking state', refetched, re-enabled, never retried; no second POST while pending", async () => {
    m = await mountView(live(), { post: () => new Promise<Response>(() => undefined) });
    fireEvent.click(stopBtn());
    await flush();
    expect(stopBtn().disabled).toBe(true);
    expect(stopBtn().textContent).toBe("Stopping…");
    fireEvent.click(stopBtn());
    await flush(CONTROL_TIMEOUT_MS - 100);
    expect(m.server.posts()).toHaveLength(1);
    const before = m.server.gets().length;
    await flush(200);
    expect(screen.getByTestId("team-member-stop-error").textContent).toContain("No response — checking state");
    expect(stopBtn().disabled).toBe(false);
    expect(m.server.gets().length).toBeGreaterThan(before);
    await flush(120_000);
    expect(m.server.posts()).toHaveLength(1);
  });
});

describe("connection drop (S112)", () => {
  it("reset after send: refetches to learn the truth and says 'could not confirm'", async () => {
    m = await mountView(live(), {
      post: () => {
        throw new TypeError("network reset");
      },
    });
    const before = m.server.gets().length;
    fireEvent.click(stopBtn());
    await flush(600);
    expect(screen.getByTestId("team-member-stop-error").textContent).toContain("Could not confirm");
    expect(m.server.gets().length).toBeGreaterThan(before);
    expect(stopBtn().disabled).toBe(false);
  });
});

describe("noteOf", () => {
  it("maps results to notes", () => {
    expect(noteOf({ kind: "ok", status: 200 })).toBeUndefined();
    expect(noteOf({ kind: "timeout" })).toBe("no_response");
    expect(noteOf({ kind: "unconfirmed" })).toBe("unconfirmed");
    expect(noteOf({ kind: "rejected", status: 403 })).toBe("forbidden");
    expect(noteOf({ kind: "rejected", status: 404 })).toBeUndefined();
    expect(noteOf({ kind: "rejected", status: 409, code: "team_closed" })).toBe("team_closed");
    expect(noteOf({ kind: "rejected", status: 409, code: "weird" })).toBe("failed");
    expect(noteOf({ kind: "rejected", status: 500 })).toBe("failed");
  });
});
