/**
 * Access page provisioning surfaces (change: add-access-provisioning, tasks
 * 3.4, 3.8, 3.9; test-plan rows E26, F3, plus the answerable / dismiss-all /
 * refetch behaviour of the section).
 */
import type { ProvisionRequestMessage } from "@blackbelt-technology/pi-dashboard-shared/browser-protocol.js";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProvisionRequestView } from "../../../lib/access-grants/access-prompts-api.js";
import { clearGrantChannel, setGrantChannel } from "../../../lib/access-grants/grant-channel.js";
import { ProvisionPromptStore } from "../../../lib/access-grants/provision-prompt-store.js";
import { AccessProvisioningSection } from "../AccessProvisioningSection.js";
import { AccessSection } from "../AccessSection.js";

type Call = { url: string; method: string; body?: unknown };
let calls: Call[] = [];
let requests: ProvisionRequestView[] = [];
let settleStatus = 200;
let grants: Record<string, unknown>;

const ok = (data: unknown = null) =>
  Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ success: true, data }) });

function makeView(id: string, root: string, over: Partial<ProvisionRequestView> = {}): ProvisionRequestView {
  return {
    requestId: id,
    status: "pending",
    projectRoot: root,
    lines: [
      { lineId: "a", path: `${root}-lib`, why: "needs it", classification: "grantable" },
      { lineId: "b", path: `${root}-docs`, why: "no reason given", classification: "grantable", projectRoot: true },
      { lineId: "c", path: "/w/.aws", why: "creds", classification: "sensitive" },
    ],
    remote: [{ target: "lan" }],
    createdAt: 1,
    expiresAt: Date.now() + 9 * 60_000,
    ...over,
  };
}

beforeEach(() => {
  calls = [];
  settleStatus = 200;
  requests = [makeView("r1", "/w/app")];
  clearGrantChannel();
  grants = {
    pathGrants: [
      { subject: "/w/lib", scope: "project", grantedAt: "2026-01-01T00:00:00Z", origin: "/w/app", via: "provision" },
      { subject: "/w/agent", scope: "project", grantedAt: "2026-01-01T00:00:00Z", origin: "/w/api", via: "agent-prompt" },
      { subject: "/w/prompted", scope: "project", grantedAt: "2026-01-01T00:00:00Z", origin: "/w/other", via: "prompt" },
    ],
    worktreeTrust: [],
    kbTrust: [],
    projectTrust: [],
    trustedNetworks: [],
    bypassHosts: [],
    corsOrigins: [],
    pinnedDirectories: [],
  };
  global.fetch = vi.fn((url: string, init?: { method?: string; body?: string }) => {
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url === "/api/access/provision" && method === "GET") return ok({ requests });
    if (url === "/api/access/provision/dismiss-all" && method === "POST") {
      const n = requests.length;
      requests = [];
      return ok({ dismissed: n });
    }
    const settle = url.match(/^\/api\/access\/provision\/([^/]+)\/settle$/);
    if (settle && method === "POST") {
      if (settleStatus !== 200) {
        return Promise.resolve({
          ok: false,
          status: settleStatus,
          json: () => Promise.resolve({ success: false, error: "already-settled" }),
        });
      }
      requests = requests.filter((r) => r.requestId !== settle[1]);
      return ok({});
    }
    if (url === "/api/access/grants" && method === "GET") return ok(grants);
    if (url === "/api/health") return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) });
    if (url === "/api/config") return ok({});
    return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) });
  }) as unknown as typeof fetch;
});

afterEach(() => cleanup());

const store = () => new ProvisionPromptStore();

