import type { TlsCertStatus, TlsGate, TlsSourceStatus, TlsStatus, TlsStatusDetail } from "@blackbelt-technology/pi-dashboard-shared/tls-status.js";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearAcmeCredentialError } from "../../../lib/gateway/acme-credential-errors.js";
import * as tlsApi from "../../../lib/gateway/tls-api.js";
import { GatewayEndpoints } from "../GatewayEndpoints.js";
import { GatewayTlsSection } from "../GatewayTlsSection.js";

/**
 * Domain certificates (ACME) group + editor inside the Built-in HTTPS section: write-only secrets and
 * save order, terms gate + read-only id, renewal-blocked row, stage steps, gates.
 * Fixtures mirror the approved board (`openspec/changes/add-acme-dns01-certs/mockups/gateway-tls.html`).
 * (test-plan #E26, #E27, #E35). See change: add-acme-dns01-certs.
 */

const NOW = Date.parse("2026-10-19T09:00:00Z");
const day = (n: number): number => NOW + n * 86_400_000;
const D1 = "dash.example.com";
const D2 = "*.lab.example.com";
const FULL = "8e5700ea-a4bf-41c7-8a77-e990661dcc6a.auth.acme-dns.io";
const TOKEN = "cf-secret-token-0123456789-abcdef";

const source = (o: Partial<TlsSourceStatus> & { details?: TlsSourceStatus["details"] } = {}): TlsSourceStatus => ({
  id: "home",
  type: "acme",
  details: { directory: "production", staging: false, solverType: "cloudflare", propagationMode: "authoritative" },
  ...o,
});
const cert = (o: Partial<TlsCertStatus> = {}): TlsCertStatus => ({
  name: D1,
  sourceId: "home",
  sourceType: "acme",
  kind: "domain",
  held: true,
  notAfter: day(89),
  advertise: true,
  stage: "idle",
  ...o,
});
const gate = (o: Partial<TlsGate>): TlsGate => ({ id: "credentials", ok: false, sourceId: "home", ...o });
const base = (o: Partial<TlsStatusDetail> = {}): TlsStatusDetail => ({
  enabled: true,
  bound: true,
  port: 8443,
  host: "100.83.0.1",
  gates: [],
  sources: [source()],
  certs: [cert()],
  ...o,
});

const storedHome = (configured = true) => ({
  type: "acme",
  id: "home",
  domains: [D1, D2],
  email: "ops@example.com",
  agreeTos: true,
  directory: "production",
  solver: { type: "cloudflare", configured },
});

let status: TlsStatus;

const mount = () => render(<GatewayTlsSection now={() => NOW} />);
const group = (id: string) => screen.findByTestId(`gateway-tls-source-${id}`);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  clearAcmeCredentialError("lab");
  clearAcmeCredentialError("home");
});

beforeEach(() => {
  status = base();
  vi.spyOn(tlsApi, "getTlsStatus").mockImplementation(async () => status);
  vi.spyOn(tlsApi, "issueTlsNow").mockResolvedValue(undefined);
  vi.spyOn(tlsApi, "getStoredAcmeSources").mockResolvedValue([storedHome()] as never);
});

const fill = (label: string | RegExp, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });

/** Fill the new-source editor with valid fields (terms left as-is). */
function fillNewSource(id: string) {
  fill("Source name", id);
  fill("Contact email", "ops@example.com");
  fill("Domain to add", D1);
  fireEvent.click(screen.getByTestId("gateway-acme-domain-add"));
}

