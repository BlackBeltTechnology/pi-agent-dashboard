/**
 * Test double for the identity challenge behind the header selector's route checks.
 *
 * The Ed25519 proof itself (fingerprint recomputed from the key, signature verified, outcome
 * matrix) is covered with REAL WebCrypto in `lib/__tests__/server-route-check.test.ts`; the
 * selector tests only need "which identity does this address prove" and the transport to stay
 * under the test's own `fetch` mock. `challengeIdentity` therefore POSTs
 * `<base>/api/pair/challenge` through the global `fetch` (so a rejecting / hanging / recording
 * fetch mock behaves as the transport) and answers with the fingerprint scripted for the host.
 *
 *   vi.mock("../../lib/pairing/pair-protocol.js", async (orig) =>
 *     (await import("./selector-identity-mock.js")).pairProtocolMock(await orig()));
 *
 * See change: group-servers-by-identity (test-plan #P1, #F1-#F5, #X4, #X5).
 */
import type * as PairProtocol from "../../lib/pairing/pair-protocol.js";

export const identityMock = {
  /** host → fingerprint it proves (default: `sha256:<host>`). */
  proves: new Map<string, string>(),
  /** hosts whose challenge answers without a proof (older server). */
  noProof: new Set<string>(),
  /** hosts whose signature does not verify (bad signature / unparseable key). */
  invalid: new Set<string>(),
  /** the browser has no WebCrypto Ed25519. */
  cryptoless: false,
  reset(): void {
    this.proves.clear();
    this.noProof.clear();
    this.invalid.clear();
    this.cryptoless = false;
  },
};

export const fingerprintOf = (host: string): string => identityMock.proves.get(host) ?? `sha256:${host}`;

export function pairProtocolMock(actual: typeof PairProtocol): typeof PairProtocol {
  return {
    ...actual,
    canProveIdentity: () => !identityMock.cryptoless,
    challengeIdentity: async (base: string, timeoutMs = 2000) => {
      const host = new URL(base).hostname.replace(/^\[|\]$/g, "");
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${base}/api/pair/challenge`, { method: "POST", signal: ac.signal });
      } finally {
        clearTimeout(timer);
      }
      // The challenge route is public: a guarded 403 on the health leg does not stop the proof.
      if (identityMock.noProof.has(host) || (res.status !== 403 && !res.ok)) {
        throw new actual.IdentityChallengeError("no-proof");
      }
      return { fingerprint: fingerprintOf(host), publicKey: "pk", verified: !identityMock.invalid.has(host) };
    },
  };
}
