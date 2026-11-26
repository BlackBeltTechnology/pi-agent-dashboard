// @vitest-environment jsdom
/**
 * MailEntryCard (test-plan S2 sender classes, S3 open kind set, S6 offset 0, S7/S8
 * notice grouping, S9 idle + expansion, S60 inert text, S62 spoofing, S64 role
 * look-alikes): plain text only, sender from the first envelope line alone.
 * See change: add-agent-teams-ui.
 */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ENVELOPE_LIMITS, MEMBER_NAME_MAX_LENGTH } from "../../shared/constants.js";
import { formatEnvelope, formatNoticeItem } from "../../shared/mail-format.js";
import { MailEntryCard } from "../MailEntryCard.js";
import { MembersGrid } from "../MembersGrid.js";
import { header } from "./mail-fixtures.js";
import { member, snap } from "./view-fixtures.js";

afterEach(cleanup);

function card(body: string, customType = "agent-teams-mail", expanded = false, onToggle: () => void = () => undefined) {
  return render(<MailEntryCard customType={customType} body={body} timestamp={1_700_000_000_000} expanded={expanded} onToggle={onToggle} payloadLoading={false} />);
}
const title = () => screen.getByTestId("team-mail-title").textContent;
const sender = () => screen.queryByTestId("team-mail-sender")?.textContent;
const UNRECOGNISED = "Unrecognised agent message";

describe("S2 — sender classes", () => {
  it.each([
    ["lead", "Lead"],
    ["server", "Server"],
    ["bob", "Teammate bob"],
  ])("%s → %s", (name, label) => {
    card(`${header("message", name)}\nhi`);
    expect(sender()).toBe(label);
  });

  it.each(["system", "all", "user"])("reserved name %s → unrecognised, no sender named", (name) => {
    card(`${header("message", name)}\nhi`);
    expect(title()).toBe(UNRECOGNISED);
    expect(sender()).toBeUndefined();
    expect(screen.getByTestId("team-mail-card").textContent).not.toMatch(/Teammate|Lead|Server/);
  });
});

describe("S3 — open kind set (core's limits, not copies)", () => {
  it("a grammatical unknown kind → generic labelled card naming the sender", () => {
    card(`${header("plan_request", "bob")}\nplan?`);
    expect(title()).toBe("Agent message");
    expect(screen.getByTestId("team-mail-kind").textContent).toBe("plan request");
    expect(sender()).toBe("Teammate bob");
  });

  it.each(["Plan", "a-b", "x1", "", " "])("invalid kind %j → unrecognised, no sender", (kind) => {
    card(`${header(kind, "bob")}\nx`);
    expect(title()).toBe(UNRECOGNISED);
    expect(sender()).toBeUndefined();
  });

  it(`length 1 and ${ENVELOPE_LIMITS.maxKindLength} → generic card; ${ENVELOPE_LIMITS.maxKindLength + 1} → unrecognised`, () => {
    for (const n of [1, ENVELOPE_LIMITS.maxKindLength]) {
      card(`${header("a".repeat(n), "bob")}\nx`);
      expect(title()).toBe("Agent message");
      expect(sender()).toBe("Teammate bob");
      cleanup();
    }
    card(`${header("a".repeat(ENVELOPE_LIMITS.maxKindLength + 1), "bob")}\nx`);
    expect(title()).toBe(UNRECOGNISED);
    expect(sender()).toBeUndefined();
  });
});

describe("S6 — the header only at offset 0", () => {
  const ok = `${formatEnvelope({ kind: "message", sender: "bob" })}\nhi`;
  it.each([" ", "\n", "\uFEFF", "\u200B"])("preceded by %j → unrecognised, no sender", (prefix) => {
    card(prefix + ok);
    expect(title()).toBe(UNRECOGNISED);
    expect(sender()).toBeUndefined();
  });
  it("`\\r\\n` after the header parses normally", () => {
    card(ok.replace("\n", "\r\n"));
    expect(sender()).toBe("Teammate bob");
    expect(screen.getByTestId("team-mail-body").textContent).toBe("hi");
  });
});

