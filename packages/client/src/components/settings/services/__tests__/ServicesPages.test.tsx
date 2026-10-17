/**
 * Services pages: list, detail, secrets, logs, dialogs, add flow, runtimes.
 * See change: add-services-settings-ui — test-plan E34, F2, F7–F16 (L1 share), X10–X13.
 */

import fs from "node:fs";
import path from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesPages } from "../ServicesPages.js";
import { callsTo, fail, fakeServices, makeList, makeService, ok, stubServicesFetch } from "./services-fixtures.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
beforeEach(() => vi.restoreAllMocks());

const nav = vi.fn();
const mountList = (services = [makeService()], patch = {}) =>
  render(<ServicesPages page="services" serviceId={null} services={fakeServices(makeList(services, patch))} navigate={nav} />);
const mountDetail = (s = makeService(), patch = {}, id = s.id) =>
  render(<ServicesPages page="services" serviceId={id} services={fakeServices(makeList([s], patch))} navigate={nav} />);

describe("service list", () => {
  it("E34 groups Needs attention → Running → Stopped with counts; empty group absent", () => {
    mountList([
      makeService({ id: "a", state: "healthy" }),
      makeService({ id: "b", state: "failed", retryAt: new Date(Date.now() + 30_000).toISOString() }),
      makeService({ id: "c", state: "unavailable", reason: "image-absent", hint: "docker pull x" }),
    ]);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings[0]).toMatch(/Needs attention \(2\)/);
    expect(headings[1]).toMatch(/Running \(1\)/);
    expect(screen.queryByTestId("services-group-stopped")).toBeNull();
    // the unavailable row explains itself, with the server's hint
    expect(screen.getByTestId("service-why-c").textContent).toMatch(/image is not on this machine/);
    expect(screen.getByTestId("service-why-c").textContent).toContain("docker pull x");
    // failed shows the time to the next retry
    expect(screen.getByTestId("service-why-b").textContent).toMatch(/Next automatic retry in \d+ s/);
  });

  it("opens a service by clicking its row", () => {
    mountList([makeService({ id: "docling", state: "healthy" })]);
    fireEvent.click(screen.getByTestId("service-row-docling"));
    expect(nav).toHaveBeenCalledWith("/settings/services/docling");
  });

  it("corrupt definitions / secrets show a banner naming the backup path", () => {
    mountList([], { definitionsCorrupt: true, backupPath: "/h/.pi/services.json.bak-1", secretsCorrupt: true, secretsBackupPath: "/h/.pi/secrets.bak-2" });
    expect(screen.getByTestId("services-definitions-corrupt").textContent).toContain("/h/.pi/services.json.bak-1");
    expect(screen.getByTestId("services-secrets-corrupt").textContent).toContain("/h/.pi/secrets.bak-2");
  });

  it("an empty list offers the add flow and names the CLI equivalent", () => {
    mountList([]);
    expect(screen.getByTestId("services-empty").textContent).toContain("pi-dashboard service add");
    expect(screen.getByTestId("services-add-open")).toBeTruthy();
  });

  it("an unknown service id shows the list with a notice", () => {
    render(<ServicesPages page="services" serviceId="nope" services={fakeServices(makeList([makeService()]))} navigate={nav} />);
    expect(screen.getByTestId("services-not-found").textContent).toContain("nope");
    expect(screen.getByTestId("services-list-page")).toBeTruthy();
  });

  it("state pills carry a text label and a shape, not colour alone", () => {
    mountList([makeService({ state: "blocked" })]);
    const pill = screen.getByTestId("service-state-pill");
    expect(pill.textContent).toContain("Not responding");
    expect(pill.querySelector("[aria-hidden='true']")?.textContent).toBe("◆");
  });
});

