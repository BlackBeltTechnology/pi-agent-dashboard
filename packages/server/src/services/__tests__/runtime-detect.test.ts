/**
 * Runtime detection report: matches the spike's S7 matrix from injected
 * command outputs; on demand, read-only, cached 30 s. See change:
 * add-service-registry-core (test-plan E42, P3).
 */
import fs from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { RuntimeDetector } from "../runtime-detect.js";
import { buildApp, FakeClock, makeManager, recordingRunner, tmpRoot } from "./helpers.js";

/** Command outputs reproducing `2026-10-08-spike-managed-services/s7-matrix.json`. */
function s7Runner() {
  return recordingRunner((file, args) => {
    const bin = file.split("/").pop();
    const a = args.join(" ");
    if (bin === "docker") {
      if (a === "--version") return { stdout: "Docker version 29.1.3, build f52814d\n" };
      if (args[0] === "info") return { code: 1, stderr: "failed to connect to the docker API at unix:///var/run/docker.sock" };
      if (args[0] === "desktop") return { stdout: JSON.stringify({ Status: "stopped" }) };
    }
    if (bin === "podman") {
      if (a === "--version") return { stdout: "podman version 6.1.0\n" };
      if (args[0] === "info") return { stdout: JSON.stringify({ host: { os: "linux" }, version: { Version: "5.8.6" } }) };
      if (args[0] === "machine") return { stdout: JSON.stringify([{ Name: "podman-machine-default", Running: true }]) };
    }
    if (bin === "qemu-system-aarch64") return { stdout: "QEMU emulator version 10.1.1\n" };
    if (bin === "VBoxManage") return { stdout: "7.2.6r172322\n" };
    if (bin === "vmrun") return { code: 255, stdout: "\nvmrun version 1.17.0 build-24995812\n\nUsage: vmrun [AUTHENTICATION-FLAGS] COMMAND [PARAMETERS]\n" };
    return { code: 127 };
  });
}

const installed = new Set(["docker", "podman", "qemu-system-aarch64", "VBoxManage", "vmrun"]);
const resolveBinary = (n: string) => (installed.has(n) ? `/opt/bin/${n}` : null);

const roots: string[] = [];
afterEach(() => {
  for (const r of roots.splice(0)) fs.rmSync(r, { recursive: true, force: true });
});

describe("E42 — the report reproduces the spike S7 matrix", () => {
  it("installed/version/reachable/hostVm/capabilities", async () => {
    const runner = s7Runner();
    const d = new RuntimeDetector({ run: runner.run, resolveBinary });
    const byId = Object.fromEntries((await d.detect()).map((r) => [r.id, r]));
    expect(byId.docker).toMatchObject({ installed: true, version: "29.1.3", reachable: false, hostVm: "stopped" });
    expect(byId.docker.capabilities.create).toBe("unavailable");
    expect(byId.docker.capabilities.hostVmControl).toBe("unsupported");
    expect(byId.podman).toMatchObject({ installed: true, version: "6.1.0", reachable: true, hostVm: "running" });
    expect(byId.podman.capabilities).toMatchObject({ create: "ok", remove: "ok-destructive", hostVmControl: "unsupported" });
    expect(byId.qemu).toMatchObject({ installed: true, version: "10.1.1" });
    expect(byId.virtualbox).toMatchObject({ installed: true, version: "7.2.6" });
    expect(byId.vmware).toMatchObject({ installed: true, version: "1.17.0" });
    for (const r of Object.values(byId)) {
      for (const v of Object.values(r.capabilities)) {
        expect(["ok", "ok-destructive", "cli-present", "needs-secret", "unavailable", "unsupported"]).toContain(v);
      }
    }
  });

  it("is read-only: no start/stop/create/pull/machine-control argv", async () => {
    const runner = s7Runner();
    await new RuntimeDetector({ run: runner.run, resolveBinary }).detect();
    for (const c of runner.calls) {
      expect(["start", "stop", "create", "pull", "rm", "run"]).not.toContain(c.args[0]);
      if (c.args[0] === "machine" || c.args[0] === "desktop") expect(["list", "status"]).toContain(c.args[1]);
    }
  });

  it("GET /api/services/runtimes twice within 30 s → the second issues 0 commands", async () => {
    const r = tmpRoot("svc-rt-");
    roots.push(r);
    const runner = s7Runner();
    const clock = new FakeClock();
    const detector = new RuntimeDetector({ run: runner.run, resolveBinary, now: clock.now });
    const { manager } = makeManager(r, { run: runner.run, detector, clock });
    const app = await buildApp(manager);
    const first = await app.inject({ method: "GET", url: "/api/services/runtimes" });
    expect(first.json().data.find((x: { id: string }) => x.id === "podman").reachable).toBe(true);
    const n = runner.calls.length;
    clock.advance(20_000);
    await app.inject({ method: "GET", url: "/api/services/runtimes" });
    expect(runner.calls.length).toBe(n);
    await app.close();
  });
});

describe("P3 — 10 requests in 30 s run detection once", () => {
  it("one detection pass for ten (also concurrent) calls", async () => {
    const runner = s7Runner();
    const clock = new FakeClock();
    const d = new RuntimeDetector({ run: runner.run, resolveBinary, now: clock.now });
    await Promise.all([d.detect(), d.detect(), d.detect()]);
    const once = runner.calls.length;
    for (let i = 0; i < 7; i++) {
      clock.advance(4_000);
      await d.detect();
    }
    expect(runner.calls.length).toBe(once);
    clock.advance(3_000); // 31 s after the pass → refresh
    await d.detect();
    expect(runner.calls.length).toBe(once * 2);
  });
});
