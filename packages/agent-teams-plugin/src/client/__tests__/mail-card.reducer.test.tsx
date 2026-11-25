// @vitest-environment jsdom
/**
 * Mail cards through the REAL reducer and the REAL `CustomEntryRow` (test-plan S1
 * round trip, S4 / S5 header cut by the host caps, S87 no request / ignored payload,
 * S89 batched mails and replay). See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CORE_MAIL_KINDS, customTypeForKind, formatEnvelope, formatMail } from "../../shared/mail-format.js";
import { MailEntryCard } from "../MailEntryCard.js";
import { hostRow, hostRows, reduceCustom, rowOf } from "./host-row.js";

afterEach(cleanup);
const card = () => screen.getByTestId("team-mail-card");
const bodyText = () => screen.getByTestId("team-mail-body").textContent;

const KIND_LABEL: Record<string, string> = { message: "Message", broadcast: "Broadcast", task_assigned: "Task assigned", shutdown_request: "Shutdown request", shutdown_response: "Shutdown response", spawn_prompt: "Teammate prompt" };

describe("S1 — every core kind × urgent through reducer → CustomEntryRow → card", () => {
  const TEXT = "héllo\nline2";
  /** Per core kind: card title, whether a kind chip and a sender chip show, and how the body compares. */
  const VARIANT: Record<string, { title: string; kindChip: boolean; senderChip: boolean; exactBody: boolean }> = {
    idle: { title: "Teammate bob reported idle", kindChip: false, senderChip: false, exactBody: true },
    notice: { title: "Team notice", kindChip: false, senderChip: true, exactBody: false },
  };
  const plain = { title: "Agent message", kindChip: true, senderChip: true, exactBody: true };
  const rows = CORE_MAIL_KINDS.flatMap((kind) => [false, true].map((urgent) => ({ kind, urgent, name: `${kind} urgent=${urgent}` })));

  it.each(rows)("$name", ({ kind, urgent }) => {
    const v = VARIANT[kind] ?? plain;
    hostRow(formatMail({ kind, sender: "bob", urgent, text: TEXT }), customTypeForKind(kind));
    expect(screen.getByTestId("team-mail-title").textContent).toBe(v.title);
    expect(screen.queryByTestId("team-mail-kind")?.textContent).toBe(v.kindChip ? (KIND_LABEL[kind] ?? kind.replace(/_/g, " ")) : undefined);
    expect(screen.queryByTestId("team-mail-sender")?.textContent).toBe(v.senderChip ? "Teammate bob" : undefined);
    expect(screen.queryByTestId("team-mail-urgent") !== null).toBe(urgent);
    expect(v.exactBody ? bodyText() === TEXT : (bodyText() ?? "").includes("héllo")).toBe(true);
    expect(card().getAttribute("aria-label")).toContain("Agent message from Teammate bob");
  });

  it("the lead and the server are labelled by role", () => {
    hostRow(formatMail({ kind: "message", sender: "lead", text: "x" }));
    expect(screen.getByTestId("team-mail-sender").textContent).toBe("Lead");
    cleanup();
    hostRow(formatMail({ kind: "message", sender: "server", text: "x" }));
    expect(screen.getByTestId("team-mail-sender").textContent).toBe("Server");
  });
});

describe("S4 — header cut by the host's 200-line cap (199/200/201/5 000)", () => {
  const body = (n: number) => `${formatEnvelope({ kind: "message", sender: "bob" })}\n${Array.from({ length: n - 1 }, (_, i) => `line ${i}`).join("\n")}`;
  it.each([199, 200])("N=%i → the sender is named", (n) => {
    hostRow(body(n));
    expect(screen.getByTestId("team-mail-sender").textContent).toBe("Teammate bob");
    expect(screen.getByTestId("team-mail-title").textContent).toBe("Agent message");
  });
  it.each([201, 5000])("N=%i → 'header truncated', no sender, remaining text inert", (n) => {
    const row = rowOf(body(n));
    expect(row.content).toMatch(/^«\d+ earlier lines? hidden»/);
    hostRows([row]);
    expect(screen.getByTestId("team-mail-title").textContent).toBe("Agent message — header truncated");
    expect(screen.queryByTestId("team-mail-sender")).toBeNull();
    expect(card().querySelector("a,img,button[role=link]")).toBeNull();
  });
});