describe("Access page: provisioned-grant label (E26)", () => {
  it("shows 'requested for /w/app' + revoke on the provisioned row; others keep their labels", async () => {
    render(<AccessSection />);
    const rows = await screen.findAllByTestId("access-entry");
    expect(rows).toHaveLength(3);
    // Rows are sorted by subject; pick by it.
    const row = (subject: string) => rows.find((r) => r.textContent?.includes(subject)) as HTMLElement;
    const [prov, agent, prompted] = [row("/w/lib"), row("/w/agent"), row("/w/prompted")];

    expect(within(prov).getByTestId("access-entry-via-provision").textContent).toBe("Provisioned");
    expect(within(prov).getByTestId("access-entry-requested-for").textContent).toBe("requested for /w/app");
    // The claim replaces `Origin:` on that row.
    expect(within(prov).queryByTestId("access-entry-origin")).toBeNull();
    expect(within(prov).getByTestId("access-revoke")).toBeTruthy();

    expect(within(agent).getByTestId("access-entry-via-agent-prompt").textContent).toBe("Agent prompt");
    expect(within(agent).getByTestId("access-entry-origin").textContent).toContain("/w/api");
    expect(within(agent).queryByTestId("access-entry-via-provision")).toBeNull();

    expect(within(prompted).getByTestId("access-entry-via-prompt").textContent).toBe("via prompt");
    expect(within(prompted).getByTestId("access-entry-origin").textContent).toContain("/w/other");
    expect(within(prompted).queryByTestId("access-entry-requested-for")).toBeNull();
  });
});

describe("Access page: read-only without a capability (F3)", () => {
  it("lists the request with no approve controls and states the reason", async () => {
    render(<AccessProvisioningSection store={store()} />);
    const card = await screen.findByTestId("access-provision-request");
    expect(within(card).getByTestId("access-provision-root").textContent).toBe("/w/app");
    // Lines are visible, classified, but nothing can be approved.
    expect(within(card).getAllByTestId("provision-line")).toHaveLength(3);
    expect(card.querySelector("input[type=checkbox]")).toBeNull();
    expect(screen.queryByTestId("access-provision-approve")).toBeNull();
    expect(screen.queryByTestId("access-provision-reject")).toBeNull();
    expect(within(card).getAllByTestId("provision-line-readonly")).toHaveLength(2);

    const reason = screen.getByTestId("access-provision-readonly");
    expect(reason.textContent).toContain("Read-only");
    expect(reason.textContent).toContain("prompt capability");
    // Dismiss all is inert, never hidden, and points at the reason.
    const dismiss = screen.getByTestId("access-provision-dismiss-all") as HTMLButtonElement;
    expect(dismiss.disabled).toBe(true);
    expect(dismiss.getAttribute("aria-describedby")).toBe(reason.id);
  });

  it("keeps the remote hand-off available read-only (it only opens a dialog)", async () => {
    render(<AccessProvisioningSection store={store()} />);
    const open = await screen.findByTestId("provision-open-remote");
    expect((open as HTMLButtonElement).disabled).toBe(false);
  });

  it("never POSTs without a capability", async () => {
    render(<AccessProvisioningSection store={store()} />);
    await screen.findByTestId("access-provision-request");
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });
});