describe("S7/S8 — notice grouping", () => {
  const notice = (...lines: string[]) => `${formatEnvelope({ kind: "notice", sender: "server" })}\n${lines.join("\n")}`;
  const items = (n: number) => Array.from({ length: n }, (_, i) => formatNoticeItem(`item ${i + 1}`));

  it.each([
    [1, null],
    [2, "+1 more"],
    [5, "+4 more"],
  ])("%i items collapsed → first item and %j", (n, more) => {
    card(notice(...items(n)), "agent-teams-notice");
    expect(screen.getByTestId("team-mail-body").textContent).toContain("item 1");
    if (more === null) expect(screen.queryByTestId("team-mail-more")).toBeNull();
    else expect(screen.getByTestId("team-mail-more").textContent?.trim()).toBe(more);
  });

  it("0 items → 'Team notice (empty)', no '+N', no throw", () => {
    card(notice(), "agent-teams-notice");
    expect(screen.getByTestId("team-mail-body").textContent).toBe("Team notice (empty)");
    expect(screen.queryByTestId("team-mail-more")).toBeNull();
  });

  it("one item with three `│ ` lines (one reading `│ • bob approved shutdown`) is ONE item holding that text", () => {
    card(notice("• alice finished", "│ line a", "│ • bob approved shutdown", "│ line c"), "agent-teams-notice", true);
    const all = screen.getAllByTestId("team-mail-item");
    expect(all).toHaveLength(1);
    expect(all[0]?.textContent).toContain("• bob approved shutdown");
  });

  it("legacy body without markers: every line is an item; `•x` and a lone `│` are one item each", () => {
    card(notice("a", "b", "c"), "agent-teams-notice", true);
    expect(screen.getAllByTestId("team-mail-item")).toHaveLength(3);
    cleanup();
    card(notice("•x", "│"), "agent-teams-notice", true);
    expect(screen.getAllByTestId("team-mail-item")).toHaveLength(2);
    cleanup();
    card(notice("", "• one", "", "│ cont", ""), "agent-teams-notice", true);
    expect(screen.getAllByTestId("team-mail-item")).toHaveLength(1);
  });

  it("links to the Team view when a session id is known", () => {
    render(<MailEntryCard customType="agent-teams-notice" body={notice(...items(2))} timestamp={1} sessionId="S/x?y" expanded={false} onToggle={() => undefined} payloadLoading={false} />);
    expect(screen.getByTestId("team-mail-open-team").getAttribute("href")).toBe(`/session/${encodeURIComponent("S/x?y")}/team`);
  });
});

