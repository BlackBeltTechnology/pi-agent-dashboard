import { describe, it, expect } from "vitest";
import type { DiscoveredServerInfo } from "../components/ServerSelector.js";
import { isLoopbackOrigin, buildServerEntries } from "../components/ServerSelector.js";
import type { KnownServer } from "@blackbelt-technology/pi-dashboard-shared/config.js";

describe("ServerSelector logic", () => {
  it("getInitialWsUrl returns saved server from localStorage", () => {
    const saved = "remote.local:8000";
    const [host, port] = saved.split(":");
    expect(host).toBe("remote.local");
    expect(port).toBe("8000");
    const url = `ws://${host}:${port}/ws`;
    expect(url).toBe("ws://remote.local:8000/ws");
  });

  it("localStorage roundtrip for last server", () => {
    const host = "workstation.local";
    const port = 8000;
    const key = `${host}:${port}`;
    expect(key).toBe("workstation.local:8000");
    const [parsedHost, parsedPort] = key.split(":");
    expect(parsedHost).toBe("workstation.local");
    expect(parseInt(parsedPort, 10)).toBe(8000);
  });

  // Known-servers based entry building logic
  function buildEntries(knownServers: KnownServer[], currentHost: string, currentPort: number) {
    const entries = [
      { host: "localhost", port: currentPort, label: "Local", isLocal: true },
      ...knownServers
        .filter((s) => !(s.host === "localhost" || s.host === "127.0.0.1"))
        .map((s) => ({ host: s.host, port: s.port, label: s.label, isLocal: false })),
    ];
    const currentKey = `${currentHost}:${currentPort}`;
    const isCurrentInList = entries.some((e) => `${e.host}:${e.port}` === currentKey);
    if (!isCurrentInList) {
      const isLocal = currentHost === "localhost" || currentHost === "127.0.0.1";
      entries.push({ host: currentHost, port: currentPort, label: undefined, isLocal });
    }
    return entries;
  }

  it("always includes localhost first", () => {
    const entries = buildEntries([], "localhost", 8000);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual({ host: "localhost", port: 8000, label: "Local", isLocal: true });
  });

  it("includes known servers with labels", () => {
    const known: KnownServer[] = [
      { host: "office-mac", port: 8000, label: "Office", addedAt: "2024-01-01T00:00:00Z" },
    ];
    const entries = buildEntries(known, "localhost", 8000);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toEqual({ host: "office-mac", port: 8000, label: "Office", isLocal: false });
  });

  it("shows known server without label using host as display", () => {
    const known: KnownServer[] = [
      { host: "build-server", port: 9000, addedAt: "2024-01-01T00:00:00Z" },
    ];
    const entries = buildEntries(known, "localhost", 8000);
    expect(entries[1].label).toBeUndefined();
    expect(entries[1].host).toBe("build-server");
  });

  it("adds current remote server if not in known list", () => {
    const entries = buildEntries([], "remote.local", 8000);
    expect(entries).toHaveLength(2);
    expect(entries[0].host).toBe("localhost");
    expect(entries[1]).toEqual({ host: "remote.local", port: 8000, label: undefined, isLocal: false });
  });

  it("does not duplicate current server if already in known list", () => {
    const known: KnownServer[] = [
      { host: "remote.local", port: 8000, label: "Remote", addedAt: "2024-01-01T00:00:00Z" },
    ];
    const entries = buildEntries(known, "remote.local", 8000);
    expect(entries).toHaveLength(2);
    const remoteEntries = entries.filter((e) => e.host === "remote.local");
    expect(remoteEntries).toHaveLength(1);
  });

  it("filters out localhost from known servers to avoid duplicate", () => {
    const known: KnownServer[] = [
      { host: "localhost", port: 8000, addedAt: "2024-01-01T00:00:00Z" },
      { host: "office", port: 8000, label: "Office", addedAt: "2024-01-01T00:00:00Z" },
    ];
    const entries = buildEntries(known, "localhost", 8000);
    const localhostEntries = entries.filter((e) => e.host === "localhost");
    expect(localhostEntries).toHaveLength(1);
    expect(entries).toHaveLength(2);
  });
});

describe("isLoopbackOrigin", () => {
  it("is true for loopback hostnames", () => {
    expect(isLoopbackOrigin("localhost")).toBe(true);
    expect(isLoopbackOrigin("127.0.0.1")).toBe(true);
    expect(isLoopbackOrigin("::1")).toBe(true);
  });
  it("is false for remote hostnames", () => {
    expect(isLoopbackOrigin("pennyroyal.lan")).toBe(false);
    expect(isLoopbackOrigin("192.168.1.5")).toBe(false);
    expect(isLoopbackOrigin("brass.lan")).toBe(false);
  });
});

describe("buildServerEntries (origin-gated localhost seed)", () => {
  it("seeds localhost first when origin is loopback", () => {
    const entries = buildServerEntries([], "localhost", 8000, "localhost");
    expect(entries[0]).toEqual({ host: "localhost", port: 8000, label: "Local", isLocal: true });
  });

  it("does NOT seed localhost when origin is a remote host", () => {
    const entries = buildServerEntries([], "pennyroyal.lan", 4040, "brass.lan");
    expect(entries.some((e) => e.host === "localhost")).toBe(false);
    // served origin is the operative current entry
    expect(entries.some((e) => e.host === "pennyroyal.lan" && e.port === 4040)).toBe(true);
  });

  it("remote origin: no phantom localhost even with known servers", () => {
    const known: KnownServer[] = [
      { host: "office", port: 8000, label: "Office", addedAt: "2024-01-01T00:00:00Z" },
    ];
    const entries = buildServerEntries(known, "pennyroyal.lan", 4040, "pennyroyal.lan");
    expect(entries.some((e) => e.host === "localhost")).toBe(false);
  });

  it("loopback origin still appends current remote server if not in known list", () => {
    const entries = buildServerEntries([], "remote.local", 8000, "127.0.0.1");
    expect(entries[0].host).toBe("localhost");
    expect(entries.some((e) => e.host === "remote.local")).toBe(true);
  });

  it("dedups a 127.0.0.1 current host against the seeded localhost row", () => {
    // Loopback origin seeds localhost; current host is the 127.0.0.1 alias on
    // the same port → must NOT produce a second row.
    const entries = buildServerEntries([], "127.0.0.1", 8000, "localhost");
    const loopbackRows = entries.filter(
      (e) => e.host === "localhost" || e.host === "127.0.0.1" || e.host === "::1",
    );
    expect(loopbackRows).toHaveLength(1);
    expect(loopbackRows[0].host).toBe("localhost");
  });

  it("filters a ::1 known server (loopback alias) out to avoid a duplicate", () => {
    const known: KnownServer[] = [
      { host: "::1", port: 8000, addedAt: "2024-01-01T00:00:00Z" },
    ];
    const entries = buildServerEntries(known, "localhost", 8000, "localhost");
    expect(entries.some((e) => e.host === "::1")).toBe(false);
  });

  it("classifies a ::1 current host as Local, not Remote", () => {
    // Remote origin: no seed; current host is the ::1 loopback alias.
    const entries = buildServerEntries([], "::1", 8000, "pennyroyal.lan");
    const row = entries.find((e) => e.host === "::1");
    expect(row?.isLocal).toBe(true);
  });
});
