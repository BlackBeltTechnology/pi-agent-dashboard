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
function _typeChecks(): void {
  // @ts-expect-error — an async callback would hold the lock across an await.
  void withLock(async () => 1);
  // A promise-returning sync callback is the same hazard.
  // @ts-expect-error — returning a Promise is rejected too.
  void withLock(() => Promise.resolve(1));
  // Synchronous callbacks are accepted.
  const n: Promise<number> = withLock(() => 1);
  const v: Promise<void> = withLock(() => {});
  void n;
  void v;
}

describe("withLock type contract (E6)", () => {
  it("is enforced by tsc; the type-check function exists", () => {
    expect(typeof _typeChecks).toBe("function");
  });
});
