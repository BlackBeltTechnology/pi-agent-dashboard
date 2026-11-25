// @vitest-environment jsdom
/**
 * Session badge (test-plan S13, S73, S90 unit half): the pure `isTeamSession`
 * predicate over the top-level ref projection, and the eager `TeamBadge` link.
 * See change: add-agent-teams-ui.
 */
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { teamViewPath } from "../routes.js";
import { TeamBadge } from "../TeamBadge.js";
import { isTeamSession, teamRoleOf } from "../team-refs.js";

afterEach(cleanup);

const sess = (extra: Record<string, unknown> = {}, id = "S1") => ({ id, ...extra });

describe("isTeamSession predicate (S13)", () => {
  const rows: Array<[string, Record<string, unknown>, boolean]> = [
    ["no ref", {}, false],
    ["teammate ref", { "agent-teams": { teamId: "t1", member: "bob", role: "dev" } }, true],
    ["lead ref", { "agent-teams-lead": { teamId: "t1" } }, true],
    ["both refs", { "agent-teams": { teamId: "t1", member: "bob" }, "agent-teams-lead": { teamId: "t1" } }, true],
    ["cleared lead sentinel", { "agent-teams-lead": { teamId: null } }, false],
    ["cleared lead, member still set", { "agent-teams-lead": { teamId: null }, "agent-teams": { teamId: "t1", member: "bob" } }, true],
    ["numeric teamId", { "agent-teams-lead": { teamId: 5 } }, false],
    ["empty-string teamId", { "agent-teams-lead": { teamId: "" } }, false],
    ["empty teamId on both", { "agent-teams": { teamId: "" }, "agent-teams-lead": { teamId: "" } }, false],
    ["nested under pluginRefs", { pluginRefs: { "agent-teams": { teamId: "t1" } } }, false],
    ["ref is a string", { "agent-teams": "t1" }, false],
    ["ref is an array", { "agent-teams": ["t1"] }, false],
    ["ref is null", { "agent-teams": null, "agent-teams-lead": null }, false],
  ];
  it.each(rows)("%s → %s", (_name, extra, expected) => {
    expect(isTeamSession(sess(extra))).toBe(expected);
  });

  it("never throws on a non-session input", () => {
    for (const bad of [null, undefined, 0, "x", [], () => 1]) {
      expect(isTeamSession(bad as never)).toBe(false);
    }
  });

  it("both refs present → the lead variant wins", () => {
    expect(teamRoleOf(sess({ "agent-teams": { teamId: "t1", member: "bob" }, "agent-teams-lead": { teamId: "t1" } }))).toEqual({ kind: "lead" });
    expect(teamRoleOf(sess({ "agent-teams": { teamId: "t1", member: "bob" } }))).toEqual({ kind: "member", name: "bob" });
  });

  it("a teammate ref without a usable member name still counts, with no name", () => {
    expect(teamRoleOf(sess({ "agent-teams": { teamId: "t1" } }))).toEqual({ kind: "member", name: undefined });
    expect(teamRoleOf(sess({ "agent-teams": { teamId: "t1", member: 7 } }))).toEqual({ kind: "member", name: undefined });
  });
});

describe("TeamBadge", () => {
  const view = (ui: ReactElement) => render(ui);

  it("lead: shows Lead, link to the Team view, accessible name states the role", () => {
    view(<TeamBadge session={sess({ "agent-teams-lead": { teamId: "t1" } }) as never} />);
    const link = screen.getByTestId("team-badge");
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/session/S1/team");
    expect(link.textContent).toContain("Lead");
    expect(link.getAttribute("aria-label")).toBe("Open team view, Lead");
  });

  it("teammate: shows the member name; the accessible name names the member", () => {
    view(<TeamBadge session={sess({ "agent-teams": { teamId: "t1", member: "alice" } }, "S2") as never} />);
    const link = screen.getByTestId("team-badge");
    expect(link.textContent).toContain("alice");
    expect(link.getAttribute("aria-label")).toBe("Open team view, alice");
    expect(link.getAttribute("href")).toBe("/session/S2/team");
  });

  it("shows text so the role never depends on colour (the glyph is decorative)", () => {
    view(<TeamBadge session={sess({ "agent-teams-lead": { teamId: "t1" } }) as never} />);
    const glyph = screen.getByTestId("team-badge").querySelector('[aria-hidden="true"]');
    expect(glyph).not.toBeNull();
    expect(screen.getByTestId("team-badge").textContent?.replace(glyph?.textContent ?? "", "").trim().length).toBeGreaterThan(0);
  });

  it("a plain or cleared session renders nothing (no empty chip)", () => {
    const { container, rerender } = view(<TeamBadge session={sess() as never} />);
    expect(container.innerHTML).toBe("");
    rerender(<TeamBadge session={sess({ "agent-teams-lead": { teamId: null } }) as never} />);
    expect(container.innerHTML).toBe("");
  });

  it("is a keyboard-focusable link with a visible focus ring class", () => {
    view(<TeamBadge session={sess({ "agent-teams-lead": { teamId: "t1" } }) as never} />);
    const link = screen.getByTestId("team-badge");
    link.focus();
    expect(document.activeElement).toBe(link);
    expect(link.className).toContain("focus-ring");
    expect(link.getAttribute("tabindex")).not.toBe("-1");
  });

  it("builds the href with encodeURIComponent for hostile ids (S73)", () => {
    for (const id of ["../../api/restart", "a b", "x?y=1", "javascript:alert(1)", "//evil.example"]) {
      const { unmount } = view(<TeamBadge session={sess({ "agent-teams-lead": { teamId: "t1" } }, id) as never} />);
      const href = screen.getByTestId("team-badge").getAttribute("href") as string;
      expect(href).toBe(`/session/${encodeURIComponent(id)}/team`);
      expect(href.startsWith("/session/")).toBe(true);
      expect(href).not.toMatch(/^[a-z]+:/i);
      expect(href.slice("/session/".length, -"/team".length)).not.toMatch(/[/?# ]/);
      unmount();
    }
    expect(teamViewPath("a/b")).toBe("/session/a%2Fb/team");
  });

  it("appears and disappears when the projection changes, without a reload", () => {
    const { container, rerender } = view(<TeamBadge session={sess() as never} />);
    expect(container.innerHTML).toBe("");
    rerender(<TeamBadge session={sess({ "agent-teams-lead": { teamId: "t1" } }) as never} />);
    expect(screen.getByTestId("team-badge")).toBeTruthy();
    rerender(<TeamBadge session={sess({ "agent-teams-lead": { teamId: null } }) as never} />);
    expect(container.innerHTML).toBe("");
  });
});
