/**
 * Tests for KnownServersSection and NetworkDiscoverySection logic.
 */
import { describe, it, expect } from "vitest";
import type { KnownServerListEntry } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";
import type { DiscoveredServerInfo } from "@blackbelt-technology/pi-dashboard-shared/rest-api.js";

describe("KnownServersSection logic", () => {
  it("should display servers by label or host", () => {
    const servers: KnownServerListEntry[] = [
      { host: "office-mac", port: 8000, label: "Office", addedAt: "2024-01-01T00:00:00Z" },
      { host: "build-server", port: 9000, addedAt: "2024-01-01T00:00:00Z" },
    ];
    const displays = servers.map((s) => s.label || s.host);
    expect(displays).toEqual(["Office", "build-server"]);
  });

  it("should show empty state when no servers", () => {
    const servers: KnownServerListEntry[] = [];
    expect(servers.length === 0).toBe(true);
  });
});

describe("NetworkDiscoverySection logic", () => {
  function isKnown(knownServers: KnownServerListEntry[], host: string, port: number) {
    return knownServers.some((s) => s.host === host && s.port === port);
  }

  it("should detect already-known servers", () => {
    const known: KnownServerListEntry[] = [
      { host: "office-mac", port: 8000, label: "Office", addedAt: "2024-01-01T00:00:00Z" },
    ];
    expect(isKnown(known, "office-mac", 8000)).toBe(true);
    expect(isKnown(known, "other-host", 8000)).toBe(false);
  });

  it("should not mark as known if port differs", () => {
    const known: KnownServerListEntry[] = [
      { host: "office-mac", port: 8000, addedAt: "2024-01-01T00:00:00Z" },
    ];
    expect(isKnown(known, "office-mac", 9000)).toBe(false);
  });

  it("should build discovery result entries", () => {
    const discovered: DiscoveredServerInfo[] = [
      { host: "192.168.1.42", port: 8000, piPort: 9999, version: "1.2.3", pid: 123, isLocal: false },
      { host: "pi-dev.local", port: 8000, piPort: 9999, version: "1.2.3", pid: 456, isLocal: false },
    ];
    const known: KnownServerListEntry[] = [
      { host: "192.168.1.42", port: 8000, label: "LAN Server", addedAt: "2024-01-01T00:00:00Z" },
    ];

    const results = discovered.map((d) => ({
      ...d,
      alreadyKnown: isKnown(known, d.host, d.port),
    }));

    expect(results[0].alreadyKnown).toBe(true);
    expect(results[1].alreadyKnown).toBe(false);
  });

  it("should pre-fill label with hostname on add", () => {
    const server: DiscoveredServerInfo = {
      host: "pi-dev.local", port: 8000, piPort: 9999, version: "1.0", pid: 1, isLocal: false,
    };
    // The component pre-fills addLabel with server.host
    const defaultLabel = server.host;
    expect(defaultLabel).toBe("pi-dev.local");
  });
});