describe("service detail — gating and actions", () => {
  beforeEach(() => stubServicesFetch());

  it("E33 renders exactly the legal actions: Try again after a fixable unavailable, never for sticky reasons", () => {
    mountDetail(makeService({ state: "unavailable", reason: "runtime-unreachable" }));
    expect(screen.getByTestId("service-action-try-again")).toBeTruthy();
    expect(screen.queryByTestId("service-action-start")).toBeNull();
    cleanup();
    mountDetail(makeService({ state: "unavailable", reason: "adoption-uncertain" }));
    expect(screen.queryByTestId("service-action-try-again")).toBeNull();
    expect(screen.queryByTestId("service-action-stop")).toBeNull(); // plain Stop is not offered
    expect(screen.getByTestId("service-action-force-stop")).toBeTruthy();
    cleanup();
    mountDetail(makeService({ state: "unavailable", reason: "duplicate-instances" }));
    expect(screen.getByTestId("service-action-stop")).toBeTruthy();
    expect(screen.queryByTestId("service-action-force-stop")).toBeNull();
  });

  it("a failed service offers Retry, not Start", () => {
    mountDetail(makeService({ state: "failed" }));
    expect(screen.getByTestId("service-action-retry")).toBeTruthy();
    expect(screen.queryByTestId("service-action-start")).toBeNull();
  });

  it("an externally-started instance offers Force stop and no plain Stop", () => {
    mountDetail(makeService({ state: "healthy", startedBy: "external", mode: "attached" }));
    expect(screen.queryByTestId("service-action-stop")).toBeNull();
    expect(screen.getByTestId("service-action-force-stop")).toBeTruthy();
  });

  it("Reset data only appears for services that declare volumes; Pin only for managed", () => {
    mountDetail(makeService({ state: "stopped" }));
    expect(screen.queryByTestId("service-action-reset-data")).toBeNull();
    cleanup();
    mountDetail(makeService({ state: "stopped", volumes: ["docling-cache"] }));
    expect(screen.getByTestId("service-action-reset-data")).toBeTruthy();
    expect(screen.getByTestId("service-action-pin")).toBeTruthy();
    cleanup();
    mountDetail(makeService({ state: "healthy", mode: "attached" }));
    expect(screen.queryByTestId("service-action-pin")).toBeNull();
  });

  it("Try again sends POST /start", async () => {
    const calls = stubServicesFetch();
    mountDetail(makeService({ state: "unavailable", reason: "runtime-unreachable" }));
    fireEvent.click(screen.getByTestId("service-action-try-again"));
    await waitFor(() => expect(callsTo(calls, "POST", "/api/services/docling/start")).toHaveLength(1));
  });

  it("X10 a refused action shows the server's code and hint at the action, no toast", async () => {
    stubServicesFetch({ handler: (c) => (c.url.endsWith("/start") ? fail(409, "lifecycle-lock-timeout", "another start is in progress") : undefined) });
    mountDetail(makeService({ state: "stopped" }));
    fireEvent.click(screen.getByTestId("service-action-start"));
    const err = await screen.findByTestId("service-action-error");
    expect(err.textContent).toContain("lifecycle-lock-timeout");
    expect(err.textContent).toContain("another start is in progress");
    expect(screen.queryByRole("status", { name: /toast/i })).toBeNull();
  });

  it("X11 operate_required renders its reason and remedies at the action", async () => {
    stubServicesFetch({
      handler: (c) =>
        c.url.endsWith("/stop")
          ? fail(403, "operate_required", "service mutations need an operate-tier credential or a locally trusted caller", { reason: "no-credential", remedies: ["use-host", "sign-in", "bogus"] })
          : undefined,
    });
    mountDetail(makeService({ state: "healthy" }));
    fireEvent.click(screen.getByTestId("service-action-stop"));
    const callout = await screen.findByTestId("service-action-error-operate");
    const remedies = within(callout).getAllByRole("listitem").map((li) => li.getAttribute("data-remedy"));
    expect(remedies).toEqual(["use-host", "sign-in"]); // unknown dropped, server order kept
  });

  it("F12 canOperate:false disables every action, shows one banner, and sends no logs request", () => {
    const calls = stubServicesFetch();
    mountDetail(makeService({ state: "stopped", volumes: ["v"] }), { canOperate: false });
    for (const el of screen.getByTestId("service-actions").querySelectorAll("button")) expect((el as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByTestId("service-action-remove") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getAllByTestId("services-readonly-banner")).toHaveLength(1);
    expect(screen.getByTestId("service-logs-readonly")).toBeTruthy();
    expect(screen.queryByTestId("service-logs-load")).toBeNull();
    expect(calls.filter((c) => c.url.includes("/logs"))).toHaveLength(0);
  });

  it("F14 a lease holder renders as literal text", () => {
    const { container } = mountDetail(makeService({ state: "healthy", leases: 1, leaseHolders: [{ holder: "<img src=x onerror=alert(1)>", expiresAt: new Date().toISOString() }] }));
    expect(screen.getByTestId("service-lease-holder").textContent).toBe("<img src=x onerror=alert(1)>");
    expect(container.querySelector("img")).toBeNull();
  });

  it("shows the tried drivers with their reasons, and the hint", () => {
    mountDetail(makeService({ state: "unavailable", reason: "runtime-unreachable", hint: "start Docker", tried: [{ driver: "oci:docker", reason: "runtime-unreachable" }, { driver: "oci:podman", reason: "runtime-missing" }] }));
    expect(screen.getByTestId("service-tried").textContent).toContain("oci:podman");
    expect(screen.getByTestId("service-why-hint").textContent).toBe("start Docker");
  });

  it("F2 opening the detail probes once; no further GET /api/services/:id without Refresh", async () => {
    const calls = stubServicesFetch();
    const services = fakeServices(makeList([makeService({ state: "healthy" })]));
    const { rerender } = render(<ServicesPages page="services" serviceId="docling" services={services} navigate={nav} />);
    await waitFor(() => expect(callsTo(calls, "GET", "/api/services/docling")).toHaveLength(1));
    for (let i = 0; i < 5; i++) rerender(<ServicesPages page="services" serviceId="docling" services={fakeServices(makeList([makeService({ state: "healthy", leases: i })]))} navigate={nav} />);
    expect(callsTo(calls, "GET", "/api/services/docling")).toHaveLength(1);
    fireEvent.click(screen.getByTestId("service-refresh"));
    await waitFor(() => expect(callsTo(calls, "GET", "/api/services/docling")).toHaveLength(2));
  });
});

describe("secrets — write-only", () => {
  it("F9 the input clears at submit, the value is never rendered, only sent", async () => {
    const calls = stubServicesFetch();
    const s = makeService({ state: "stopped", secrets: { token: { configured: false } }, secretRefs: { token: "store:docling/token" } });
    mountDetail(s);
    const input = screen.getByTestId("service-secret-input-token") as HTMLInputElement;
    expect(input.type).toBe("password");
    fireEvent.change(input, { target: { value: "hunter2-hunter2" } });
    fireEvent.click(screen.getByTestId("service-secret-save-token"));
    expect(input.value).toBe(""); // cleared at submit
    await waitFor(() => expect(callsTo(calls, "PUT", "/api/services/docling/secrets/token")).toHaveLength(1));
    expect(callsTo(calls, "PUT", "/api/services/docling/secrets/token")[0].body).toEqual({ value: "hunter2-hunter2" });
    expect(document.body.innerHTML).not.toContain("hunter2-hunter2");
  });

  it("a non-store secret shows its reference read-only, with no input", () => {
    mountDetail(makeService({ secrets: { apikey: { configured: true } }, secretRefs: { apikey: "keychain:svc/acct" } }));
    expect(screen.getByTestId("service-secret-ref-apikey").textContent).toBe("keychain:svc/acct");
    expect(screen.queryByTestId("service-secret-input-apikey")).toBeNull();
    expect(screen.getByTestId("service-secret-badge-apikey").textContent).toBe("Set");
  });
});

describe("logs viewer", () => {
  const withLogs = (data: unknown) => stubServicesFetch({ handler: (c) => (c.url.includes("/logs") ? ok(data) : undefined) });

  it("F13 renders lines as text and marks redactions", async () => {
    withLogs({ available: true, driver: "native", stale: false, lines: ["<script>alert(1)</script>", "auth «secret:token» ok"] });
    const { container } = mountDetail(makeService({ state: "healthy" }));
    fireEvent.click(screen.getByTestId("service-logs-load"));
    const pre = await screen.findByTestId("service-logs-lines");
    expect(pre.textContent).toContain("<script>alert(1)</script>");
    expect(container.querySelector("script")).toBeNull();
    expect(screen.getByTestId("service-log-mark").textContent).toBe("«secret:token»");
  });

  it("sends the chosen tail and refreshes only on demand", async () => {
    const calls = withLogs({ available: true, driver: "native", stale: false, lines: [] });
    mountDetail(makeService({ state: "healthy" }));
    expect(calls.filter((c) => c.url.includes("/logs"))).toHaveLength(0);
    fireEvent.change(screen.getByTestId("service-logs-tail"), { target: { value: "500" } });
    fireEvent.click(screen.getByTestId("service-logs-load"));
    await waitFor(() => expect(calls.some((c) => c.url === "/api/services/docling/logs?tail=500")).toBe(true));
  });

  it("labels output of a stopped service as the last run", async () => {
    withLogs({ available: true, driver: "native", stale: true, lines: ["x"] });
    mountDetail(makeService({ state: "failed" }));
    fireEvent.click(screen.getByTestId("service-logs-load"));
    expect((await screen.findByTestId("service-logs-stale")).textContent).toMatch(/last run/);
  });

  it("external → explains the dashboard does not run it; secret reasons name and link the input", async () => {
    withLogs({ available: false, reason: "external" });
    mountDetail(makeService({ state: "healthy", secrets: { token: { configured: true } }, secretRefs: { token: "store:docling/token" } }));
    fireEvent.click(screen.getByTestId("service-logs-load"));
    expect((await screen.findByTestId("service-logs-unavailable")).textContent).toMatch(/does not run this service/);
    cleanup();
    withLogs({ available: false, reason: "secret-unavailable", secret: "token" });
    mountDetail(makeService({ state: "healthy", secrets: { token: { configured: true } }, secretRefs: { token: "store:docling/token" } }));
    fireEvent.click(screen.getByTestId("service-logs-load"));
    fireEvent.click(await screen.findByTestId("service-logs-secret-link"));
    expect(document.activeElement?.id).toBe("service-secret-docling-token");
  });
});

describe("destructive dialogs", () => {
  it("F10 Reset data stays disabled until the exact id is typed", async () => {
    const calls = stubServicesFetch({ handler: (c) => (c.url.endsWith("/reset-data") ? ok({ volumes: [{ name: "docling-cache", removed: true }] }) : undefined) });
    mountDetail(makeService({ state: "stopped", volumes: ["docling-cache"] }));
    fireEvent.click(screen.getByTestId("service-action-reset-data"));
    const confirm = screen.getByTestId("service-reset-confirm") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("service-reset-typed"), { target: { value: "docl" } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByTestId("service-reset-typed"), { target: { value: "docling" } });
    expect(confirm.disabled).toBe(false);
    fireEvent.click(confirm);
    await waitFor(() => expect(callsTo(calls, "POST", "/api/services/docling/reset-data")).toHaveLength(1));
    expect((await screen.findByTestId("service-reset-volumes")).textContent).toContain("docling-cache");
  });

  it("F10 Remove without ticking carries no purgeData; ticking sends it; kept volumes are reported", async () => {
    const calls = stubServicesFetch({ handler: (c) => (c.method === "DELETE" ? ok({ ok: true }) : undefined) });
    mountDetail(makeService({ state: "stopped", volumes: ["docling-cache"] }));
    fireEvent.click(screen.getByTestId("service-action-remove"));
    expect((screen.getByTestId("service-remove-purge") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("service-remove-confirm"));
    await waitFor(() => expect(calls.filter((c) => c.method === "DELETE")).toHaveLength(1));
    expect(calls.find((c) => c.method === "DELETE")?.url).toBe("/api/services/docling");

    cleanup();
    const calls2 = stubServicesFetch({
      handler: (c) => (c.method === "DELETE" ? ok({ ok: true, volumes: [{ name: "docling-cache", removed: false, reason: "volume-in-use" }] }) : undefined),
    });
    mountDetail(makeService({ state: "stopped", volumes: ["docling-cache"] }));
    fireEvent.click(screen.getByTestId("service-action-remove"));
    fireEvent.click(screen.getByTestId("service-remove-purge"));
    fireEvent.click(screen.getByTestId("service-remove-confirm"));
    await waitFor(() => expect(calls2.find((c) => c.method === "DELETE")?.url).toBe("/api/services/docling?purgeData=true"));
    expect((await screen.findByTestId("service-remove-volumes")).textContent).toMatch(/another project uses it/);
  });

  it("Force stop explains the check it overrides and sends force:true", async () => {
    const calls = stubServicesFetch();
    mountDetail(makeService({ state: "unavailable", reason: "adoption-uncertain" }));
    fireEvent.click(screen.getByTestId("service-action-force-stop"));
    expect(screen.getByTestId("service-force-explain").textContent).toMatch(/reused process id/);
    fireEvent.click(screen.getByTestId("service-force-confirm"));
    await waitFor(() => expect(callsTo(calls, "POST", "/api/services/docling/stop")).toHaveLength(1));
    expect(callsTo(calls, "POST", "/api/services/docling/stop")[0].body).toEqual({ force: true });
  });

  it("F11 Prune previews first, then sends exactly the previewed ids, and reports skipped", async () => {
    const calls = stubServicesFetch({
      handler: (c) => {
        if (c.url !== "/api/services/prune") return undefined;
        const body = c.body as { dryRun: boolean };
        return body.dryRun
          ? ok({ dryRun: true, candidates: [{ kind: "run-dir", id: "tika" }, { kind: "container", id: "ghost", containerId: "c1", runtime: "docker" }], skipped: [], unreachableRuntimes: ["podman"] })
          : ok({ dryRun: false, removed: ["ghost"], skipped: [{ id: "tika", kind: "run-dir", reason: "defined since the preview" }] });
      },
    });
    mountList([makeService()]);
    fireEvent.click(screen.getByTestId("services-prune-open"));
    const list = await screen.findByTestId("service-prune-candidates");
    expect(list.textContent).toContain("tika");
    expect(screen.getByTestId("service-prune-unreachable").textContent).toContain("podman");
    fireEvent.click(screen.getByTestId("service-prune-confirm"));
    await waitFor(() => expect(calls.filter((c) => c.url === "/api/services/prune")).toHaveLength(2));
    expect(calls.filter((c) => c.url === "/api/services/prune")[1].body).toEqual({ dryRun: false, ids: ["tika", "ghost"] });
    expect((await screen.findByTestId("service-prune-skipped")).textContent).toContain("tika");
  });
});

describe("add service", () => {
  it("F7 reviews with a dry run first; Confirm writes; prefetch is a separate unticked option", async () => {
    const review = { id: "tika", mode: "managed", drivers: ["native"], recipe: { runner: "uvx", package: "tika@1.0.0", args: [] }, ports: ["http"], volumes: [], binds: [], secrets: [], secretSources: {}, needsPrefetch: true };
    const calls = stubServicesFetch({
      handler: (c) => (c.url === "/api/services" && c.method === "POST" ? ok({ dryRun: (c.body as { dryRun: boolean }).dryRun, review }) : undefined),
    });
    mountList([]);
    fireEvent.click(screen.getByTestId("services-add-open"));
    fireEvent.click(await screen.findByTestId("service-add-source-paste"));
    fireEvent.change(screen.getByTestId("service-add-json"), { target: { value: '{"id":"tika","mode":"attached"}' } });
    fireEvent.click(screen.getByTestId("service-add-review-button"));
    await screen.findByTestId("service-add-review");
    expect(callsTo(calls, "POST", "/api/services").map((c) => (c.body as { dryRun: boolean }).dryRun)).toEqual([true]);
    expect((screen.getByTestId("service-add-prefetch") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("service-add-confirm"));
    await screen.findByTestId("service-add-done");
    expect(callsTo(calls, "POST", "/api/services").map((c) => (c.body as { dryRun: boolean }).dryRun)).toEqual([true, false]);
    expect(calls.filter((c) => c.url.endsWith("/prefetch"))).toHaveLength(0);
  });

  it("F8 validation errors are listed one per line and nothing is added", async () => {
    const calls = stubServicesFetch({
      handler: (c) => (c.url === "/api/services" && c.method === "POST" ? fail(400, "invalid-definition", "unknown key: privileged; id: must match ^[a-z0-9]") : undefined),
    });
    mountList([]);
    fireEvent.click(screen.getByTestId("services-add-open"));
    fireEvent.click(await screen.findByTestId("service-add-source-paste"));
    fireEvent.change(screen.getByTestId("service-add-json"), { target: { value: '{"id":"x","privileged":true}' } });
    fireEvent.click(screen.getByTestId("service-add-review-button"));
    const errs = await screen.findByTestId("service-add-errors");
    expect(within(errs).getAllByRole("listitem").map((l) => l.textContent)).toEqual(["unknown key: privileged", "id: must match ^[a-z0-9]"]);
    expect(screen.queryByTestId("service-add-confirm")).toBeNull();
    expect(callsTo(calls, "POST", "/api/services").every((c) => (c.body as { dryRun: boolean }).dryRun)).toBe(true);
  });

  it("invalid JSON text is refused client-side with no request", async () => {
    const calls = stubServicesFetch();
    mountList([]);
    fireEvent.click(screen.getByTestId("services-add-open"));
    fireEvent.click(await screen.findByTestId("service-add-source-paste"));
    fireEvent.change(screen.getByTestId("service-add-json"), { target: { value: "{nope" } });
    fireEvent.click(screen.getByTestId("service-add-review-button"));
    expect((await screen.findByTestId("service-add-errors")).textContent).toMatch(/not valid JSON/);
    expect(callsTo(calls, "POST", "/api/services")).toHaveLength(0);
  });
});

describe("X13 — runtimes page", () => {
  it("docker installed but unreachable: capabilities unavailable, no VM start/stop control", async () => {
    stubServicesFetch({
      handler: (c) =>
        c.url === "/api/services/runtimes"
          ? ok([{ id: "docker", kind: "container", installed: true, version: "29.1.3", reachable: false, hostVm: "stopped", capabilities: { create: "unavailable", start: "unavailable", stop: "unavailable", hostVmControl: "unsupported" } }])
          : undefined,
    });
    const { container } = render(<ServicesPages page="runtimes" serviceId={null} services={fakeServices(makeList([]))} navigate={nav} />);
    await screen.findByTestId("runtime-docker");
    expect(screen.getByTestId("runtime-docker-installed").textContent).toBe("Yes");
    expect(screen.getByTestId("runtime-docker-reachable").textContent).toBe("No");
    expect(screen.getByTestId("runtime-docker-cap-create").textContent).toBe("unavailable");
    const buttons = [...container.querySelectorAll("button")].map((b) => b.textContent ?? "");
    expect(buttons.join(" ")).not.toMatch(/start|stop/i);
    expect(buttons).toHaveLength(1); // Refresh only
  });
});

describe("F16 — theme tokens only", () => {
  it("no raw colour literal in the new client sources", () => {
    const roots = [
      path.resolve(__dirname, ".."),
      path.resolve(__dirname, "../../../../lib/services"),
      path.resolve(__dirname, "../../../../hooks/useServices.ts"),
    ];
    const files: string[] = [];
    const walk = (p: string) => {
      if (fs.statSync(p).isDirectory()) {
        for (const e of fs.readdirSync(p)) if (e !== "__tests__") walk(path.join(p, e));
      } else if (/\.(ts|tsx)$/.test(p)) files.push(p);
    };
    for (const r of roots) walk(r);
    expect(files.length).toBeGreaterThan(8);
    const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\(/;
    for (const f of files) {
      const code = fs.readFileSync(f, "utf8").split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
      expect(code, f).not.toMatch(literal);
    }
  });
});
