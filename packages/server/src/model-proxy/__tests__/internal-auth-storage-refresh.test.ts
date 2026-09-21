/**
 * pi 0.84.0 BREAKING: config-form extension OAuth `refreshToken(credentials,
 * signal)` callbacks must accept and honor a concrete abort signal. The
 * dashboard's internal auth storage previously called the callback with the
 * credentials argument alone, so a hung provider refresh could never be
 * cancelled.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #X4, #X5, #X6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const writeCredential = vi.fn();
const readAuthJson = vi.fn();

vi.mock("../../auth/provider-auth-storage.js", () => ({
  readAuthJson: (...a: unknown[]) => readAuthJson(...a),
  writeCredential: (...a: unknown[]) => writeCredential(...a),
}));

import { InternalAuthStorage, type PiAiOAuthModule } from "../internal-auth-storage.js";

/** An OAuth credential already past its refresh buffer. */
function expiredCred() {
  return { type: "oauth" as const, access: "old-access", refresh: "refresh-tok", expires: Date.now() - 1 };
}

function storageWith(oauth: Partial<PiAiOAuthModule>, refreshTimeoutMs?: number) {
  readAuthJson.mockReturnValue({ anthropic: expiredCred() });
  return new InternalAuthStorage(
    {
      // `isAvailable` is the per-provider capability gate the seam added; the
      // storage now gates on it instead of on truthiness.
      // See change: adopt-piai-factory-api-registry (D7).
      isAvailable: () => true,
      getOAuthProvider: () => undefined,
      refreshOAuthToken: async () => ({}),
      ...oauth,
    } as PiAiOAuthModule,
    undefined,
    refreshTimeoutMs,
  );
}

const model = { provider: "anthropic", id: "claude", headers: {} };

describe("InternalAuthStorage — OAuth refresh abort signal (pi 0.84.x)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("X4: provider refreshToken receives a concrete AbortSignal as its 2nd argument", async () => {
    const refreshToken = vi.fn(async () => ({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: Date.now() + 3600_000,
    }));
    const storage = storageWith({ getOAuthProvider: () => ({ refreshToken }) });

    await storage.getApiKeyAndHeaders(model);

    expect(refreshToken).toHaveBeenCalledTimes(1);
    const [creds, signal] = refreshToken.mock.calls[0] as unknown as [unknown, AbortSignal];
    expect(creds).toMatchObject({ accessToken: "old-access", refreshToken: "refresh-tok" });
    expect(signal).toBeInstanceOf(AbortSignal);
    expect(signal.aborted).toBe(false);
  });

  it("X4: the generic refreshOAuthToken fallback also receives a signal", async () => {
    const refreshOAuthToken = vi.fn(async () => ({
      accessToken: "new-access",
      expiresAt: Date.now() + 3600_000,
    }));
    const storage = storageWith({ getOAuthProvider: () => undefined, refreshOAuthToken });

    await storage.getApiKeyAndHeaders(model);

    expect(refreshOAuthToken).toHaveBeenCalledTimes(1);
    const args = refreshOAuthToken.mock.calls[0] as unknown as [string, unknown, AbortSignal];
    expect(args[2]).toBeInstanceOf(AbortSignal);
  });

  it("X5: an aborted refresh persists nothing", async () => {
    // Fault injection: a provider that never answers. The storage's own
    // timeout fires its AbortSignal; a signal-honouring provider rejects.
    // Without the signal this call would hang forever.
    const refreshToken = vi.fn(
      (_creds: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(new Error("aborted")));
        }),
    );
    const storage = storageWith({ getOAuthProvider: () => ({ refreshToken } as never) }, 10);

    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow();

    const signal = refreshToken.mock.calls[0][1] as AbortSignal;
    expect(signal.aborted).toBe(true);
    expect(writeCredential).not.toHaveBeenCalled();
  });

  it("X5: a refresh that resolves after its abort still persists nothing", async () => {
    // A provider that ignores the signal and answers late must not be able to
    // write a credential the caller already gave up on.
    const refreshToken = vi.fn(
      (_creds: unknown, _signal: AbortSignal) =>
        new Promise((resolve) =>
          setTimeout(
            () => resolve({ accessToken: "late", refreshToken: "late", expiresAt: Date.now() + 1000 }),
            40,
          ),
        ),
    );
    const storage = storageWith({ getOAuthProvider: () => ({ refreshToken } as never) }, 10);

    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow();
    await new Promise((r) => setTimeout(r, 60));

    expect(writeCredential).not.toHaveBeenCalled();
  });

  it("X5: a provider that IGNORES its signal still hits the deadline and frees the lock", async () => {
    // abort() only notifies the provider; it does not settle the promise we
    // await. A provider that never settles would otherwise hang this call
    // forever and hold the per-provider refresh lock with it.
    const refreshToken = vi.fn(() => new Promise(() => {})); // never settles, ignores the signal
    const storage = storageWith({ getOAuthProvider: () => ({ refreshToken } as never) }, 10);

    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/aborted before completing/);
    expect(writeCredential).not.toHaveBeenCalled();

    // The lock must be released: a SECOND attempt has to reach the provider
    // again rather than await the first, dead promise forever.
    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/aborted before completing/);
    expect(refreshToken).toHaveBeenCalledTimes(2);
  });

  it("X6: a failed refresh leaves the previously stored credential intact", async () => {
    const refreshToken = vi.fn(async () => {
      throw new Error("provider rejected the refresh");
    });
    const storage = storageWith({ getOAuthProvider: () => ({ refreshToken }) });

    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(
      /provider rejected the refresh/,
    );
    // Failure must surface, not be swallowed, and must not overwrite storage.
    expect(writeCredential).not.toHaveBeenCalled();
  });
});