describe("Access page: answerable provisioning requests (3.4)", () => {
  beforeEach(() => setGrantChannel("cap-1"));

  it("offers per-line approve controls, none preselected, and hides the read-only banner", async () => {
    render(<AccessProvisioningSection store={store()} />);
    const card = await screen.findByTestId("access-provision-request");
    const boxes = within(card).getAllByRole("checkbox", { name: /^Approve / });
    expect(boxes).toHaveLength(2);
    expect(boxes.every((b) => !(b as HTMLInputElement).checked)).toBe(true);
    expect(screen.queryByTestId("access-provision-readonly")).toBeNull();
    expect((screen.getByTestId("access-provision-approve") as HTMLButtonElement).disabled).toBe(true);
    expect(within(card).getByTestId("provision-consequence").textContent).toContain("every session on this machine");
  });

  it("approves the ticked lines over POST …/settle with the D9 wire shape and refetches", async () => {
    const s = store();
    s.apply({ ...(provisionMsg("r1")), expiresAt: Date.now() + 60_000 });
    render(<AccessProvisioningSection store={s} />);
    await screen.findByTestId("access-provision-request");
    fireEvent.click(screen.getByLabelText("Approve /w/app-docs"));
    fireEvent.click(screen.getByTestId("access-provision-approve"));
    await waitFor(() => expect(screen.queryByTestId("access-provision-request")).toBeNull());
    expect(calls).toContainEqual({
      url: "/api/access/provision/r1/settle",
      method: "POST",
      body: {
        lines: [
          { lineId: "a", verdict: "reject" },
          { lineId: "b", verdict: "approve", piTrust: false },
          { lineId: "c", verdict: "reject" },
        ],
      },
    });
    // The local dialog queue cannot answer it a second time.
    expect(s.claim("r1")).toBe(false);
    expect(screen.getByTestId("access-provision-empty")).toBeTruthy();
  });

  it("Reject request settles with every line rejected", async () => {
    render(<AccessProvisioningSection store={store()} />);
    await screen.findByTestId("access-provision-request");
    fireEvent.click(screen.getByLabelText("Approve /w/app-lib"));
    fireEvent.click(screen.getByTestId("access-provision-reject"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/settle"))).toBe(true));
    const settle = calls.find((c) => c.url.endsWith("/settle")) as Call;
    expect((settle.body as { lines: { verdict: string }[] }).lines.every((l) => l.verdict === "reject")).toBe(true);
  });

  it("surfaces a refused answer (409 already-settled) and refetches", async () => {
    settleStatus = 409;
    render(<AccessProvisioningSection store={store()} />);
    await screen.findByTestId("access-provision-request");
    fireEvent.click(screen.getByLabelText("Approve /w/app-lib"));
    fireEvent.click(screen.getByTestId("access-provision-approve"));
    expect((await screen.findByTestId("access-provision-error")).textContent).toContain("already-settled");
    expect(calls.filter((c) => c.method === "GET" && c.url === "/api/access/provision").length).toBeGreaterThan(1);
  });

  it("Dismiss all pending POSTs dismiss-all, no confirm, and empties the list", async () => {
    requests = [makeView("r1", "/w/app"), makeView("r2", "/w/two")];
    render(<AccessProvisioningSection store={store()} />);
    await waitFor(() => expect(screen.getAllByTestId("access-provision-request")).toHaveLength(2));
    expect(screen.getByRole("heading", { name: "Provisioning requests (2)" })).toBeTruthy();
    expect(screen.getByText(/counts toward that project's cooldown/)).toBeTruthy();
    fireEvent.click(screen.getByTestId("access-provision-dismiss-all"));
    await waitFor(() => expect(screen.queryAllByTestId("access-provision-request")).toHaveLength(0));
    expect(calls).toContainEqual({ url: "/api/access/provision/dismiss-all", method: "POST", body: undefined });
  });

  it("disables Dismiss all pending when nothing is pending", async () => {
    requests = [];
    render(<AccessProvisioningSection store={store()} />);
    await screen.findByTestId("access-provision-empty");
    expect((screen.getByTestId("access-provision-dismiss-all") as HTMLButtonElement).disabled).toBe(true);
  });

  it("refetches when the dialog queue changes (request ended in another tab)", async () => {
    const s = store();
    render(<AccessProvisioningSection store={s} />);
    await screen.findByTestId("access-provision-request");
    const before = calls.filter((c) => c.method === "GET").length;
    requests = [];
    s.apply({ type: "provision_dismiss", requestId: "r1", reason: "settled" });
    s.apply(provisionMsg("zz")); // any queue change bumps the version
    await waitFor(() => expect(screen.queryByTestId("access-provision-request")).toBeNull());
    expect(calls.filter((c) => c.method === "GET").length).toBeGreaterThan(before);
  });

  it("treats a server without the routes (404) as nothing pending, not an error", async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve(null) }),
    ) as unknown as typeof fetch;
    render(<AccessProvisioningSection store={store()} />);
    await screen.findByTestId("access-provision-empty");
    expect(screen.queryByTestId("access-provision-error")).toBeNull();
  });
});

function provisionMsg(id: string): ProvisionRequestMessage {
  return {
    type: "provision_request",
    requestId: id,
    projectRoot: "/w/app",
    lines: [],
    remote: [],
    expiresAt: Date.now() + 60_000,
  };
}
