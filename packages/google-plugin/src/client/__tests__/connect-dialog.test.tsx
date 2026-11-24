// @vitest-environment jsdom
/**
 * L1 tests for the connect dialog: product choice, "Sign in with" only for organisations, data-use disclosure and the
 * return-path wording, waiting + paste fallback, results/errors, product change / Sign in again reuse, Workspace
 * blocks, dialog a11y. Fetch is scriptable; `ui:dialog` is the real host Dialog. See change: add-google-connect
 * (test-plan #A12 #A47 #A49 #A51 #A52 #A54–#A57 #A60–#A64 #A107–#A110 #B49–#B55 #B58 #B64–#B69 #B115 #B120, #GA11 #GA16 #GB11).
 */
import { act, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acct, client, FLOW_URL, flowRoutes, json, mockApi, PRIVACY_URL, pendingStatus, renderSettings, STATE_URL, state } from "./harness.js";

let openSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  openSpy = vi.spyOn(window, "open").mockReturnValue(null);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const POST_ACCOUNTS = "POST /api/plugins/google/accounts";
const STARTED = { ok: true, flowId: "f1", path: "local", client: "builtin" };
const wait = { timeout: 4000 };

type S = ReturnType<typeof state>;
/** Page + scriptable API with a mutable state; returns helpers. */
async function page(initial: S, routes: Parameters<typeof mockApi>[0] = {}) {
  const box = { state: initial };
  const api = mockApi({ [`GET ${STATE_URL}`]: () => box.state, [POST_ACCOUNTS]: () => STARTED, ...flowRoutes(), ...routes });
  renderSettings();
  await screen.findByTestId("google-connect");
  return { api, box };
}
const dialog = () => screen.getByRole("dialog");
const openConnect = async () => {
  fireEvent.click(screen.getByTestId("google-connect"));
  return screen.findByRole("dialog");
};
const cont = () => screen.getByTestId("google-continue") as HTMLButtonElement;
const waitingUp = async () => {
  fireEvent.click(cont());
  await screen.findByTestId("google-waiting", {}, wait);
};
const openFold = () => fireEvent.click(screen.getByTestId("google-fallback-toggle"));

describe("#A49 connect dialog", () => {
  it("one screen: 8 product checkboxes, 3 data-use lines, privacy link, Continue; no email field, no client select; sends every product at its read level", async () => {
    const { api } = await page(state());
    const dlg = await openConnect();
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    const boxes = within(dlg).getAllByRole("checkbox");
    expect(boxes.map((b) => (b.closest("label") as HTMLElement).textContent?.trim())).toEqual(["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Slides", "Tasks", "Contacts"]);
    expect(within(dlg).getAllByTestId(/^google-disclosure-line-/)).toHaveLength(3);
    expect((within(dlg).getByTestId("google-privacy-link") as HTMLAnchorElement).getAttribute("href")).toBe(PRIVACY_URL);
    expect(within(dlg).getByRole("button", { name: "Continue with Google" })).toBeTruthy();
    expect(within(dlg).queryByTestId("google-work-email")).toBeNull();
    expect(within(dlg).queryByTestId("google-signin-with")).toBeNull();
    for (const b of boxes) if (!(b as HTMLInputElement).checked) fireEvent.click(b);
    await waitingUp();
    expect(api.calls(POST_ACCOUNTS)).toEqual([
      {
        products: {
          gmail: { level: "readonly" },
          calendar: { level: "read" },
          drive: { level: "files" },
          docs: { level: "read" },
          sheets: { level: "read" },
          slides: { level: "read" },
          tasks: { level: "read" },
          contacts: { level: "read" },
        },
      },
    ]);
  });
});

describe("#A51 nothing ticked", () => {
  it("Continue is disabled and no request is sent", async () => {
    const { api } = await page(state());
    const dlg = await openConnect();
    for (const b of within(dlg).getAllByRole("checkbox")) if ((b as HTMLInputElement).checked) fireEvent.click(b);
    expect(cont().disabled).toBe(true);
    fireEvent.click(cont());
    expect(api.calls(POST_ACCOUNTS)).toHaveLength(0);
  });
});

