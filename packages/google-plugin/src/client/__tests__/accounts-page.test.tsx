// @vitest-environment jsdom
/**
 * L1 tests for the Settings → Google accounts page: summary + product table, the one primary button, status pills,
 * accessible names, disabled-with-reason controls, the access-model statement, Drive levels, partial grants, disconnect.
 * See change: add-google-connect (test-plan #A16 #A17 #A106 #B61–#B64 #B70 #B74 #B97 #B100–#B102 #B104, #C42, #GB10).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
// @ts-expect-error types of this transitive dev dependency do not resolve under package "exports"
import { computeAccessibleName } from "dom-accessibility-api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acct, client, flowRoutes, json, mockApi, renderSettings, STATE_URL, state } from "./harness.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const load = async (s: ReturnType<typeof state>, extra: Parameters<typeof mockApi>[0] = {}) => {
  const api = mockApi({ [`GET ${STATE_URL}`]: () => s, ...extra });
  renderSettings();
  await screen.findByTestId("google-settings");
  await screen.findByTestId("google-connect");
  return api;
};
const rows = () => screen.queryAllByTestId("google-account-row") as HTMLElement[];
const expand = (row: HTMLElement) => fireEvent.click(within(row).getByTestId("google-account-toggle"));
const visible = (el: HTMLElement | null) => !!el && !el.hidden && !el.closest("[hidden]") && !/sr-only/.test(el.className) && !!el.textContent?.trim();

describe("#B61 summary and expanded table", () => {
  it("shows 'Gmail · Drive' collapsed; expanded lists all 8 products, email, alias and a status pill", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", alias: "work", products: { gmail: { level: "send" }, drive: { level: "files" } } })] }));
    const [row] = rows() as [HTMLElement];
    expect(within(row).getByTestId("google-account-summary").textContent).toContain("Gmail · Drive");
    expect(within(row).getByTestId("google-account-status")).toBeTruthy();
    expect(row.textContent).toContain("a@x.com");
    expect(row.textContent).toContain("work");
    expect(within(row).queryByTestId("google-product-table")).toBeNull();
    expand(row);
    const table = within(row).getByTestId("google-product-table");
    const names = ["Gmail", "Calendar", "Drive", "Docs", "Sheets", "Slides", "Tasks", "Contacts"];
    for (const n of names) expect(within(table).getAllByText(n).length).toBeGreaterThan(0);
    const value = (p: string) => (within(row).getByLabelText(`${p} level for a@x.com`) as HTMLSelectElement).value;
    expect(value("Gmail")).toBe("send");
    expect(value("Drive")).toBe("files");
    for (const p of ["Calendar", "Docs", "Sheets", "Slides", "Tasks", "Contacts"]) expect(value(p)).toBe("off");
  });
});

describe("#B62 the one primary button", () => {
  it.each([
    [0, "Connect a Google account"],
    [1, "Connect another Google account"],
    [2, "Connect another Google account"],
    [12, "Connect another Google account"],
  ])("%i accounts → exactly one primary button, labelled %s; organisation section collapsed", async (n, label) => {
    await load(state({ accounts: Array.from({ length: n }, (_, i) => acct({ email: `u${i}@x.com` })) }));
    const primaries = document.querySelectorAll("button.bg-\\[var\\(--accent-solid\\)\\]");
    expect(primaries.length).toBe(1);
    expect(primaries[0]?.textContent).toBe(label);
    expect(screen.getByTestId("google-advanced-toggle").getAttribute("aria-expanded")).toBe("false");
  });
});

describe("#B63 / #GB10 account with no product on", () => {
  it("says 'No products on'", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", products: {} })] }));
    expect(within(rows()[0] as HTMLElement).getByTestId("google-account-summary").textContent).toBe("No products on");
  });
  it("lists products in catalogue order whatever the stored order", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", products: { contacts: { level: "read" }, gmail: { level: "readonly" }, calendar: { level: "read" } } })] }));
    expect(within(rows()[0] as HTMLElement).getByTestId("google-account-summary").textContent).toBe("Gmail · Calendar · Contacts");
  });
});

describe("#B64 alias", () => {
  it("shows the alias when set and never the text 'undefined'", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", alias: "work" }), acct({ email: "b@x.com" })] }));
    const [a, b] = rows() as [HTMLElement, HTMLElement];
    expect(a.textContent).toContain("work");
    expect(a.textContent).toContain("a@x.com");
    expect(b.textContent).toContain("b@x.com");
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });
});

describe("#B100 status pill is text, not colour only", () => {
  it("ok → Connected; reauth_required → Sign in again + a Sign in again action", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com" }), acct({ email: "b@x.com", status: "reauth_required" })] }));
    const [a, b] = rows() as [HTMLElement, HTMLElement];
    const pa = within(a).getByTestId("google-account-status");
    expect(pa.textContent).toBe("Connected");
    expect(pa.dataset.status).toBe("ok");
    const pb = within(b).getByTestId("google-account-status");
    expect(pb.textContent).toBe("Sign in again");
    expect(pb.dataset.status).toBe("reauth_required");
    expand(b);
    expect(within(b).getByRole("button", { name: "Sign in again b@x.com" })).toBeTruthy();
  });
});

describe("#B101 accessible names carry the account email", () => {
  it("every control in an account row names its account; no two controls share a name", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com" }), acct({ email: "b@x.com" })] }));
    for (const r of rows()) expand(r);
    expect(screen.getByRole("button", { name: "Disconnect a@x.com" })).toBeTruthy();
    expect(screen.getByLabelText("Gmail level for a@x.com")).toBeTruthy();
    const names: string[] = [];
    for (const r of rows()) {
      for (const el of r.querySelectorAll<HTMLElement>("button, input, select, textarea")) {
        const name = computeAccessibleName(el);
        expect(name, el.outerHTML.slice(0, 80)).toBeTruthy();
        expect(name).toContain(r.dataset.email);
        names.push(name);
      }
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("#B102 disabled controls explain themselves", () => {
  const described = (el: Element) => {
    const id = el.getAttribute("aria-describedby");
    expect(id, el.outerHTML.slice(0, 100)).toBeTruthy();
    const target = document.getElementById(id as string);
    expect(visible(target), `${id} visible with text`).toBe(true);
    return target?.textContent ?? "";
  };
  it("Drive read/write on a built-in account and Gmail on a remote-return account point at a visible reason", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", products: { drive: { level: "files" } } }), acct({ email: "r@x.com", client: "builtin-remote", products: { calendar: { level: "read" } } })] }));
    for (const r of rows()) expand(r);
    const driveA = screen.getByLabelText("Drive level for a@x.com");
    expect(described(driveA)).toMatch(/organisation's own sign-in/);
    const disabled = [...document.querySelectorAll('option:disabled, select:disabled, button:disabled')];
    expect(disabled.length).toBeGreaterThanOrEqual(4);
    for (const el of disabled) described(el);
    const gmailR = within(screen.getByLabelText("Gmail level for r@x.com")).getByRole("option", { name: /Read, draft and send/ }) as HTMLOptionElement;
    expect(gmailR.disabled).toBe(true);
  });
  it("a local account seen from another computer says so (the change itself is refused by the server)", async () => {
    await load(state({ browser: "remote", builtin: { available: true, ref: "builtin-remote" }, accounts: [acct({ email: "a@x.com" })] }));
    expand(rows()[0] as HTMLElement);
    expect(screen.getByTestId("google-local-only").textContent).toMatch(/own computer/);
  });
  it("Disconnect while busy is disabled and points at the status text", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    await load(state({ accounts: [acct({ email: "a@x.com" })] }), {
      "DELETE /api/plugins/google/accounts/sub-a": async () => {
        await gate;
        return { ok: true, removed: true, remoteRevoked: null };
      },
    });
    expand(rows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect a@x.com" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByTestId("google-disconnect-confirm"));
    const btn = await waitFor(() => {
      const b = screen.getByRole("button", { name: "Disconnect a@x.com" }) as HTMLButtonElement;
      expect(b.disabled).toBe(true);
      return b;
    });
    expect(described(btn)).toMatch(/Working/);
    release();
  });
});

describe("#B104 access model", () => {
  it("is hidden while collapsed and visible with the table when expanded, naming who may use the account", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com" })] }));
    const row = rows()[0] as HTMLElement;
    expect(within(row).queryByTestId("google-access-model")).toBeNull();
    expand(row);
    const text = within(row).getByTestId("google-access-model").textContent ?? "";
    expect(text).toMatch(/dashboard enforces these levels, not Google/);
    expect(text).toMatch(/every agent session on the dashboard's own computer may use this account within these levels/i);
    expect(text).toMatch(/sessions connected from other computers cannot/);
    expect(within(row).getByTestId("google-product-table")).toBeTruthy();
  });
});

describe("#A16 / #A17 / #C42 Drive levels", () => {
  const optionsOf = (email: string) => Array.from((screen.getByLabelText(`Drive level for ${email}`) as HTMLSelectElement).options);
  it("built-in account: only 'Files I pick or create' is enabled; the other two are disabled with the reason", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", products: { drive: { level: "files" } } })] }));
    expand(rows()[0] as HTMLElement);
    const byText = (re: RegExp) => optionsOf("a@x.com").find((o) => re.test(o.textContent ?? "")) as HTMLOptionElement;
    expect(byText(/Files I pick or create/).disabled).toBe(false);
    for (const re of [/^Read all/, /^Read and change all/]) {
      const o = byText(re);
      expect(o.disabled).toBe(true);
      expect(o.textContent).toContain("needs your organisation's own sign-in");
    }
  });
  it("own-client account: all three levels enabled, no reason", async () => {
    await load(state({ clients: [client({ id: "bb", label: "BlackBelt", domains: ["blackbelt.hu"], accounts: 1 })], accounts: [acct({ email: "t@blackbelt.hu", client: "own:bb", products: { drive: { level: "read" } } })] }));
    expand(rows()[0] as HTMLElement);
    const drive = optionsOf("t@blackbelt.hu").filter((o) => o.value !== "off");
    expect(drive.map((o) => o.value)).toEqual(["files", "read", "write"]);
    expect(drive.every((o) => !o.disabled)).toBe(true);
    expect(drive.some((o) => /own sign-in/.test(o.textContent ?? ""))).toBe(false);
  });
  it("Drive row: read/write unavailable for built-in with the 'files' explanation; available for an own client", async () => {
    await load(state({ clients: [client({ id: "bb", label: "BlackBelt", accounts: 1 })], accounts: [acct({ email: "a@x.com", products: { drive: { level: "files" } } }), acct({ email: "t@x.com", client: "own:bb", products: { drive: { level: "files" } } })] }));
    const [a, t] = rows() as [HTMLElement, HTMLElement];
    expand(a);
    expand(t);
    expect(within(a).getByTestId("google-drive-note").textContent).toMatch(/only files you pick for it or files it created/);
    expect(within(t).queryByTestId("google-drive-note")).toBeNull();
  });
});

describe("#A106 partial grants", () => {
  it("Gmail row shows off with a scope_missing message and a retry; Drive row is on", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com", products: { drive: { level: "files" } }, missing: ["gmail"] })] }));
    expand(rows()[0] as HTMLElement);
    expect((screen.getByLabelText("Gmail level for a@x.com") as HTMLSelectElement).value).toBe("off");
    const status = screen.getByTestId("google-product-status-gmail");
    expect(status.dataset.status).toBe("scope_missing");
    expect(status.textContent).toMatch(/Google did not allow this/);
    expect(screen.getByRole("button", { name: "Try again for Gmail on a@x.com" })).toBeTruthy();
    expect((screen.getByLabelText("Drive level for a@x.com") as HTMLSelectElement).value).toBe("files");
  });
});

describe("#B70 / #B74 disconnect", () => {
  const open = async (api: Awaited<ReturnType<typeof load>>) => {
    expand(rows()[0] as HTMLElement);
    fireEvent.click(screen.getByRole("button", { name: "Disconnect a@x.com" }));
    return screen.findByRole("dialog");
  };
  it("#B70 cancelling the confirmation deletes nothing and sends no request", async () => {
    const api = await load(state({ accounts: [acct({ email: "a@x.com" })] }));
    const dlg = await open(api);
    fireEvent.click(within(dlg).getByTestId("google-disconnect-cancel"));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(api.fn.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "DELETE")).toHaveLength(0);
    expect(rows()).toHaveLength(1);
  });
  it("#B74 the option states the every-dashboard effect, is unchecked by default and the account is named", async () => {
    const api = await load(state({ accounts: [acct({ email: "a@x.com" })] }));
    const dlg = await open(api);
    expect(dlg.textContent).toContain("a@x.com");
    const box = within(dlg).getByRole("checkbox", { name: /Also remove access at Google/ }) as HTMLInputElement;
    expect(box.checked).toBe(false);
    expect(dlg.textContent).toMatch(/Ends access for every dashboard that uses the same app for this Google account/);
  });
  it("confirming with the option sends revoke=true; Google unreachable shows the manual-removal notice", async () => {
    const api = await load(state({ accounts: [acct({ email: "a@x.com" })] }), {
      "DELETE /api/plugins/google/accounts/sub-a?revoke=true": () => ({ ok: true, removed: true, remoteRevoked: false }),
    });
    const dlg = await open(api);
    fireEvent.click(within(dlg).getByRole("checkbox", { name: /Also remove access at Google/ }));
    fireEvent.click(within(dlg).getByTestId("google-disconnect-confirm"));
    const notice = await screen.findByTestId("google-disconnect-result");
    expect(notice.textContent).toMatch(/myaccount\.google\.com\/connections/);
  });
});

describe("#B97 the section paints with theme tokens only", () => {
  it("no hex/rgb/hsl literal, no undeclared or fallback-form colour token, no raw palette class", async () => {
    // @ts-expect-error plain .mjs script without a declaration file
    const { scan } = (await import("../../../../../scripts/theme-token-guard.mjs")) as {
      scan: (o: { roots: string[] }) => Record<"fallback" | "undeclared" | "accentText" | "rawPalette", Record<string, number>>;
    };
    const found = scan({ roots: ["packages/google-plugin/src/client"] });
    expect(found).toEqual({ fallback: {}, undeclared: {}, accentText: {}, rawPalette: {} });
    const dir = join(import.meta.dirname, "..");
    for (const f of ["GoogleSettings.tsx", "AccountCard.tsx", "ConnectDialog.tsx", "OrgSignIn.tsx", "ui.ts"]) {
      const src = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
      expect(src, f).not.toMatch(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/);
    }
  });
  it("informational text uses text-primary or text-secondary", async () => {
    await load(state({ accounts: [acct({ email: "a@x.com" })] }));
    expand(rows()[0] as HTMLElement);
    const info = screen.getByTestId("google-access-model");
    expect(info.className).toMatch(/--text-(primary|secondary)/);
  });
});

describe("account actions", () => {
  it("lowering a level posts it and refreshes without a dialog", async () => {
    const api = await load(state({ accounts: [acct({ email: "a@x.com", products: { gmail: { level: "send" } } })] }), {
      "POST /api/plugins/google/accounts/sub-a/products": () => ({ ok: true, applied: true, account: acct({ email: "a@x.com" }) }),
    });
    expand(rows()[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Gmail level for a@x.com"), { target: { value: "readonly" } });
    await waitFor(() => expect(api.calls("POST /api/plugins/google/accounts/sub-a/products")).toEqual([{ products: { gmail: { level: "readonly" } } }]));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("turning a product off posts null", async () => {
    const api = await load(state({ accounts: [acct({ email: "a@x.com" })] }), {
      "POST /api/plugins/google/accounts/sub-a/products": () => ({ ok: true, applied: true, account: acct({ email: "a@x.com", products: {} }) }),
    });
    expand(rows()[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Gmail level for a@x.com"), { target: { value: "off" } });
    await waitFor(() => expect(api.calls("POST /api/plugins/google/accounts/sub-a/products")).toEqual([{ products: { gmail: null } }]));
  });
  it("saves an alias with PATCH", async () => {
    const api = await load(state({ accounts: [acct({ email: "a@x.com" })] }), {
      "PATCH /api/plugins/google/accounts/sub-a": () => ({ account: acct({ email: "a@x.com", alias: "work" }) }),
    });
    expand(rows()[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Alias for a@x.com"), { target: { value: "work" } });
    fireEvent.click(screen.getByRole("button", { name: "Save alias for a@x.com" }));
    await waitFor(() => expect(api.calls("PATCH /api/plugins/google/accounts/sub-a")).toEqual([{ alias: "work" }]));
  });
  it("shows a load error instead of the page", async () => {
    mockApi({ [`GET ${STATE_URL}`]: () => json({ error: "boom" }, 500) });
    renderSettings();
    expect((await screen.findByTestId("google-load-error")).textContent).toMatch(/boom/);
  });
});

void flowRoutes;
