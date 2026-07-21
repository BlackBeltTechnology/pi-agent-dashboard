/**
 * `computeKnownDirectories()` must scope the per-tick OpenSpec poll set to
 * directories the user is *actually* working in:
 *   - every pinned directory (unconditionally, regardless of session state), and
 *   - every cwd that hosts a non-ended session (active/idle/streaming).
 *
 * Ended sessions — including hidden ones — must NOT pull their cwd into the
 * work set. A cwd whose sessions have all ended and that is not pinned must
 * fall out of polling until a new session registers in it or it is pinned.
 *
 * See change: scope-openspec-poll-to-active-cwds.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { createDirectoryService, type DirectoryService } from "../directory-service.js";
import type { PreferencesStore } from "../persistence/preferences-store.js";
import type { SessionManager } from "../session/memory-session-manager.js";
import type { DashboardSession } from "@blackbelt-technology/pi-dashboard-shared/types.js";

vi.mock("../pi/pi-resource-scanner.js", () => ({
  scanPiResources: vi.fn(async () => ({
    local: { extensions: [], skills: [], prompts: [] },
    global: { extensions: [], skills: [], prompts: [] },
    packages: [],
  })),
}));

vi.mock("../session/session-discovery.js", () => ({
  discoverSessionsForCwd: vi.fn(() => []),
}));

function mkPrefs(pinned: string[]): PreferencesStore {
  return {
    getPinnedDirectories: () => pinned,
    setPinnedDirectories: vi.fn(),
    getSessionOrder: () => ({}),
    setSessionOrder: vi.fn(),
  } as unknown as PreferencesStore;
}

function mkSessions(sessions: Partial<DashboardSession>[]): SessionManager {
  const full = sessions.map((s) => ({
    source: "tui",
    startedAt: 1,
    ...s,
  })) as DashboardSession[];
  return {
    listAll: () => full,
    listActive: () => full.filter((s) => s.status !== "ended"),
    get: (id: string) => full.find((s) => s.id === id),
  } as unknown as SessionManager;
}

describe("DirectoryService.knownDirectories — scope to active+pinned", () => {
  let service: DirectoryService;
  afterEach(() => service?.stopPolling());

  it("includes active session cwds and excludes ended-only cwds", () => {
    service = createDirectoryService(
      mkPrefs([]),
      mkSessions([
        { id: "a", cwd: "/active", status: "active" },
        { id: "e", cwd: "/ended", status: "ended" },
      ]),
    );
    const dirs = service.knownDirectories();
    expect(dirs).toContain("/active");
    expect(dirs).not.toContain("/ended");
  });

  it("excludes hidden ended sessions (hiding ended must not re-add to poll set)", () => {
    service = createDirectoryService(
      mkPrefs([]),
      mkSessions([
        { id: "h", cwd: "/hidden-ended", status: "ended", hidden: true },
      ]),
    );
    expect(service.knownDirectories()).not.toContain("/hidden-ended");
  });

  it("includes pinned dirs regardless of session state (pinning is independent watch signal)", () => {
    service = createDirectoryService(
      mkPrefs(["/pinned-only", "/pinned-with-ended"]),
      mkSessions([
        { id: "e", cwd: "/pinned-with-ended", status: "ended" },
      ]),
    );
    const dirs = service.knownDirectories();
    expect(dirs).toContain("/pinned-only");
    expect(dirs).toContain("/pinned-with-ended");
  });

  it("includes non-active live statuses (idle, streaming) — only 'ended' is excluded", () => {
    service = createDirectoryService(
      mkPrefs([]),
      mkSessions([
        { id: "i", cwd: "/idle", status: "idle" },
        { id: "s", cwd: "/streaming", status: "streaming" },
        { id: "e", cwd: "/ended", status: "ended" },
      ]),
    );
    const dirs = service.knownDirectories();
    expect(dirs).toEqual(expect.arrayContaining(["/idle", "/streaming"]));
    expect(dirs).not.toContain("/ended");
  });

  it("dedupes a cwd shared by pinned + active session into a single entry", () => {
    service = createDirectoryService(
      mkPrefs(["/shared"]),
      mkSessions([{ id: "a", cwd: "/shared", status: "active" }]),
    );
    const dirs = service.knownDirectories();
    expect(dirs.filter((d) => d === "/shared")).toHaveLength(1);
  });

  it("keeps a cwd if at least one session in it is non-ended (mix per cwd)", () => {
    service = createDirectoryService(
      mkPrefs([]),
      mkSessions([
        { id: "e1", cwd: "/mixed", status: "ended" },
        { id: "a1", cwd: "/mixed", status: "active" },
      ]),
    );
    expect(service.knownDirectories()).toContain("/mixed");
  });
});
