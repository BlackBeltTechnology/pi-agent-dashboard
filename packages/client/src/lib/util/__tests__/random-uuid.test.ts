/**
 * `randomUuid()` — UUIDv4 that survives a non-secure browser context
 * (plain-http LAN origin, where `crypto.randomUUID` is undefined).
 *
 * See change: add-lan-knock-pairing (test-plan #E29).
 */

import * as runtime from "@blackbelt-technology/dashboard-plugin-runtime";
import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type PendingSpawnEntry, useSessionActions } from "../../../hooks/useSessionActions.js";
import { copyText } from "../clipboard.js";
import { randomUuid } from "../random-uuid.js";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Mimic a non-secure context: `crypto.getRandomValues` stays, `randomUUID` goes. */
const realCrypto = globalThis.crypto;

function stubNonSecureCrypto() {
  vi.stubGlobal("crypto", {
    getRandomValues: (a: Uint8Array<ArrayBuffer>) => realCrypto.getRandomValues(a),
    randomUUID: undefined,
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("randomUuid without crypto.randomUUID (E29)", () => {
  beforeEach(stubNonSecureCrypto);

  it("returns 1000 distinct RFC 4122 v4 UUIDs", () => {
    expect(crypto.randomUUID).toBeUndefined();
    const ids = Array.from({ length: 1000 }, () => randomUuid());
    for (const id of ids) expect(id).toMatch(V4);
    expect(new Set(ids).size).toBe(1000);
  });

  it("a spawn_session dispatch carries a v4 requestId and does not throw", () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn();
      const deps: any = {
        selectedId: undefined,
        send,
        navigate: vi.fn(),
        setMobileOpen: vi.fn(),
        sessions: new Map(),
        setSessions: vi.fn(),
        setSessionStates: vi.fn(),
        setSpawningCwds: vi.fn(),
        setTerminals: vi.fn(),
        clearSpawningCwd: vi.fn(),
        spawnTimeoutsRef: { current: new Map() },
        pendingTerminalCwdRef: { current: null },
        terminals: new Map(),
        pendingSpawnsRef: { current: new Map<string, PendingSpawnEntry>() },
      };
      const { result } = renderHook(() => useSessionActions(deps));
      result.current.handleSpawnSession("/p");
      const [msg] = send.mock.calls[0] as [{ type: string; requestId: string }];
      expect(msg.type).toBe("spawn_session");
      expect(msg.requestId).toMatch(V4);
      expect(deps.pendingSpawnsRef.current.has(msg.requestId)).toBe(true);
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });
});

describe("randomUuid with crypto.randomUUID", () => {
  it("delegates to the native implementation", () => {
    const native = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("crypto", { randomUUID: native, getRandomValues: vi.fn() });
    expect(randomUuid()).toBe("11111111-1111-4111-8111-111111111111");
    expect(native).toHaveBeenCalledOnce();
  });
});

describe("client util re-exports (E8)", () => {
  it("are the plugin-runtime implementations", () => {
    expect(randomUuid).toBe(runtime.randomUuid);
    expect(copyText).toBe(runtime.copyText);
  });
});