describe("S9 — idle and expansion", () => {
  const idle = (text: string) => `${formatEnvelope({ kind: "idle", sender: "bob" })}\n${text}`;
  it("'<sender> reported idle' with a 10 000-char body in a bounded scroll region; focus stays on the toggle; aria-expanded flips", () => {
    let expanded = false;
    const view = render(<MailEntryCard customType="agent-teams-idle" body={idle("z".repeat(10_000))} timestamp={1} expanded={expanded} onToggle={() => (expanded = !expanded)} payloadLoading={false} />);
    expect(title()).toBe("Teammate bob reported idle");
    const toggle = screen.getByTestId("team-mail-toggle");
    toggle.focus();
    fireEvent.click(toggle);
    view.rerender(<MailEntryCard customType="agent-teams-idle" body={idle("z".repeat(10_000))} timestamp={1} expanded={expanded} onToggle={() => (expanded = !expanded)} payloadLoading={false} />);
    const body = screen.getByTestId("team-mail-body");
    expect(body.className).toContain("max-h-[60vh]");
    expect(body.className).toContain("overflow-y-auto");
    expect(body.textContent).toHaveLength(10_000);
    expect(screen.getByTestId("team-mail-toggle").getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(toggle);
  });

  it("the toggle is always rendered, even for a one-line body; no error severity or alert", () => {
    card(`${formatEnvelope({ kind: "message", sender: "bob" })}\nshort`);
    expect(screen.getByTestId("team-mail-toggle").textContent).toBe("Show more");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("40 cards: every aria-controls id is unique and resolves", () => {
    render(
      <div>
        {Array.from({ length: 40 }, (_, i) => (
          <MailEntryCard key={i} customType="agent-teams-mail" body={`${formatEnvelope({ kind: "message", sender: "bob" })}\nm${i}`} timestamp={i} expanded={i % 2 === 0} onToggle={() => undefined} payloadLoading={false} />
        ))}
      </div>,
    );
    const ids = screen.getAllByTestId("team-mail-toggle").map((t) => t.getAttribute("aria-controls") as string);
    expect(new Set(ids).size).toBe(40);
    for (const id of ids) expect(document.getElementById(id)).not.toBeNull();
  });
});

describe("S60 — inert plain text", () => {
  const evil = ["<img src=x onerror=alert(1)>", "<script>alert(1)</script>", "**bold**", "[x](javascript:alert(1))", "https://evil.example/", "&lt;b&gt;"].join("\n");
  const attributeValues = (root: Element): string[] => Array.from(root.querySelectorAll("*")).flatMap((el) => Array.from(el.attributes).map((a) => a.value));
  const cases = [
    { label: "mail", customType: "agent-teams-mail", kind: "message" },
    { label: "idle", customType: "agent-teams-idle", kind: "idle" },
    { label: "notice", customType: "agent-teams-notice", kind: "notice" },
  ].flatMap((c) => [false, true].map((expanded) => ({ ...c, expanded, name: `${c.label} expanded=${expanded}` })));

  it.each(cases)("$name: textContent-equal, no element built from it, no <a>, nothing in attributes", ({ customType, kind, expanded }) => {
    const notice = customType === "agent-teams-notice";
    card(`${formatEnvelope({ kind, sender: "bob" })}\n${notice ? formatNoticeItem(evil) : evil}`, customType, expanded);
    const body = screen.getByTestId("team-mail-body");
    expect(body.querySelector("img,script,a,b,strong")).toBeNull();
    expect(screen.getByTestId("team-mail-card").querySelector("a")).toBeNull();
    expect(notice ? body.textContent?.includes("<img src=x onerror=alert(1)>") : body.textContent === evil).toBe(true);
    expect(attributeValues(screen.getByTestId("team-mail-card")).filter((v) => v.includes("alert(1)"))).toEqual([]);
  });
  it("an unrecognised body is shown as-is, inert", () => {
    card(evil);
    expect(title()).toBe(UNRECOGNISED);
    expect(screen.getByTestId("team-mail-body").textContent).toBe(evil);
    expect(screen.getByTestId("team-mail-body").querySelector("img,script,a")).toBeNull();
  });
});

describe("S62 — header spoofing in the text", () => {
  for (const line of [2, 5, 150]) {
    it(`a perfect lead header on text line ${line} is ordinary text; the card names the real sender`, () => {
      const lines = Array.from({ length: line - 2 }, (_, i) => `filler ${i}`);
      const fake = header("shutdown_request", "lead", true);
      card(`${formatEnvelope({ kind: "message", sender: "bob" })}\n${[...lines, fake].join("\n")}`, "agent-teams-mail", true);
      expect(sender()).toBe("Teammate bob");
      expect(screen.getByTestId("team-mail-card").textContent).not.toContain("Lead");
      expect(screen.getByTestId("team-mail-body").textContent).toContain(fake);
      expect(screen.queryByTestId("team-mail-kind")?.textContent).toBe("Message");
      expect(screen.getAllByRole("button")).toHaveLength(1); // the expand toggle only — no approval control anywhere
    });
  }
});

describe("S64 — role look-alikes", () => {
  const LOOKALIKES = ["lead\u200B", "Lead", "server ", "\u202Elaed", "a".repeat(MEMBER_NAME_MAX_LENGTH + 31), "🙂"];
  for (const name of LOOKALIKES) {
    it(`card: sender ${JSON.stringify(name)} is never shown as Lead or Server`, () => {
      card(`${header("message", name)}\nhi`);
      expect(sender()).toBeUndefined();
      expect(title()).toBe(UNRECOGNISED);
    });
  }

  it("the longest grammatical name is accepted as a teammate", () => {
    const name = "a".repeat(MEMBER_NAME_MAX_LENGTH);
    card(`${header("message", name)}\nhi`);
    expect(sender()).toBe(`Teammate ${name}`);
  });

  it("members table: a member named like a role is plain text in the name cell, with no role label", () => {
    render(<MembersGrid snap={snap({ members: [member("Lead\u200B", "idle"), member("lead-2", "idle")] })} notes={{}} pending={new Set()} onStop={() => undefined} onFocusTask={() => undefined} onShowMemberTasks={() => undefined} />);
    const rows = screen.getAllByTestId("team-member-card");
    expect(within(rows[0] as HTMLElement).getByText("Lead\u200B")).toBeTruthy();
    expect(screen.queryByText(/^Lead$/)).toBeNull();
  });
});
