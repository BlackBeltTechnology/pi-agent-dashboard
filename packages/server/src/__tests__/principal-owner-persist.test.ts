/**
 * §6.2 / D11: the spawn-time owner MUST reach the `.meta.json` sidecar, or a
 * dashboard restart makes every session ownerless (= invisible to its owner).
 *
 * Regression (multi-user run, 2026-09-24): a fresh dashboard spawn registers
 * with `msg.sessionFile` set while the in-memory session did not yet carry it,
 * so the owner arm (which read `session.sessionFile` only) silently skipped the
 * write — the `source: "dashboard"` stamp in the SAME message (which reads
 * `msg.sessionFile`) landed, the owner did not.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readSessionMeta } from "@blackbelt-technology/pi-dashboard-shared/session-meta.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireEvents } from "../event-wiring.js";
import { createBrowserGateway } from "../pairing/browser-gateway.js";
import { createPendingForkRegistry } from "../pending/pending-fork-registry.js";
import { createPendingPrincipalOwnerRegistry } from "../pending/pending-principal-owner-registry.js";
import { createMemoryEventStore } from "../persistence/memory-event-store.js";
import { createMetaPersistence } from "../persistence/meta-persistence.js";
import { createMemorySessionManager } from "../session/memory-session-manager.js";
import { sessionToMeta } from "../session/session-to-meta.js";
import { makeFakeDirectoryService } from "./helpers/load-fixtures.js";

const OWNER = { iss: "https://idp.example/realms/r", sub: "anna-sub" };

describe("principalOwner persistence on a fresh spawn register", () => {
  let tmpDir: string;
  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "owner-persist-"));
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function setup() {
    const sessionManager = createMemorySessionManager();
    const piGateway = {
      start: vi.fn(), stop: vi.fn(), sendToSession: vi.fn(),
      getConnectedSessionIds: vi.fn(() => []), hasSession: vi.fn(() => true), onEvent: undefined,
    } as any;
    const browserGateway = createBrowserGateway(sessionManager, createMemoryEventStore(() => false), piGateway);
    const owners = createPendingPrincipalOwnerRegistry();
    wireEvents({
      sessionManager,
      eventStore: createMemoryEventStore(() => false),
      piGateway,
      browserGateway,
      sessionOrderManager: {
        insert: vi.fn(), remove: vi.fn(), getOrder: vi.fn(() => []), reorder: vi.fn(),
        getAllOrders: vi.fn(() => ({})), moveToFront: vi.fn(), rekey: vi.fn(),
      } as any,
      preferencesStore: {
        getPinnedDirectories: () => [], setPinnedDirectories: () => {},
        getSessionOrder: () => ({}), setSessionOrder: () => {},
        getAutoNameSessions: () => false,
      } as any,
      pendingForkRegistry: createPendingForkRegistry(),
      directoryService: makeFakeDirectoryService().service,
      knownSessionIds: new Set<string>(),
      pendingDashboardSpawns: new Map<string, number>(),
      pendingPrincipalOwnerRegistry: owners,
    } as any);
    return { sessionManager, piGateway, owners };
  }

  it("writes the owner to .meta.json using the register message's sessionFile", () => {
    const { sessionManager, piGateway, owners } = setup();
    const file = path.join(tmpDir, "2026-09-24T00-00-00-000Z_s1.jsonl");
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "s1", cwd: "/repo" })}\n`);
    owners.file("tok-1", OWNER);
    // The in-memory session exists but does NOT yet carry the sessionFile.
    sessionManager.register({ id: "s1", cwd: "/repo", source: "tui", startedAt: 1 } as any);

    piGateway.onEvent("s1", { type: "session_register", sessionId: "s1", cwd: "/repo", source: "tui", spawnToken: "tok-1", sessionFile: file });

    expect(sessionManager.get("s1")?.principalOwner).toEqual(OWNER);
    expect(readSessionMeta(file)?.principalOwner).toEqual(OWNER);
  });

  it("a bridge re-register (dashboard restart / reattach) keeps the in-memory owner", () => {
    const sessionManager = createMemorySessionManager();
    sessionManager.register({ id: "s3", cwd: "/repo", source: "dashboard", startedAt: 1 } as any);
    sessionManager.update("s3", { principalOwner: OWNER });
    sessionManager.register({ id: "s3", cwd: "/repo", source: "tui", startedAt: 1, registerReason: "reattach" } as any);
    expect(sessionManager.get("s3")?.principalOwner).toEqual(OWNER);
  });

  it("a re-register with no in-memory owner restores it from .meta.json (session not restored by the boot scan)", () => {
    const { sessionManager, piGateway } = setup();
    const file = path.join(tmpDir, "2026-09-24T00-00-00-000Z_s4.jsonl");
    // Sidecar only: pi has not written the transcript yet, so the boot scan
    // never restored this session into memory.
    fs.writeFileSync(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ cwd: "/repo", source: "dashboard", principalOwner: OWNER }));
    sessionManager.register({ id: "s4", cwd: "/repo", source: "tui", startedAt: 1, sessionFile: file } as any);
    piGateway.onEvent("s4", { type: "session_register", sessionId: "s4", cwd: "/repo", source: "tui", sessionFile: file, registerReason: "reattach" });
    expect(sessionManager.get("s4")?.principalOwner).toEqual(OWNER);
  });

  it("a re-register never CHANGES an existing owner from disk (only the spawn token confers ownership)", () => {
    const { sessionManager, piGateway } = setup();
    const file = path.join(tmpDir, "2026-09-24T00-00-00-000Z_s5.jsonl");
    const OTHER = { iss: OWNER.iss, sub: "bela-sub" };
    fs.writeFileSync(file.replace(/\.jsonl$/, ".meta.json"), JSON.stringify({ cwd: "/repo", principalOwner: OTHER }));
    sessionManager.register({ id: "s5", cwd: "/repo", source: "tui", startedAt: 1, sessionFile: file } as any);
    sessionManager.update("s5", { principalOwner: OWNER });
    piGateway.onEvent("s5", { type: "session_register", sessionId: "s5", cwd: "/repo", source: "tui", sessionFile: file });
    expect(sessionManager.get("s5")?.principalOwner).toEqual(OWNER);
  });

  it("survives the routine FULL-overwrite save (sessionToMeta enumerates principalOwner)", () => {
    const file = path.join(tmpDir, "2026-09-24T00-00-00-000Z_s2.jsonl");
    fs.writeFileSync(file, `${JSON.stringify({ type: "session", id: "s2", cwd: "/repo" })}\n`);
    const sessionManager = createMemorySessionManager();
    sessionManager.register({ id: "s2", cwd: "/repo", source: "dashboard", startedAt: 1, sessionFile: file } as any);
    sessionManager.update("s2", { principalOwner: OWNER });
    // Same call server.ts makes on every session change.
    const persistence = createMetaPersistence();
    persistence.save(file, sessionToMeta(sessionManager.get("s2")!));
    persistence.flush(file); // save() is debounced
    expect(readSessionMeta(file)?.principalOwner).toEqual(OWNER);
  });
});