describe("S5 — header cut by the 64 000-char tail cap (63 999/64 000/64 001)", () => {
  const withHeader = (text: string) => `${formatEnvelope({ kind: "message", sender: "bob" })}\n${text}`;
  it("the sender is named while the whole body (header included) stays within 64 000", () => {
    const header = formatEnvelope({ kind: "message", sender: "bob" }).length + 1;
    const row = rowOf(withHeader("a".repeat(64_000 - header)));
    expect(row.content?.length).toBeLessThanOrEqual(64_000);
    hostRows([row]);
    expect(screen.getByTestId("team-mail-sender").textContent).toBe("Teammate bob");
  });
  it.each([64_001, 200_000])("a %i-char one-liner loses its header: 'unrecognised', no sender, no throw", (n) => {
    const row = rowOf(withHeader("a".repeat(n)));
    expect(row.content?.length).toBeLessThanOrEqual(64_001 + 64);
    expect(() => hostRows([row])).not.toThrow();
    expect(screen.queryByTestId("team-mail-sender")).toBeNull();
    expect(screen.getByTestId("team-mail-title").textContent).toMatch(/Unrecognised agent message|header truncated/);
  });
});

describe("S87 — no request, payload props ignored", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    fetchSpy = vi.fn(async () => new Response("{}"));
    vi.stubGlobal("fetch", fetchSpy);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("a mail row without entryId: zero fetch on render, expand and collapse", () => {
    hostRow(formatMail({ kind: "message", sender: "bob", text: "hi" }));
    const toggle = screen.getByTestId("team-mail-toggle");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("payload, payloadError and payloadLoading change nothing in the output", () => {
    const body = formatMail({ kind: "message", sender: "bob", text: "hi" });
    const base = { customType: "agent-teams-mail", body, timestamp: 1_700_000_000_000, expanded: true, onToggle: () => undefined, payloadLoading: false };
    const stable = (html: string) => html.replace(/ (id|aria-controls)="[^"]*"/g, "");
    const a = render(<MailEntryCard {...base} />);
    const html = stable(a.container.innerHTML);
    a.unmount();
    const b = render(<MailEntryCard {...base} payload={{ secret: "SECRET-7f3a" }} payloadError="boom" payloadLoading />);
    expect(stable(b.container.innerHTML)).toBe(html);
    expect(b.container.textContent).not.toContain("SECRET-7f3a");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("S89 — batched mails and replay", () => {
  const mails = [
    { content: formatMail({ kind: "message", sender: "bob", text: "first" }), customType: "agent-teams-mail" },
    { content: formatMail({ kind: "shutdown_response", sender: "alice", text: "reject: still busy" }), customType: customTypeForKind("shutdown_response") },
    { content: formatMail({ kind: "message", sender: "carol", text: "third" }), customType: "agent-teams-mail" },
  ];

  it("3 mails of one turn render as 3 distinct cards in delivery order", () => {
    let state: unknown;
    mails.forEach((m, i) => {
      state = reduceCustom(m.content, m.customType, state, 10 + i);
    });
    const rows = (state as { messages: Array<{ role: string }> }).messages.filter((m) => m.role === "custom");
    expect(rows).toHaveLength(3);
    hostRows(rows as never);
    const senders = screen.getAllByTestId("team-mail-sender").map((n) => n.textContent);
    expect(senders).toEqual(["Teammate bob", "Teammate alice", "Teammate carol"]);
    expect(screen.getAllByTestId("team-mail-card")).toHaveLength(3);
    expect(within(screen.getAllByTestId("team-mail-card")[1] as HTMLElement).getByTestId("team-mail-kind").textContent).toBe("Shutdown response");
  });

  it("replaying the same sequence from a fresh state yields the same rows (no duplication)", () => {
    const run = () => {
      let state: unknown;
      mails.forEach((m, i) => {
        state = reduceCustom(m.content, m.customType, state, 10 + i);
      });
      return (state as { messages: Array<{ role: string; content: string }> }).messages.filter((m) => m.role === "custom").map((m) => m.content);
    };
    expect(run()).toEqual(run());
    expect(run()).toHaveLength(3);
  });
});