describe("#A52 dialog accessibility", () => {
  it("has an accessible name, closes on Escape and backdrop, traps Tab and returns focus to the trigger", async () => {
    const user = userEvent.setup();
    await page(state());
    const trigger = screen.getByTestId("google-connect");
    await user.click(trigger);
    const dlg = await screen.findByRole("dialog", { name: "Connect a Google account" });
    for (let i = 0; i < 25; i++) {
      await user.tab();
      expect(dlg.contains(document.activeElement)).toBe(true);
    }
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
    await user.click(trigger);
    await screen.findByRole("dialog");
    fireEvent.click(screen.getByTestId("google-connect-dialog-overlay"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(document.activeElement).toBe(trigger);
  });
});

describe("#A12 / #GA11 built-in unavailable", () => {
  it("#A12 no built-in for this browser and no own client: no Continue with Google, setup guidance instead", async () => {
    await page(state({ builtin: { available: false }, clients: [] }));
    const dlg = await openConnect();
    expect(within(dlg).queryByRole("button", { name: "Continue with Google" })).toBeNull();
    expect(within(dlg).queryByTestId("google-signin-with")).toBeNull();
    expect(within(dlg).getByTestId("google-no-client").textContent).toMatch(/organisation/i);
    expect(within(dlg).getByRole("button", { name: "Set up organisation sign-in" })).toBeTruthy();
  });
  it("#A62 / #GA11 own client exists, built-in unavailable: built-in is not listed, nothing preselected, Continue disabled until a client is chosen", async () => {
    await page(state({ builtin: { available: false }, clients: [client({ id: "bb", label: "BlackBelt", domains: ["blackbelt.hu"] })] }));
    const dlg = await openConnect();
    const sel = within(dlg).getByTestId("google-signin-with") as HTMLSelectElement;
    expect(sel.value).toBe("");
    expect(Array.from(sel.options).some((o) => /pi-dashboard\.dev/.test(o.textContent ?? ""))).toBe(false);
    expect(cont().disabled).toBe(true);
    fireEvent.change(sel, { target: { value: "own:bb" } });
    expect(cont().disabled).toBe(false);
  });
});

describe("#A60 / #A61 / #A63 organisation sign-in is advanced", () => {
  it("#A60 no own client: Advanced collapsed, no client names, dialog has no Sign in with or work email", async () => {
    await page(state({ accounts: [acct({ email: "me@gmail.com" })] }));
    expect(screen.getByTestId("google-advanced-toggle").getAttribute("aria-expanded")).toBe("false");
    const dlg = await openConnect();
    expect(within(dlg).queryByText("Sign in with")).toBeNull();
    expect(within(dlg).queryByTestId("google-work-email")).toBeNull();
  });
  it("#A61 with an organisation client: Sign in with (built-in default) + optional work email; only the organisation row names it", async () => {
    await page(
      state({
        clients: [client({ id: "bb", label: "BlackBelt", domains: ["blackbelt.hu"], accounts: 1 })],
        accounts: [acct({ email: "team-pi@blackbelt.hu", client: "own:bb" }), acct({ email: "me@gmail.com" })],
      }),
    );
    const rows = screen.getAllByTestId("google-account-row");
    expect(within(rows[0] as HTMLElement).getByTestId("google-account-summary").textContent).toContain("organisation sign-in: BlackBelt");
    expect(within(rows[1] as HTMLElement).getByTestId("google-account-summary").textContent).not.toMatch(/BlackBelt|organisation/);
    const dlg = await openConnect();
    expect((within(dlg).getByTestId("google-signin-with") as HTMLSelectElement).value).toBe("builtin");
    expect(within(dlg).getByLabelText("Work email (optional)")).toBeTruthy();
  });
  it("#A63 Sign in with exists while a client does, and disappears after the last client is removed", async () => {
    const { box } = await page(state({ clients: [client({ id: "bb", label: "BlackBelt" })] }), {
      "DELETE /api/plugins/google/clients/bb": () => ({ removed: true }),
    });
    let dlg = await openConnect();
    expect(within(dlg).getByTestId("google-signin-with")).toBeTruthy();
    fireEvent.click(within(dlg).getByTestId("google-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByTestId("google-advanced-toggle"));
    box.state = state({ clients: [] });
    fireEvent.click(screen.getByTestId("google-client-remove"));
    await waitFor(() => expect(screen.queryByTestId("google-client-row")).toBeNull());
    dlg = await openConnect();
    expect(within(dlg).queryByTestId("google-signin-with")).toBeNull();
    expect(within(dlg).queryByTestId("google-work-email")).toBeNull();
  });
  it("#A64 the Advanced header toggles with Enter and Space; its contents exist only while expanded", async () => {
    const user = userEvent.setup();
    await page(state({ clients: [client({ id: "bb", label: "BlackBelt" })] }));
    const toggle = screen.getByTestId("google-advanced-toggle");
    expect(screen.queryByTestId("google-client-row")).toBeNull();
    expect(screen.queryByRole("button", { name: "Add organisation sign-in" })).toBeNull();
    toggle.focus();
    await user.keyboard("{Enter}");
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByTestId("google-client-row")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add organisation sign-in" })).toBeTruthy();
    await user.keyboard(" ");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("google-client-row")).toBeNull();
  });
});

describe("#A47 client selection when the server needs one", () => {
  it("client_required lists the clients; picking one re-submits with its id and starts the sign-in", async () => {
    const choices = [client({ id: "a", label: "Alpha" }), client({ id: "b", label: "Beta" })];
    let first = true;
    const { api } = await page(state(), {
      [POST_ACCOUNTS]: () => {
        if (first) {
          first = false;
          return json({ error: "client_required", clients: choices }, 400);
        }
        return STARTED;
      },
    });
    await openConnect();
    fireEvent.click(cont());
    const list = await screen.findByTestId("google-client-choices");
    expect(within(list).getByText("Alpha")).toBeTruthy();
    expect(within(list).getByText("Beta")).toBeTruthy();
    fireEvent.click(within(list).getByTestId("google-client-choice-b"));
    await screen.findByTestId("google-waiting", {}, wait);
    const bodies = api.calls(POST_ACCOUNTS) as Array<{ client?: string }>;
    expect(bodies).toHaveLength(2);
    expect(bodies[1]?.client).toBe("own:b");
  });
});

describe("#A54 – #A57 waiting for Google", () => {
  it("#A54 shows the waiting state; the paste fallback is collapsed and its field is not rendered", async () => {
    await page(state());
    await openConnect();
    await waitingUp();
    const toggle = screen.getByTestId("google-fallback-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByTestId("flow-view")).toBeNull();
    expect(screen.queryByTestId("flow-paste")).toBeNull();
    expect(openSpy).toHaveBeenCalledWith(pendingStatus.authUrl, "_blank", "noopener");
  });

  it("#A55 a pasted redirect connects the account: the dialog shows its email and leaves the waiting state", async () => {
    const { box } = await page(state(), {
      ...flowRoutes([pendingStatus, pendingStatus, { flowId: "f1", provider: "google", status: "complete" }]),
    });
    await openConnect();
    await waitingUp();
    openFold();
    fireEvent.change(await screen.findByTestId("flow-paste"), { target: { value: "http://127.0.0.1:5555/?code=c&state=s" } });
    box.state = state({ accounts: [acct({ email: "new@x.com" })] });
    fireEvent.click(screen.getByTestId("flow-paste-submit"));
    expect((await screen.findByTestId("google-connected-email", {}, wait)).textContent).toBe("new@x.com");
    expect(screen.queryByTestId("google-waiting")).toBeNull();
  });

  const pasteFails = async (reply: Response | { status: string; error: string }) => {
    const routes = flowRoutes();
    const isResponse = reply instanceof Response;
    if (isResponse) routes[`POST ${FLOW_URL}/input`] = () => reply;
    else routes[`GET ${FLOW_URL}`] = (() => {
      let n = 0;
      return () => (n++ < 1 ? pendingStatus : { flowId: "f1", provider: "google", ...reply });
    })();
    const { api } = await page(state(), routes);
    await openConnect();
    await waitingUp();
    openFold();
    fireEvent.click(await screen.findByTestId("flow-paste-submit"));
    const err = await screen.findByTestId("google-connect-error", {}, wait);
    expect(screen.queryByTestId("google-waiting")).toBeNull();
    expect(screen.queryByTestId("google-connected-email")).toBeNull();
    expect(api.calls(POST_ACCOUNTS)).toHaveLength(1);
    // The dialog can be retried: back to the choice screen.
    fireEvent.click(screen.getByTestId("google-retry"));
    expect(await screen.findByTestId("google-continue")).toBeTruthy();
    return err;
  };
  it("#A56 (a) a redirect with the wrong state shows an actionable error", async () => {
    const err = await pasteFails(json({ error: "state_mismatch" }, 400));
    expect(err.textContent).toMatch(/belongs to another sign-in/);
  });
  it("#A56 (b) a URL without a code shows an actionable error", async () => {
    const err = await pasteFails(json({ error: "invalid_redirect" }, 400));
    expect(err.textContent).toMatch(/Paste the full URL/);
  });
  it("#A56 (c) error=access_denied ends the sign-in with a cancelled message", async () => {
    const err = await pasteFails({ status: "error", error: "access_denied" });
    expect(err.textContent).toMatch(/Google access was cancelled/);
  });

  it("#A57 callback and paste racing create one account (one sign-in request, one status completion); a late callback after close only refreshes the list", async () => {
    const { api, box } = await page(state(), {
      ...flowRoutes([pendingStatus, { flowId: "f1", provider: "google", status: "complete" }]),
    });
    await openConnect();
    await waitingUp();
    openFold();
    box.state = state({ accounts: [acct({ email: "new@x.com" })] });
    fireEvent.click(await screen.findByTestId("flow-paste-submit"));
    expect((await screen.findByTestId("google-connected-email", {}, wait)).textContent).toBe("new@x.com");
    expect(api.calls(POST_ACCOUNTS)).toHaveLength(1);
    expect(api.calls(`POST ${FLOW_URL}/input`)).toHaveLength(1);
    // Late callback: the dialog is closed first; the list is refreshed and no dialog reopens.
    const before = api.calls(`GET ${STATE_URL}`).length;
    fireEvent.click(screen.getByTestId("google-done"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await waitFor(() => expect(api.calls(`GET ${STATE_URL}`).length).toBeGreaterThan(before));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByTestId("google-account-row")).toHaveLength(1);
  });
});

describe("#B49 – #B55 data-use disclosure and the return path", () => {
  it("#B49 built-in selected: three lines and one privacy link, above the Continue button in DOM order", async () => {
    await page(state());
    const dlg = await openConnect();
    const lines = within(dlg).getAllByTestId(/^google-disclosure-line-/);
    expect(lines).toHaveLength(3);
    const links = within(dlg).getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]?.getAttribute("href")).toBe(PRIVACY_URL);
    const follows = (a: Node, b: Node) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    expect(follows(lines[2] as Node, links[0] as Node)).toBe(true);
    expect(follows(links[0] as Node, cont())).toBe(true);
  });

  it("#B50 lines are shown for built-in local and built-in remote, absent for an own installed or own web client", async () => {
    await page(state({ clients: [client({ id: "inst", label: "Inst" }), client({ id: "web", label: "Web", type: "web" })] }));
    const dlg = await openConnect();
    expect(within(dlg).queryByTestId("google-disclosure")).not.toBeNull();
    for (const ref of ["own:inst", "own:web"]) {
      fireEvent.change(within(dlg).getByTestId("google-signin-with"), { target: { value: ref } });
      expect(within(dlg).queryByTestId("google-disclosure")).toBeNull();
      expect(within(dlg).queryByTestId("google-privacy-link")).toBeNull();
    }
    cleanup();
    await page(state({ browser: "remote", builtin: { available: true, ref: "builtin-remote" } }));
    const remote = await openConnect();
    expect(within(remote).queryByTestId("google-disclosure")).not.toBeNull();
  });

  it("#B53 local and remote lines differ and are never shown together", async () => {
    await page(state());
    let dlg = await openConnect();
    const local = within(dlg).getByTestId("google-disclosure-line-1").textContent ?? "";
    expect(local).toMatch(/stays on this computer/);
    expect(local).toMatch(/Nothing is sent to pi-dashboard\.dev/);
    expect(local).not.toMatch(/return page/);
    cleanup();
    await page(state({ browser: "remote", builtin: { available: true, ref: "builtin-remote" } }));
    dlg = await openConnect();
    const remote = within(dlg).getByTestId("google-disclosure-line-1").textContent ?? "";
    expect(remote).toMatch(/pi-dashboard\.dev's return page/);
    expect(remote).toMatch(/stores nothing/);
    expect(remote).toMatch(/kept only on this dashboard/);
    expect(remote).not.toMatch(/stays on this computer/);
  });

  it("#B55 a same-host tunnel is reported as remote by the server and gets the return-page wording", async () => {
    await page(state({ browser: "remote", builtin: { available: true, ref: "builtin-remote" } }));
    const dlg = await openConnect();
    expect(within(dlg).getByTestId("google-disclosure-line-1").textContent).toMatch(/return page/);
  });

  it("#B54 switching path from 'Window didn't come back?' re-renders line 1 to the new path", async () => {
    const { api } = await page(state(), {
      [POST_ACCOUNTS]: (() => {
        let n = 0;
        return () => (n++ === 0 ? STARTED : { ok: true, flowId: "f1", path: "return", client: "builtin-remote" });
      })(),
    });
    await openConnect();
    await waitingUp();
    expect(screen.getByTestId("google-return-path").textContent).toMatch(/stays on this computer/);
    openFold();
    fireEvent.click(screen.getByTestId("google-switch-path"));
    await waitFor(() => expect(screen.getByTestId("google-return-path").textContent).toMatch(/return page/), wait);
    expect(screen.getByTestId("google-return-path").textContent).not.toMatch(/stays on this computer/);
    expect((api.calls(POST_ACCOUNTS) as Array<{ client?: string }>)[1]?.client).toBe("builtin-remote");
  });
});

describe("#B58 stale disclosure on Sign in again", () => {
  it("the dialog shows the updated disclosure; one click on Continue persists it and starts the sign-in (no second dialog)", async () => {
    const a = acct({ email: "a@x.com", status: "reauth_required" });
    const { api } = await page(state({ disclosure: { version: 2, accepted: false }, accounts: [a] }), {
      "PUT /api/plugins/google/disclosure": () => ({ ok: true, version: 2 }),
      "POST /api/plugins/google/accounts/sub-a/reauth": () => STARTED,
    });
    fireEvent.click(within(screen.getByTestId("google-account-row")).getByTestId("google-account-toggle"));
    fireEvent.click(screen.getByRole("button", { name: "Sign in again a@x.com" }));
    const dlg = await screen.findByRole("dialog");
    expect(within(dlg).getAllByTestId(/^google-disclosure-line-/)).toHaveLength(3);
    expect(api.calls("POST /api/plugins/google/accounts/sub-a/reauth")).toHaveLength(0);
    fireEvent.click(cont());
    await screen.findByTestId("google-waiting", {}, wait);
    expect(api.calls("PUT /api/plugins/google/disclosure")).toHaveLength(1);
    expect(api.calls("POST /api/plugins/google/accounts/sub-a/reauth")).toHaveLength(1);
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
  });
});

describe("#A107 – #A110 / #GA16 product changes reuse the dialog", () => {
  const semmi = client({ id: "semmi", label: "Semmi", accounts: 1 });
  const robson = acct({ email: "robson@semmi.se", client: "own:semmi", products: { gmail: { level: "readonly" } } });
  const changeUrl = "POST /api/plugins/google/accounts/sub-robson/products";
  const setSlides = async (route: Parameters<typeof mockApi>[0][string]) => {
    const p = await page(state({ clients: [semmi], accounts: [robson] }), { [changeUrl]: route });
    fireEvent.click(within(screen.getByTestId("google-account-row")).getByTestId("google-account-toggle"));
    fireEvent.change(screen.getByLabelText("Slides level for robson@semmi.se"), { target: { value: "read" } });
    return p;
  };
  const consent = { ok: true, flowId: "f1", path: "local", client: "own:semmi" };

  it("#A107 the dialog opens for that account with Slides and Gmail ticked; no email or client choice; Continue starts consent for that account", async () => {
    const { api } = await setSlides(() => consent);
    const dlg = await screen.findByRole("dialog");
    expect((within(dlg).getByTestId("google-product-check-slides") as HTMLInputElement).checked).toBe(true);
    expect((within(dlg).getByTestId("google-product-check-gmail") as HTMLInputElement).checked).toBe(true);
    expect(within(dlg).queryByTestId("google-work-email")).toBeNull();
    expect(within(dlg).queryByTestId("google-signin-with")).toBeNull();
    expect(api.calls(changeUrl)).toEqual([{ products: { slides: { level: "read" } } }]);
    expect(openSpy).not.toHaveBeenCalled();
    fireEvent.click(cont());
    await screen.findByTestId("google-waiting", {}, wait);
    expect(openSpy).toHaveBeenCalledWith(pendingStatus.authUrl, "_blank", "noopener");
    expect(api.calls(changeUrl)).toHaveLength(1);
  });

  it("#A108 scopes already covered or a lowered level apply inline without any dialog", async () => {
    const { api } = await setSlides(() => ({ ok: true, applied: true, account: robson }));
    await waitFor(() => expect(api.calls(changeUrl)).toHaveLength(1));
    await waitFor(() => expect(api.calls(`GET ${STATE_URL}`).length).toBeGreaterThan(1));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.change(screen.getByLabelText("Gmail level for robson@semmi.se"), { target: { value: "off" } });
    await waitFor(() => expect(api.calls(changeUrl)).toHaveLength(2));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("#A109 / #GA16 products already on are ticked and locked in the dialog; unticking is impossible there and no extra request is sent", async () => {
    const { api } = await setSlides(() => consent);
    const dlg = await screen.findByRole("dialog");
    const gmail = within(dlg).getByTestId("google-product-check-gmail") as HTMLInputElement;
    expect(gmail.checked).toBe(true);
    expect(gmail.disabled).toBe(true);
    fireEvent.click(gmail);
    expect(gmail.checked).toBe(true);
    fireEvent.click(cont());
    await screen.findByTestId("google-waiting", {}, wait);
    expect(api.calls(changeUrl)).toEqual([{ products: { slides: { level: "read" } } }]);
  });

  it("#A110 / #B120 a local account changed from another computer: the dialog says to use the dashboard's own computer; no Continue, no popup, account unchanged", async () => {
    const p = await page(state({ browser: "remote", builtin: { available: true, ref: "builtin-remote" }, accounts: [acct({ email: "robson@semmi.se" })] }), {
      [changeUrl]: () => json({ error: "local_browser_required" }, 409),
    });
    fireEvent.click(within(screen.getByTestId("google-account-row")).getByTestId("google-account-toggle"));
    fireEvent.change(screen.getByLabelText("Slides level for robson@semmi.se"), { target: { value: "read" } });
    const note = await screen.findByTestId("google-local-required");
    expect(note.textContent).toMatch(/open the dashboard on its own computer to change Google access/);
    expect(screen.queryByTestId("google-continue")).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
    expect(p.api.calls(changeUrl)).toHaveLength(1);
    expect((within(screen.getByTestId("google-account-row")).getByLabelText("Slides level for robson@semmi.se") as HTMLSelectElement).value).toBe("off");
  });

  it("a narrower reply for an existing account says nothing was changed and offers Try again", async () => {
    await setSlides(() => consent);
    await screen.findByRole("dialog");
    const h = mockApi({
      [`GET ${STATE_URL}`]: () => state({ clients: [semmi], accounts: [robson] }),
      ...flowRoutes([pendingStatus, { flowId: "f1", provider: "google", status: "error", error: "scope_missing" }]),
    });
    void h;
    fireEvent.click(cont());
    const err = await screen.findByTestId("google-connect-error", {}, wait);
    expect(err.textContent).toMatch(/Nothing was changed for robson@semmi\.se/);
    expect(screen.getByTestId("google-retry")).toBeTruthy();
  });
});

describe("#A106 / #B115 / #B120 refusals", () => {
  it("#B115 a full store names the fix for a new connect", async () => {
    await page(state(), { [POST_ACCOUNTS]: () => json({ error: "too_many_keys" }, 409) });
    await openConnect();
    fireEvent.click(cont());
    expect((await screen.findByTestId("google-start-error")).textContent).toMatch(/remove unused accounts or clients/);
  });
  it("a partial grant on a new connect connects the account and says what Google did not allow", async () => {
    const { box } = await page(state(), flowRoutes([pendingStatus, { flowId: "f1", provider: "google", status: "complete" }]));
    await openConnect();
    box.state = state({ accounts: [acct({ email: "p@x.com", products: { drive: { level: "files" } }, missing: ["gmail"] })] });
    fireEvent.click(cont());
    expect((await screen.findByTestId("google-connected-email", {}, wait)).textContent).toBe("p@x.com");
    expect(screen.getByTestId("google-connect-missing").textContent).toMatch(/Google did not allow Gmail/);
  });
});

describe("#B64 – #B69 / #GB11 Workspace blocks are actionable", () => {
  /** Start a sign-in again for `email` on `clientRef`, open the fold-out and report `code`. */
  async function reportOn(email: string, clientRef: "builtin" | `own:${string}`, code: string) {
    const clients = clientRef.startsWith("own:") ? [client({ id: clientRef.slice(4), label: "Semmi", accounts: 1 })] : [];
    const a = acct({ email, client: clientRef, status: "reauth_required" });
    await page(state({ clients, accounts: [a] }), { [`POST /api/plugins/google/accounts/${a.sub}/reauth`]: () => ({ ok: true, flowId: "f1", path: "local", client: clientRef }) });
    fireEvent.click(within(screen.getByTestId("google-account-row")).getByTestId("google-account-toggle"));
    fireEvent.click(screen.getByRole("button", { name: `Sign in again ${email}` }));
    await screen.findByTestId("google-waiting", {}, wait);
    openFold();
    fireEvent.click(screen.getByTestId(`google-report-${code}`));
  }
  const reportNew = async (code: string) => {
    await page(state());
    await openConnect();
    await waitingUp();
    openFold();
    fireEvent.click(screen.getByTestId(`google-report-${code}`));
  };

  it("#B66 admin_policy_enforced on the built-in app shows its client id, the explanation and Set up organisation sign-in prefilled with the domain", async () => {
    await reportOn("x@blackbelt.hu", "builtin", "admin_policy_enforced");
    const block = await screen.findByTestId("google-workspace-block");
    expect(within(block).getByTestId("google-block-client-id").textContent).toBe("BI-123.apps.googleusercontent.com");
    expect(within(block).getByTestId("google-block-text").textContent).toMatch(/admin blocks the app/);
    fireEvent.click(within(block).getByRole("button", { name: "Set up organisation sign-in" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByTestId("google-advanced-toggle").getAttribute("aria-expanded")).toBe("true");
    expect((screen.getByTestId("google-org-domain") as HTMLInputElement).value).toBe("blackbelt.hu");
  });

  it("#B67 org_internal on an own client shows that client's id and the Internal explanation, offering setup for the domain", async () => {
    await reportOn("a@semmi.se", "own:semmi-int", "org_internal");
    const block = await screen.findByTestId("google-workspace-block");
    expect(within(block).getByTestId("google-block-client-id").textContent).toBe("semmi-int.apps.googleusercontent.com");
    expect(within(block).getByTestId("google-block-text").textContent).toMatch(/Internal/);
    expect(within(block).getByTestId("google-block-domain").textContent).toBe("semmi.se");
    expect(within(block).getByRole("button", { name: "Set up organisation sign-in" })).toBeTruthy();
  });

  it.each([
    ["X@BlackBelt.HU", "blackbelt.hu"],
    ["a@mail.blackbelt.hu", "mail.blackbelt.hu"],
  ])("#B68 %s → the exact lower-case domain %s is offered", async (email, domain) => {
    await reportOn(email, "builtin", "admin_policy_enforced");
    const block = await screen.findByTestId("google-workspace-block");
    fireEvent.click(within(block).getByRole("button", { name: "Set up organisation sign-in" }));
    await waitFor(() => expect((screen.getByTestId("google-org-domain") as HTMLInputElement).value).toBe(domain));
  });

  it("#B68 with no email known there is no domain prefill but the action is still shown", async () => {
    await reportNew("admin_policy_enforced");
    const block = await screen.findByTestId("google-workspace-block");
    expect(within(block).queryByTestId("google-block-domain")).toBeNull();
    fireEvent.click(within(block).getByRole("button", { name: "Set up organisation sign-in" }));
    await waitFor(() => expect(screen.getByTestId("google-org-domain")).toBeTruthy());
    expect((screen.getByTestId("google-org-domain") as HTMLInputElement).value).toBe("");
  });

  it("#B69 another reported code (access_denied) does not suggest organisation sign-in", async () => {
    await reportNew("access_denied");
    expect((await screen.findByTestId("google-connect-error")).textContent).toMatch(/Google access was cancelled/);
    expect(screen.queryByTestId("google-workspace-block")).toBeNull();
    expect(screen.queryByRole("button", { name: "Set up organisation sign-in" })).toBeNull();
  });

  it("#GB11 the fold-out offers 'Google showed an error' with the fixed code list", async () => {
    await page(state());
    await openConnect();
    await waitingUp();
    openFold();
    const group = screen.getByRole("group", { name: "Google showed an error" });
    expect(within(group).getAllByRole("button").map((b) => b.dataset.testid)).toEqual([
      "google-report-org_internal",
      "google-report-access_denied",
      "google-report-admin_policy_enforced",
      "google-report-other",
    ]);
  });
});