// ── fix-provider-auth-lock-contention: the write is now async and awaited ─────

describe("InternalAuthStorage — refreshed token is persisted before headers are returned", () => {
  it("X4 awaits the credential write instead of fire-and-forgetting it", async () => {
    // The write stays in flight until the test releases it; if the refresh does
    // not await it, the caller gets headers before the token is on disk.
    let releaseWrite!: () => void;
    writeCredential.mockReturnValue(new Promise<void>((resolve) => { releaseWrite = resolve; }));
    try {
      const refreshToken = vi.fn(async () => ({
        accessToken: "new-access",
        refreshToken: "new-refresh",
        expiresAt: Date.now() + 3600_000,
      }));
      const storage = storageWith({ getOAuthProvider: () => ({ refreshToken }) });

      let settled = false;
      const settle = () => { settled = true; };
      const pending = storage.getApiKeyAndHeaders(model);
      const settlement = pending.then(settle, settle);

      await new Promise((r) => setTimeout(r, 20));
      expect(writeCredential).toHaveBeenCalledWith("anthropic", expect.objectContaining({ access: "new-access" }));
      expect(settled).toBe(false);

      releaseWrite();
      await expect(pending).resolves.toBeDefined();
      await settlement;
    } finally {
      writeCredential.mockReset();
    }
  });
});

// ── adopt-piai-factory-api-registry: per-provider OAuth capability (D7) ──────

describe("InternalAuthStorage — OAuth capability gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // test-plan #X2 — the >=0.85 `dist/oauth.js` is `export {};`. Held as a
  // truthy `{}`, the OLD `if (!this.oauthModule)` guard passed and the next
  // line threw `TypeError: this.oauthModule.getOAuthProvider is not a
  // function`. The gate must report unavailable instead.
  it("X2: an unavailable provider yields a diagnosable error, never a TypeError", async () => {
    const storage = storageWith({
      isAvailable: () => false,
      unavailableReason: () => "dist/oauth.js exports no refresh functions",
      // Present but never reachable — calling either would be the bug.
      getOAuthProvider: () => {
        throw new Error("must not be consulted for an unavailable provider");
      },
    });

    const err = await storage.getApiKeyAndHeaders(model).catch((e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).not.toBe("TypeError");
    expect((err as Error).message).toContain("anthropic");
    expect((err as Error).message).toContain("dist/oauth.js exports no refresh functions");
    expect(writeCredential).not.toHaveBeenCalled();
  });

  it("X2: a null oauth facade still reports diagnosably rather than crashing", async () => {
    readAuthJson.mockReturnValue({ anthropic: expiredCred() });
    const storage = new InternalAuthStorage(null);
    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/unavailable/);
  });

  // test-plan #X4 — degradation is PARTIAL. An api-key provider must keep
  // routing while an OAuth provider with no implementation fails.
  it("X4: api-key models keep routing while an OAuth provider is unavailable", async () => {
    readAuthJson.mockReturnValue({
      anthropic: expiredCred(),
      openai: { type: "api_key" as const, key: "sk-live" },
    });
    const storage = new InternalAuthStorage({
      isAvailable: () => false,
      unavailableReason: () => "no reachable OAuth implementation",
      getOAuthProvider: () => undefined,
      refreshOAuthToken: async () => ({}),
    } as PiAiOAuthModule);

    await expect(
      storage.getApiKeyAndHeaders({ provider: "openai", id: "gpt", headers: {} }),
    ).resolves.toEqual({ apiKey: "sk-live", headers: {} });
    await expect(storage.getApiKeyAndHeaders(model)).rejects.toThrow(/unavailable/);
  });

  // test-plan #X3 — a still-valid credential must not consult the facade at
  // all, so an unavailable provider whose token is fresh keeps working.
  it("X3: a credential inside the refresh buffer never reaches the gate", async () => {
    readAuthJson.mockReturnValue({
      anthropic: { type: "oauth" as const, access: "fresh", refresh: "r", expires: Date.now() + 3600_000 },
    });
    const isAvailable = vi.fn(() => false);
    const storage = new InternalAuthStorage({
      isAvailable,
      getOAuthProvider: () => undefined,
      refreshOAuthToken: async () => ({}),
    } as unknown as PiAiOAuthModule);

    await expect(storage.getApiKeyAndHeaders(model)).resolves.toEqual({
      apiKey: "fresh",
      headers: {},
    });
    expect(isAvailable).not.toHaveBeenCalled();
  });
});