describe("#E26 secrets are write-only; save order entry → credentials", () => {
  it("opens the stored source with an EMPTY token input labelled Saved in the credential vault", async () => {
    mount();
    fireEvent.click(within(await group("home")).getByTestId("gateway-acme-edit"));
    const editor = await screen.findByTestId("gateway-acme-editor");
    const input = within(editor).getByLabelText("Cloudflare API token") as HTMLInputElement;
    expect(input.value).toBe("");
    expect(input.type).toBe("password");
    expect(within(editor).getByTestId("gateway-acme-cloudflare-token-state").textContent).toContain("Saved in the credential vault");
    expect(editor.textContent).not.toContain(TOKEN);
  });

  it("shows Not set when the vault has no secret for the source", async () => {
    vi.spyOn(tlsApi, "getStoredAcmeSources").mockResolvedValue([storedHome(false)] as never);
    mount();
    fireEvent.click(within(await group("home")).getByTestId("gateway-acme-edit"));
    const editor = await screen.findByTestId("gateway-acme-editor");
    expect(within(editor).getByTestId("gateway-acme-cloudflare-token-state").textContent).toContain("Not set");
  });

  it("saves the entry first, then the credentials; a credentials 500 keeps the source saved and shows the gate + error; the token is in no URL or storage", async () => {
    const calls: Array<{ method: string; path: string; url: string; body?: string }> = [];
    const respond = (body: unknown, httpStatus = 200) => new Response(JSON.stringify(body), { status: httpStatus, headers: { "content-type": "application/json" } });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const path = new URL(url, "http://dash.test").pathname;
        const method = init?.method ?? "GET";
        calls.push({ method, path, url, body: init?.body });
        if (path === "/api/health") return respond({ tls: status });
        if (path === "/api/config") return respond({ success: true, data: { tls: { enabled: true, sources: [storedHome()] } } });
        if (method === "PUT" && path === "/api/tls/acme/lab") return respond({ success: true });
        if (method === "PUT" && path === "/api/tls/acme/lab/credentials") return respond({ error: "vault write failed" }, 500);
        return respond({ success: true });
      }),
    );
    vi.spyOn(tlsApi, "getTlsStatus").mockRestore();
    vi.spyOn(tlsApi, "getStoredAcmeSources").mockRestore();
    const storageWrites = vi.spyOn(Storage.prototype, "setItem");
    const lab = source({ id: "lab", details: { directory: "staging", staging: true, solverType: "cloudflare" } });
    const view = mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fillNewSource("lab");
    fill("Cloudflare API token", TOKEN);
    fireEvent.click(screen.getByTestId("gateway-acme-tos"));
    // The server would report the saved-but-unauthenticated source on the next read.
    status = base({ sources: [source(), lab], certs: [cert(), cert({ sourceId: "lab", held: false, notAfter: undefined })], gates: [gate({ sourceId: "lab" })] });
    fireEvent.click(screen.getByTestId("gateway-acme-save"));

    const labGroup = await group("lab");
    const writes = calls.filter((c) => c.method === "PUT");
    expect(writes.map((c) => c.path)).toEqual(["/api/tls/acme/lab", "/api/tls/acme/lab/credentials"]);
    expect(JSON.parse(writes[0].body as string)).toMatchObject({ type: "acme", id: "lab", agreeTos: true, directory: "staging", domains: [D1], solver: { type: "cloudflare" } });
    expect(writes[0].body).not.toContain(TOKEN);
    expect(JSON.parse(writes[1].body as string)).toEqual({ token: TOKEN });
    // Source stays saved: the editor closed, the group shows the credentials gate and the error.
    expect(screen.queryByTestId("gateway-acme-editor")).toBeNull();
    expect(within(labGroup).getByTestId("gateway-acme-gate-credentials")).toBeDefined();
    await waitFor(() => expect(within(labGroup).getByTestId("gateway-acme-credentials-error").textContent).toBe("vault write failed"));
    // The secret is nowhere but the one body: no URL, no browser storage, no input.
    for (const c of calls) expect(c.url).not.toContain(TOKEN);
    for (const call of storageWrites.mock.calls) expect(call.join(" ")).not.toContain(TOKEN);
    for (const store of [window.localStorage, window.sessionStorage]) {
      for (let i = 0; i < (store?.length ?? 0); i += 1) {
        const key = store.key(i) as string;
        expect(`${key}=${store.getItem(key)}`).not.toContain(TOKEN);
      }
    }
    expect((within(labGroup).getByLabelText("Cloudflare API token") as HTMLInputElement).value).toBe("");
    // Only the credentials call is repeated from the group; the entry is not rewritten.
    fill("Cloudflare API token", TOKEN);
    fireEvent.click(within(labGroup).getByTestId("gateway-acme-credentials-save"));
    await waitFor(() => expect(calls.filter((c) => c.method === "PUT" && c.path === "/api/tls/acme/lab/credentials")).toHaveLength(2));
    expect(calls.filter((c) => c.method === "PUT" && c.path === "/api/tls/acme/lab")).toHaveLength(1);

    view.unmount();
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    expect((within(screen.getByTestId("gateway-acme-editor")).getByLabelText("Cloudflare API token") as HTMLInputElement).value).toBe("");
  });

  it("clears a typed secret on Cancel", async () => {
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fill("Cloudflare API token", TOKEN);
    fireEvent.click(screen.getByTestId("gateway-acme-cancel"));
    expect(screen.queryByTestId("gateway-acme-editor")).toBeNull();
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    expect((screen.getByLabelText("Cloudflare API token") as HTMLInputElement).value).toBe("");
  });

  it("sends only the entry when no secret was typed", async () => {
    const putEntry = vi.spyOn(tlsApi, "putAcmeSource").mockResolvedValue(undefined);
    const putCreds = vi.spyOn(tlsApi, "putAcmeCredentials").mockResolvedValue(undefined);
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fillNewSource("lab");
    fireEvent.click(screen.getByTestId("gateway-acme-tos"));
    fireEvent.click(screen.getByTestId("gateway-acme-save"));
    await waitFor(() => expect(putEntry).toHaveBeenCalledTimes(1));
    expect(putCreds).not.toHaveBeenCalled();
  });

  it("shows a server refusal at the field it names and keeps the editor open", async () => {
    vi.spyOn(tlsApi, "putAcmeSource").mockRejectedValue(new Error("tls.sources[1].email must look like an email address"));
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fillNewSource("lab");
    fireEvent.click(screen.getByTestId("gateway-acme-tos"));
    fireEvent.click(screen.getByTestId("gateway-acme-save"));
    const email = screen.getByLabelText("Contact email");
    await waitFor(() => expect(email.getAttribute("aria-invalid")).toBe("true"));
    const err = document.getElementById(email.getAttribute("aria-describedby") as string) as HTMLElement;
    expect(err.getAttribute("role")).toBe("alert");
    expect(err.textContent).toContain("email");
    expect(screen.getByTestId("gateway-acme-editor")).toBeDefined();
  });
});

