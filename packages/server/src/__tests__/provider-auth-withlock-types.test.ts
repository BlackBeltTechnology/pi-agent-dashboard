/**
 * E6 — `withLock` holds the auth.json lock only across a SYNCHRONOUS
 * read-modify-write, and its type enforces that. The real assertion is
 * compile-time: `npm run lint` (`tsc --noEmit`) fails if the
 * `@ts-expect-error` below is unused, i.e. if an async callback compiles.
 *
 * See change: harden-auth-json-lock-coordination (design D2).
 */
import { describe, expect, it } from "vitest";
import { withLock } from "../auth/provider-auth-storage.js";

/** Never invoked — type-checked only, so no lock is taken. */
function _typeChecks(): unknown[] {
  return [
    // @ts-expect-error — an async callback would hold the lock across an await.
    withLock(async () => 1),
    // @ts-expect-error — a promise-returning sync callback is the same hazard.
    withLock(() => Promise.resolve(1)),
    // Synchronous callbacks are accepted, and the result type is preserved.
    withLock(() => 1) satisfies Promise<number>,
    withLock(() => {}) satisfies Promise<void>,
  ];
}

describe("withLock type contract (E6)", () => {
  it("is enforced by tsc; the type-check function exists", () => {
    expect(typeof _typeChecks).toBe("function");
  });
});
