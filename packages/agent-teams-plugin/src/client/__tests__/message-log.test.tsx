// @vitest-environment jsdom
/**
 * MessageLog (test-plan S18 filters, S19 rows, S120 generic kind, S122 tail
 * indicator, S61 inert text, follow-newest tolerance): plain-text log of the team mail.
 * See change: add-agent-teams-ui.
 */
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FOLLOW_TOLERANCE_PX, MAIL_TEXT_BOUND, MessageLog, matchesMember } from "../MessageLog.js";
import { mail, member, snap } from "./view-fixtures.js";

afterEach(cleanup);
const rows = () => screen.queryAllByTestId("team-mail-row");
const log = (s = snap()) => render(<MessageLog snap={s} />);
const pick = (v: string) => fireEvent.change(screen.getByLabelText("Member"), { target: { value: v } });
const urgentToggle = () => screen.getByRole("button", { name: /Urgent only/ });

const twelve = () => [
  mail(1, { from: "alice", to: "bob" }),
  mail(2, { from: "bob", to: "lead" }),
  mail(3, { from: "alice", to: "lead" }),
  mail(4, { from: "lead", to: "*", kind: "broadcast" }),
  mail(5, { from: "alice", to: "lead", priority: "urgent" }),
  mail(6, { from: "bob", to: "alice", priority: "urgent" }),
  mail(7, { from: "carol", to: "lead", priority: "urgent" }),
  mail(8, { from: "alice", to: "lead", ackedAt: undefined }),
  mail(9, { from: "carol", to: "alice", ackedAt: undefined }),
  mail(10, { from: "alice", to: "lead" }),
  mail(11, { from: "alice", to: "lead" }),
  mail(12, { from: "alice", to: "lead" }),
];
const s12 = () => snap({ members: [member("alice"), member("bob"), member("carol")], mail: twelve(), mailTotal: 12 });

describe("filters (S18)", () => {
  it("member filter keeps mails sent by or to the member; broadcasts count as sent to every member", () => {
    log(s12());
    expect(rows()).toHaveLength(12);
    pick("bob");
    // 1 (alice→bob), 2 (bob→lead), 4 (broadcast), 6 (bob→alice)
    expect(rows().map((r) => r.querySelector("[data-testid=team-mail-text]")?.textContent)).toEqual(["text 1", "text 2", "text 4", "text 6"]);
  });

  it("urgent-only keeps priority urgent rows, each with the text marker; combos AND", () => {
    log(s12());
    fireEvent.click(urgentToggle());
    expect(rows()).toHaveLength(3);
    for (const r of rows()) expect(within(r).getByTestId("team-mail-urgent").textContent).toContain("Urgent");
    pick("carol");
    expect(rows()).toHaveLength(1); // only #7 is urgent AND involves carol (the normal broadcast #4 is filtered out by urgency)
  });

  it("matchesMember is the single rule", () => {
    expect(matchesMember({ from: "a", to: "*" }, "z")).toBe(true);
    expect(matchesMember({ from: "a", to: "b" }, "z")).toBe(false);
    expect(matchesMember({ from: "z", to: "b" }, "z")).toBe(true);
  });

  it("filtered-empty shows 'no match', distinct from 'no messages'", () => {
    log(snap({ members: [member("alice")], mail: [mail(1, { from: "alice", to: "lead" })], mailTotal: 1 }));
    fireEvent.click(urgentToggle());
    expect(screen.getByTestId("team-log-nomatch").textContent).toContain("No messages match");
    cleanup();
    log(snap({ mail: [], mailTotal: 0 }));
    expect(screen.getByTestId("team-log-empty").textContent).toContain("No messages yet");
  });

  it("a filter on a member that vanishes resets to all with an inline note", () => {
    const s = snap({ members: [member("alice"), member("bob")], mail: [mail(1, { from: "bob", to: "lead" }), mail(2, { from: "alice", to: "lead" })], mailTotal: 2 });
    const { rerender } = log(s);
    pick("bob");
    expect(rows()).toHaveLength(1);
    rerender(<MessageLog snap={{ ...s, members: [member("alice")] }} />);
    expect(rows()).toHaveLength(2);
    expect(screen.getByTestId("team-log-vanished").textContent).toContain("bob left the team");
    expect((screen.getByLabelText("Member") as HTMLSelectElement).value).toBe("all");
  });
});

describe("rows (S19)", () => {
  it("'not yet acknowledged' iff ackedAt is absent", () => {
    log(snap({ mail: [mail(1, { ackedAt: undefined }), mail(2)], mailTotal: 2 }));
    const [a, b] = rows();
    expect(a?.textContent).toContain("not yet acknowledged");
    expect(b?.textContent).not.toContain("not yet acknowledged");
  });

  it("an invalid timestamp shows a placeholder, never 'Invalid Date'", () => {
    log(snap({ mail: [mail(1, { createdAt: Number.NaN }), mail(2, { createdAt: undefined as never }), mail(3, { createdAt: 8.64e15 + 1 })], mailTotal: 3 }));
    expect(document.body.textContent).not.toContain("Invalid Date");
    expect(screen.getAllByText("time unknown")).toHaveLength(3);
    expect(document.querySelectorAll("time")).toHaveLength(0);
  });

  it("text ≤ 400 chars inline, 401 → per-row disclosure bounded to 400 + ellipsis", () => {
    log(snap({ mail: [mail(1, { text: "a".repeat(MAIL_TEXT_BOUND - 1) }), mail(2, { text: "b".repeat(MAIL_TEXT_BOUND) }), mail(3, { text: "c".repeat(MAIL_TEXT_BOUND + 1) })], mailTotal: 3 }));
    const [r1, r2, r3] = rows() as HTMLElement[];
    expect(within(r1 as HTMLElement).queryByRole("button")).toBeNull();
    expect(within(r2 as HTMLElement).queryByRole("button")).toBeNull();
    const toggle = within(r3 as HTMLElement).getByRole("button", { name: "Show more" });
    expect(within(r3 as HTMLElement).getByTestId("team-mail-text").textContent).toBe(`${"c".repeat(MAIL_TEXT_BOUND)}…`);
    fireEvent.click(toggle);
    expect(within(r3 as HTMLElement).getByTestId("team-mail-text").textContent).toBe("c".repeat(MAIL_TEXT_BOUND + 1));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
  });

  it("equal timestamps keep the snapshot array order", () => {
    const t = Date.UTC(2026, 0, 1);
    log(snap({ mail: [mail(5, { createdAt: t, text: "first" }), mail(2, { createdAt: t, text: "second" }), mail(9, { createdAt: t, text: "third" })], mailTotal: 3 }));
    expect(rows().map((r) => r.querySelector("[data-testid=team-mail-text]")?.textContent)).toEqual(["first", "second", "third"]);
  });
});

