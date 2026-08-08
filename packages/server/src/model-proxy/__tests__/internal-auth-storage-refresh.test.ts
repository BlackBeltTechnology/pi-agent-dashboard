/**
 * pi 0.84.0 BREAKING: config-form extension OAuth `refreshToken(credentials,
 * signal)` callbacks must accept and honor a concrete abort signal. The
 * dashboard's internal auth storage previously called the callback with the
 * credentials argument alone, so a hung provider refresh could never be
 * cancelled.
 *
 * See change: update-pi-core-0-84-adopt-apis (test-plan #X4, #X5, #X6).
 */
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

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