describe("#E27 terms gate + read-only id", () => {
  it("disables Save with a linked reason until the terms are accepted", async () => {
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fillNewSource("lab");
    const save = screen.getByTestId("gateway-acme-save") as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    const reason = document.getElementById(save.getAttribute("aria-describedby") as string) as HTMLElement;
    expect(reason.textContent).toBe("Accept the terms to save.");
    fireEvent.click(screen.getByTestId("gateway-acme-tos"));
    expect((screen.getByTestId("gateway-acme-save") as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByTestId("gateway-acme-save").getAttribute("aria-describedby")).toBeNull();
  });

  it("shows the id read-only for a saved source and editable for a new one", async () => {
    mount();
    fireEvent.click(within(await group("home")).getByTestId("gateway-acme-edit"));
    const saved = (await screen.findByTestId("gateway-acme-id")) as HTMLInputElement;
    expect(saved.value).toBe("home");
    expect(saved.readOnly).toBe(true);
    fireEvent.click(screen.getByTestId("gateway-acme-cancel"));
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    expect((screen.getByTestId("gateway-acme-id") as HTMLInputElement).readOnly).toBe(false);
  });

  it("refuses the reserved id and an existing id before any request", async () => {
    const putEntry = vi.spyOn(tlsApi, "putAcmeSource").mockResolvedValue(undefined);
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fillNewSource("tailscale");
    fireEvent.click(screen.getByTestId("gateway-acme-tos"));
    fireEvent.click(screen.getByTestId("gateway-acme-save"));
    expect(screen.getByRole("alert").textContent).toContain("reserved for the Tailscale source");
    fill("Source name", "home");
    fireEvent.click(screen.getByTestId("gateway-acme-save"));
    expect(screen.getAllByRole("alert")[0].textContent).toContain("already uses this name");
    expect(putEntry).not.toHaveBeenCalled();
  });

  it("rejects a malformed wildcard at the domain field and keeps Add disabled", async () => {
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    fill("Domain to add", "dash.*.example.com");
    expect(screen.getByLabelText("Domain to add").getAttribute("aria-invalid")).toBe("true");
    expect((screen.getByTestId("gateway-acme-domain-add") as HTMLButtonElement).disabled).toBe(true);
    fill("Domain to add", "Dash.Example.COM.");
    expect((screen.getByTestId("gateway-acme-domain-add") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByTestId("gateway-acme-domain-add"));
    expect(screen.getByTestId("gateway-acme-domains").textContent).toContain("dash.example.com");
  });

  it("states the Certificate Transparency disclosure before the first save", async () => {
    mount();
    await group("home");
    fireEvent.click(screen.getByTestId("gateway-acme-add"));
    expect(screen.getByTestId("gateway-acme-ct-note").textContent).toContain("Certificate Transparency");
  });

  it("shows the staging → production consequence before Save, without a dialog", async () => {
    vi.spyOn(tlsApi, "getStoredAcmeSources").mockResolvedValue([{ ...storedHome(), directory: "staging" }] as never);
    mount();
    fireEvent.click(within(await group("home")).getByTestId("gateway-acme-edit"));
    await screen.findByTestId("gateway-acme-editor");
    expect(screen.queryByTestId("gateway-acme-switching")).toBeNull();
    fireEvent.click(screen.getByTestId("gateway-acme-dir-production"));
    expect(screen.getByTestId("gateway-acme-switching").textContent).toContain("Switching to production");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("#E35 renewal blocked", () => {
  const record = `_acme-challenge.${D1}  CNAME  ${FULL}`;
  const blocked = (): TlsStatusDetail =>
    base({
      sources: [source({ details: { directory: "production", staging: false, solverType: "acme-dns", fulldomain: FULL, [`checkedAt:${D1}`]: new Date(NOW - 4 * 60_000).toISOString() } })],
      certs: [cert({ notAfter: day(20) })],
      gates: [gate({ id: "dns-cname", name: D1 })],
    });

  it("shows a warning Renewal blocked row naming the gate and the expiry date, with the record and Check now", async () => {
    status = blocked();
    mount();
    const row = await screen.findByTestId("gateway-tls-cert");
    expect(within(row).getByTestId("gateway-tls-cert-pill").textContent).toContain("Renewal blocked");
    const note = within(row).getByTestId("gateway-acme-renewal-blocked");
    expect(note.textContent).toContain("the CNAME record is missing");
    expect(note.textContent).toContain(new Date(day(20)).toISOString().slice(0, 10));
    expect(within(row).getByTestId("gateway-acme-record").textContent).toBe(record);
    expect(row.textContent).toContain("Checked 4 minutes ago.");
    expect(within(row).queryByTestId("gateway-tls-issue-now")).toBeNull();
    expect((await group("home")).querySelector("[data-testid=gateway-acme-pill]")?.textContent).toContain("Needs attention");
  });

  it("Check now asks the issue route for that name", async () => {
    status = blocked();
    mount();
    fireEvent.click(await screen.findByTestId("gateway-acme-check-now"));
    await waitFor(() => expect(tlsApi.issueTlsNow).toHaveBeenCalledWith("home", D1));
  });

  it("does not claim a blocked renewal while the certificate is outside its renewal window", async () => {
    status = base({ ...blocked(), certs: [cert({ notAfter: day(80) })] });
    mount();
    const row = await screen.findByTestId("gateway-tls-cert");
    expect(within(row).queryByTestId("gateway-acme-renewal-blocked")).toBeNull();
    expect(within(row).getByTestId("gateway-acme-gate-dns-cname").textContent).toContain(record);
  });
});

describe("rows: stages, badges, errors", () => {
  it("maps each acme stage to a step with aria-current, and an unknown stage to Working… without steps", async () => {
    status = base({ certs: [cert({ held: false, notAfter: undefined, stage: "propagation" })] });
    const view = mount();
    const row = await screen.findByTestId("gateway-tls-cert");
    const current = row.querySelector('[aria-current="step"]') as HTMLElement;
    expect(current.textContent).toContain("Wait for DNS");
    expect(within(row).getByTestId("gateway-tls-cert-pill").textContent).toContain("Requesting…");
    expect(within(row).getByTestId("gateway-tls-issue-now").textContent).toContain("Working…");
    view.unmount();
    status = base({ certs: [cert({ held: false, notAfter: undefined, stage: "mystery" })] });
    mount();
    const unknown = await screen.findByTestId("gateway-tls-cert");
    expect(unknown.querySelector("[data-testid=gateway-acme-steps]")).toBeNull();
    expect(within(unknown).getByTestId("gateway-tls-cert-pill").textContent).toContain("Working…");
  });

  it("badges staging, not-advertised and wildcard rows in words, and offers Switch to production", async () => {
    status = base({
      sources: [source({ details: { directory: "staging", staging: true, solverType: "cloudflare" } })],
      certs: [cert({ advertise: false }), cert({ name: D2, advertise: false })],
    });
    vi.spyOn(tlsApi, "getStoredAcmeSources").mockResolvedValue([{ ...storedHome(), directory: "staging" }] as never);
    mount();
    const g = await group("home");
    expect(g.textContent).toContain("Staging · browsers warn");
    expect(g.textContent).toContain("Not advertised");
    expect(g.textContent).toContain("Wildcard · served, not listed");
    expect(within(g).getByTestId("gateway-acme-pill").textContent).toContain("Staging only");
    expect(within(g).getByTestId("gateway-acme-staging-note")).toBeDefined();
    fireEvent.click(within(g).getByTestId("gateway-acme-switch-production"));
    await screen.findByTestId("gateway-acme-editor");
    expect(screen.getByTestId("gateway-acme-dir-production").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByTestId("gateway-acme-switching")).toBeDefined();
  });

  it("warns about Let's Encrypt's failed-validation limit after a CA invalid, with the retry ETA", async () => {
    status = base({
      certs: [
        cert({
          lastError: "urn:ietf:params:acme:error:unauthorized: invalid challenge response for dash.example.com",
          nextAttemptAt: NOW + 52 * 60_000,
        }),
      ],
    });
    mount();
    const g = await group("home");
    expect(g.textContent).toContain("Next try in 52 minutes.");
    expect(g.textContent).toContain("fix the record before trying again now");
    expect(within(g).getByTestId("gateway-acme-pill").textContent).toContain("Failing");
  });

  it("does not show the validation note for a non-CA error", async () => {
    status = base({ certs: [cert({ held: false, notAfter: undefined, lastError: "DNS propagation timed out after 180 s", nextAttemptAt: NOW + 9 * 60_000 })] });
    mount();
    expect((await group("home")).textContent).not.toContain("failed validations");
  });
});

describe("credentials gate", () => {
  it("shows the missing-token gate and a write-only field; Save token sends only the credentials call", async () => {
    status = base({ certs: [cert({ held: false, notAfter: undefined })], gates: [gate({})] });
    const putCreds = vi.spyOn(tlsApi, "putAcmeCredentials").mockResolvedValue(undefined);
    const putEntry = vi.spyOn(tlsApi, "putAcmeSource").mockResolvedValue(undefined);
    mount();
    const g = await group("home");
    expect(within(g).getByTestId("gateway-acme-pill").textContent).toContain("Setup needed");
    expect(g.textContent).toContain("No Cloudflare token yet.");
    expect((within(g).getByTestId("gateway-acme-credentials-save") as HTMLButtonElement).disabled).toBe(true);
    fill("Cloudflare API token", TOKEN);
    fireEvent.click(within(g).getByTestId("gateway-acme-credentials-save"));
    await waitFor(() => expect(putCreds).toHaveBeenCalledWith("home", { token: TOKEN }));
    expect(putEntry).not.toHaveBeenCalled();
    await waitFor(() => expect((screen.getByLabelText("Cloudflare API token") as HTMLInputElement).value).toBe(""));
  });

  it("states a rejected token as an error and pauses wording", async () => {
    status = base({ gates: [gate({ hint: "Cloudflare rejected the token (403)" })] });
    mount();
    const g = await group("home");
    expect(within(g).getByTestId("gateway-acme-pill").textContent).toContain("Failing");
    expect(within(g).getByTestId("gateway-acme-cloudflare-token-state").textContent).toContain("Rejected");
    expect(g.textContent).toContain("Issuing is paused");
  });

  it("asks for acme-dns user and key together", async () => {
    status = base({
      sources: [source({ details: { directory: "production", staging: false, solverType: "acme-dns" } })],
      gates: [gate({})],
    });
    const putCreds = vi.spyOn(tlsApi, "putAcmeCredentials").mockResolvedValue(undefined);
    mount();
    const g = await group("home");
    const save = within(g).getByTestId("gateway-acme-credentials-save") as HTMLButtonElement;
    fill("Username", "9a0b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d");
    expect(save.disabled).toBe(true);
    fill("Password", "k".repeat(40));
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    await waitFor(() => expect(putCreds).toHaveBeenCalledWith("home", { user: "9a0b1c2d-3e4f-5a6b-7c8d-9e0f1a2b3c4d", key: "k".repeat(40) }));
  });
});

describe("remove", () => {
  it("removes the source with DELETE after a confirmation", async () => {
    const del = vi.spyOn(tlsApi, "deleteAcmeSource").mockResolvedValue(undefined);
    mount();
    fireEvent.click(within(await group("home")).getByTestId("gateway-acme-edit"));
    await screen.findByTestId("gateway-acme-editor");
    fireEvent.click(screen.getByTestId("gateway-acme-remove"));
    expect(del).not.toHaveBeenCalled();
    await act(async () => fireEvent.click(screen.getByTestId("gateway-acme-remove-yes")));
    expect(del).toHaveBeenCalledWith("home");
    await waitFor(() => expect(screen.queryByTestId("gateway-acme-editor")).toBeNull());
  });
});

describe("Accessible at: staging note (C1/C2)", () => {
  const endpoints = [{ kind: "lan" as const, url: "http://192.168.1.24:8000", tls: false }];
  const staging = (): TlsStatusDetail => base({ sources: [source({ details: { directory: "staging", staging: true, solverType: "cloudflare" } })] });

  it("says why a staging name is not listed", () => {
    render(<GatewayEndpoints endpoints={endpoints} tlsStatus={staging()} />);
    expect(screen.getByTestId("gateway-endpoint-staging-note").textContent).toContain(`${D1} isn't listed: it has a staging certificate`);
  });

  it("shows no note for a production name, and none for a wildcard", () => {
    render(<GatewayEndpoints endpoints={endpoints} tlsStatus={base()} />);
    expect(screen.queryByTestId("gateway-endpoint-staging-note")).toBeNull();
    cleanup();
    render(<GatewayEndpoints endpoints={endpoints} tlsStatus={{ ...staging(), certs: [cert({ name: D2 })] }} />);
    expect(screen.queryByTestId("gateway-endpoint-staging-note")).toBeNull();
  });
});