describe("generic kind row (S120)", () => {
  it("lock_grant, plan_request and a never-seen kind render kind label, sender, recipient and body as text", () => {
    log(snap({ mail: [mail(1, { kind: "lock_grant", from: "server", to: "bob", text: "granted" }), mail(2, { kind: "plan_request", text: "plan?" }), mail(3, { kind: "never_seen_x", text: "?" })], mailTotal: 3 }));
    const kinds = screen.getAllByTestId("team-mail-kind").map((k) => k.textContent);
    expect(kinds).toEqual(["lock grant", "plan request", "never seen x"]);
    const r = rows()[0] as HTMLElement;
    expect(r.textContent).toContain("server");
    expect(r.textContent).toContain("bob");
    expect(r.textContent).toContain("granted");
    expect(rows().every((x) => (x.textContent ?? "").trim() !== "")).toBe(true);
  });

  it("known kinds use their translated label", () => {
    log(snap({ mail: [mail(1, { kind: "shutdown_request" })], mailTotal: 1 }));
    expect(screen.getByTestId("team-mail-kind").textContent).toBe("Shutdown request");
  });
});

describe("tail indicator (S122)", () => {
  const withTotal = (total: number | undefined, n = 100) => snap({ mail: Array.from({ length: n }, (_, i) => mail(i + 1)), mailTotal: total as number });
  it("mailTotal = length → no indicator", () => {
    log(withTotal(100));
    expect(screen.queryByTestId("team-log-scope")).toBeNull();
  });
  it.each([101, 5000])("mailTotal %i → 'Showing last 100 messages' (N = list length)", (total) => {
    log(withTotal(total));
    expect(screen.getByTestId("team-log-scope").textContent).toBe("Showing last 100 messages");
  });
  it("no mailTotal → the static 'recent messages' text, never a number", () => {
    log(withTotal(undefined, 7));
    expect(screen.getByTestId("team-log-scope").textContent).toBe("recent messages");
  });
});

describe("follow newest (8 px tolerance)", () => {
  function scrollerWith(top: number, height: number, client: number) {
    const el = screen.getByTestId("team-log-scroller");
    Object.defineProperty(el, "scrollHeight", { configurable: true, value: height });
    Object.defineProperty(el, "clientHeight", { configurable: true, value: client });
    el.scrollTop = top;
    fireEvent.scroll(el);
    return el;
  }
  it("scrolled up: no jump and a 'New messages' button; click scrolls to the end", () => {
    const s = snap({ mail: [mail(1), mail(2)], mailTotal: 2 });
    const { rerender } = log(s);
    const el = scrollerWith(0, 1000, 300);
    act(() => rerender(<MessageLog snap={{ ...s, mail: [...s.mail, mail(3)], mailTotal: 3 }} />));
    expect(el.scrollTop).toBe(0);
    fireEvent.click(screen.getByTestId("team-log-new"));
    expect(el.scrollTop).toBe(1000);
    expect(screen.queryByTestId("team-log-new")).toBeNull();
  });

  it(`within ${FOLLOW_TOLERANCE_PX}px of the bottom counts as at the end (follows); 9 px does not`, () => {
    const s = snap({ mail: [mail(1), mail(2)], mailTotal: 2 });
    const a = log(s);
    const el = scrollerWith(1000 - 300 - FOLLOW_TOLERANCE_PX, 1000, 300);
    act(() => a.rerender(<MessageLog snap={{ ...s, mail: [...s.mail, mail(3)], mailTotal: 3 }} />));
    expect(screen.queryByTestId("team-log-new")).toBeNull();
    expect(el.scrollTop).toBe(1000);
    cleanup();
    const b = log(s);
    scrollerWith(1000 - 300 - FOLLOW_TOLERANCE_PX - 1, 1000, 300);
    act(() => b.rerender(<MessageLog snap={{ ...s, mail: [...s.mail, mail(3)], mailTotal: 3 }} />));
    expect(screen.getByTestId("team-log-new")).toBeTruthy();
  });
});

describe("inert peer text (S61)", () => {
  it("mail text, sender and recipient are literal", () => {
    const evil = "<img src=x onerror=alert(1)> **b** [x](javascript:alert(1)) https://evil.example/";
    log(snap({ mail: [mail(1, { text: evil, from: evil, to: evil })], mailTotal: 1 }));
    const r = rows()[0] as HTMLElement;
    expect(r.querySelector("[data-testid=team-mail-text]")?.textContent).toBe(evil);
    expect(r.querySelector("img,script,a,b,strong")).toBeNull();
  });
});
