/**
 * `fetchVault` keeps the machine code and remedies of a refusal instead of folding
 * the envelope into one message string.
 * See change: surface-operate-required-remedy (test-plan E14).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setGlobalApiBase } from "../../api/api-context.js";
import { fetchVault, fetchVaultProjects, isVaultWriteBlocked, type VaultOverview, vaultLock } from "../vault-api.js";

const JSON_HEADERS = new Headers({ "content-type": "application/json" });

function stubFetch(status: number, body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve({ ok: status >= 200 && status < 300, status, headers: JSON_HEADERS, json: () => Promise.resolve(body) })),
  );
}

/** A reply whose content-type is not JSON (SPA shell, proxy error page). */
function stubHtml(status: number, statusText = "") {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("<!DOCTYPE html><html></html>", { status, statusText, headers: { "content-type": "text/html" } }))),
  );
}
afterEach(() => vi.unstubAllGlobals());

describe("E14 fetchVault envelope parsing", () => {
  it("a 403 operate_required with remedies exposes code + remedies", async () => {
    stubFetch(403, { success: false, error: "operate_required", message: "the vault needs an operate-tier credential or a locally trusted caller", reason: "no-credential", remedies: ["use-host", "sign-in"] });
    const res = await fetchVault();
    expect(res.ok).toBe(false);
    expect(res.status).toBe(403);
    expect(res.code).toBe("operate_required");
    expect(res.remedies).toEqual(["use-host", "sign-in"]);
    expect(res.error).toBe("the vault needs an operate-tier credential or a locally trusted caller");
  });

  it("a 403 without remedies leaves remedies undefined", async () => {
    stubFetch(403, { success: false, error: "operate_required", message: "m" });
    const res = await fetchVault();
    expect(res.code).toBe("operate_required");
    expect(res.remedies).toBeUndefined();
  });

  it("a non-array remedies value is ignored", async () => {
    stubFetch(403, { success: false, error: "operate_required", message: "m", remedies: "use-host" });
    expect((await fetchVault()).remedies).toBeUndefined();
  });

  it("a 500 carries no operate code", async () => {
    stubFetch(500, { success: false, error: "internal", message: "internal error (see server.log)" });
    const res = await fetchVault();
    expect(res.code).toBe("internal");
    expect(res.remedies).toBeUndefined();
  });
});

// ── retro-ux-credential-vault (design D7, test-plan #E13) ─────────────────
describe("E13 fetchVault client mapping", () => {
  it("a 2xx HTML reply is server_outdated, not an HTTP status line", async () => {
    stubHtml(200, "OK");
    const res = await fetchVault();
    expect(res.ok).toBe(false);
    expect(res.code).toBe("server_outdated");
    expect(res.error).not.toMatch(/HTTP 200/);
  });

  it("a 502 HTML reply is transport and names the status", async () => {
    stubHtml(502, "Bad Gateway");
    const res = await fetchVault();
    expect(res.code).toBe("transport");
    expect(res.status).toBe(502);
    expect(res.error).toContain("HTTP 502");
  });

  it("a fetch rejection is network", async () => {
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
    const res = await fetchVault();
    expect(res.code).toBe("network");
    expect(res.error).toBe("Can't reach the dashboard server");
  });

  it("a JSON content-type with an invalid body is transport", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{oops", { status: 200, headers: { "content-type": "application/json" } }))),
    );
    const res = await fetchVault();
    expect(res.code).toBe("transport");
    expect(res.error).toBe("The server sent an unreadable reply");
  });

  it("a 403 operate_required envelope keeps its code", async () => {
    stubFetch(403, { success: false, error: "operate_required" });
    expect((await fetchVault()).code).toBe("operate_required");
  });

  it("a 404 not_found envelope keeps its code and status", async () => {
    stubFetch(404, { success: false, error: "not_found", message: "No API route for GET /api/vault" });
    const res = await fetchVault();
    expect(res.code).toBe("not_found");
    expect(res.status).toBe(404);
  });

  it("a JSON success returns its data", async () => {
    stubFetch(200, { success: true, data: { accounts: [] } });
    const res = await fetchVault();
    expect(res.ok).toBe(true);
    expect(res.data).toEqual({ accounts: [] });
  });
});

describe("fetchVaultProjects", () => {
  it("GETs /api/vault/projects and returns the open / recent lists", async () => {
    stubFetch(200, { success: true, data: { open: [{ kind: "dir", dir: "/a" }], recent: [] } });
    const res = await fetchVaultProjects();
    expect(res.ok).toBe(true);
    expect(res.data?.open).toHaveLength(1);
    expect((fetch as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe("/api/vault/projects");
  });
});

// ── add-request-access-remedy (test-plan E19) ─────────────────────────────
describe("E19 VaultResult.base is the request-start base", () => {
  afterEach(() => setGlobalApiBase(""));

  it("keeps the base the request was sent to, even if the active server changes before the reply", async () => {
    setGlobalApiBase("http://192.168.16.204:8000");
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        setGlobalApiBase("http://192.168.16.31:8000"); // the user switches server mid-flight
        return Promise.resolve({ ok: false, status: 403, headers: JSON_HEADERS, json: () => Promise.resolve({ success: false, error: "operate_required", remedies: ["use-host"] }) });
      }),
    );
    const res = await fetchVault();
    expect(res.base).toBe("http://192.168.16.204:8000");
  });

  it("is the empty string for the page's own server", async () => {
    stubFetch(403, { success: false, error: "operate_required", remedies: [] });
    expect((await fetchVault()).base).toBe("");
  });
});

describe("F3 vault status type", () => {
  it("a locked status keeps its reason, known or an unknown future one", async () => {
    for (const reason of ["key_mismatch", "x_new"]) {
      stubFetch(200, { success: true, data: { status: { state: "locked", reason }, accounts: [], bindings: [], grants: [], confirmations: [], pluginApprovals: [], plugins: [] } });
      const res = await fetchVault();
      expect(res.data?.status).toEqual({ state: "locked", reason });
      expect(vaultLock(res.data?.status as VaultOverview["status"])).toEqual({ reason });
    }
  });

  it("vaultLock: locked and writable:false are locks; an unknown state is a lock, never ok", () => {
    expect(vaultLock({ state: "locked", reason: "key_missing" })).toEqual({ reason: "key_missing" });
    expect(vaultLock({ state: "ok", writable: false, reason: "keychain_unavailable" })).toEqual({ reason: "keychain_unavailable" });
    expect(vaultLock({ state: "locked" })).toEqual({ reason: "unknown" });
    expect(vaultLock({ state: "frozen" } as unknown as VaultOverview["status"])).toEqual({ reason: "unknown" });
  });

  it("vaultLock: ok, ok+writable and absent are not locks", () => {
    expect(vaultLock({ state: "ok" })).toBeNull();
    expect(vaultLock({ state: "ok", writable: true })).toBeNull();
    expect(vaultLock({ state: "absent" })).toBeNull();
  });

  it("isVaultWriteBlocked: corrupt, locked, read-only and unknown block writes", () => {
    expect(isVaultWriteBlocked({ state: "corrupt" })).toBe(true);
    expect(isVaultWriteBlocked({ state: "locked", reason: "x_new" })).toBe(true);
    expect(isVaultWriteBlocked({ state: "ok", writable: false, reason: "key_missing" })).toBe(true);
    expect(isVaultWriteBlocked({ state: "frozen" } as unknown as VaultOverview["status"])).toBe(true);
    expect(isVaultWriteBlocked({ state: "ok" })).toBe(false);
    expect(isVaultWriteBlocked({ state: "absent" })).toBe(false);
  });
});
