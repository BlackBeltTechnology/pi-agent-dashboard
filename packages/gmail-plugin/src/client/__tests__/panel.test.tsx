// @vitest-environment jsdom
/**
 * L1 tests for the reduced Gmail settings section: a pointer to Settings → Google accounts while Google Connect is
 * usable, a "turn on Google accounts" text while it is not, and none of the old account / client / wizard UI.
 * See change: add-google-connect (test-plan #B139, #B149).
 *
 * @structural-pin the removed wizard/account UI must stay absent from the component source: a render test cannot see dead code that ships in the bundle
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GmailSettings } from "../GmailSettings.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const stubState = (body: unknown, status = 200) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => (url === "/api/plugins/gmail/state" ? new Response(JSON.stringify(body), { status }) : new Response("{}", { status: 404 }))),
  );

const USABLE = { moved: true };
const NOT_USABLE = { moved: false, googleConnect: "unavailable" };

/** Anything a user could click to connect an account, add a client or run the old setup. */
const OLD_UI = /connect|add account|revoke|wizard|upload|client|sign in|set up automatically|step \d/i;

describe("#B139 Gmail settings point to Google accounts", () => {
  it("usable: a notice with a link to Settings → Google accounts, no forms and no Connect button", async () => {
    stubState(USABLE);
    render(<GmailSettings />);
    const notice = await screen.findByTestId("gmail-moved");
    expect(notice.textContent).toMatch(/Settings → Google accounts/);
    const link = screen.getByTestId("gmail-open-google") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("/settings/plugins/google");
    expect(screen.queryByTestId("gmail-google-off")).toBeNull();
    expect(document.querySelectorAll("form, input, select, textarea")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /connect/i })).toBeNull();
  });

  it("usable: following the link navigates the SPA to the Google settings page", async () => {
    stubState(USABLE);
    const push = vi.spyOn(window.history, "pushState");
    const pop = vi.fn();
    window.addEventListener("popstate", pop);
    render(<GmailSettings />);
    (await screen.findByTestId("gmail-open-google")).click();
    expect(push).toHaveBeenCalledWith(null, "", "/settings/plugins/google");
    expect(pop).toHaveBeenCalled();
    window.removeEventListener("popstate", pop);
  });

  it("not usable: text telling the user to turn on Google accounts, no forms, no Connect button", async () => {
    stubState(NOT_USABLE);
    render(<GmailSettings />);
    const text = await screen.findByTestId("gmail-google-off");
    expect(text.textContent).toBe("Turn on Google accounts to manage Gmail accounts");
    expect(screen.queryByTestId("gmail-moved")).toBeNull();
    expect(document.querySelectorAll("form, input, select, textarea")).toHaveLength(0);
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("a failed state request is shown, still without any account UI", async () => {
    stubState({ error: "boom" }, 500);
    render(<GmailSettings />);
    expect((await screen.findByTestId("gmail-load-error")).textContent).toMatch(/HTTP 500/);
    expect(screen.queryByTestId("gmail-moved")).toBeNull();
  });
});

describe("#B149 the old Gmail management UI is gone", () => {
  it.each([USABLE, NOT_USABLE])("%j renders no wizard, step chips, Revoke or sign-in controls", async (body) => {
    stubState(body);
    render(<GmailSettings />);
    await screen.findByTestId(body.moved ? "gmail-moved" : "gmail-google-off");
    const root = screen.getByTestId("gmail-settings");
    for (const el of root.querySelectorAll("button, input, select, [data-testid]")) {
      const id = (el as HTMLElement).dataset.testid ?? "";
      expect(id, id).not.toMatch(/wizard|step|revoke|add-account|account-row|client-upload|setup/);
    }
    // Only the notice text and the (usable) link may match words of the old UI: the link says "Open Google accounts".
    expect(root.textContent?.replace(/Settings → Google accounts|Open Google accounts|Turn on Google accounts to manage Gmail accounts|Nothing to reconnect/g, "")).not.toMatch(OLD_UI);
  });

  it("the source no longer carries the wizard, auto-setup or account panel", () => {
    const src = readFileSync(join(__dirname, "..", "GmailSettings.tsx"), "utf8");
    for (const word of ["SetupWizard", "AutoSetup", "AccountRow", "revoke", "oauthFlowClient", "client_secret"]) expect(src, word).not.toContain(word);
  });
});
