/**
 * Native WebAuthn ceremonies (design D1-result = B, D2, D5).
 *
 * `@simplewebauthn/server` does all crypto and attestation parsing; this
 * module owns only policy:
 *  - every ceremony needs a STABLE RP context (`409 unstable_origin`),
 *  - user verification is required on registration and assertion,
 *  - challenges are single-use and TTL-bound (`ChallengeStore`),
 *  - registration only through a live invite, re-validated atomically at
 *    enrollment (`UserDirectory.enrollWithInvite`),
 *  - assertion only with an ACTIVE user's credential under the CURRENT RP ID;
 *    a credential under another RP ID is reported `orphaned_credential`.
 *
 * Login is discoverable-credential (no `allowCredentials`), so the server
 * never reveals which users exist.
 *
 * See change: add-passkey-user-auth.
 */
import {
  type AuthenticationResponseJSON,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import { ChallengeStore } from "./challenge-store.js";
import { logPasskey } from "./passkey-log.js";
import { PhoneSigninManager } from "./phone-signin.js";
import type { RpContext } from "./rp-context.js";
import type { DirectoryUser, UserDirectory } from "./user-directory.js";

export class PasskeyError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(code);
  }
}

interface RegisterSlot {
  token: string;
  challenge: string;
  rpId: string;
  origin: string;
}
interface AuthSlot {
  challenge: string;
  rpId: string;
  origin: string;
}

export interface PasskeyServiceDeps {
  directory: UserDirectory;
  /** Resolve the live RP context for the configured `auth.redirectBaseUrl`. */
  getRpContext: (redirectBaseUrl?: string) => RpContext;
  now?: () => number;
  log?: (line: string) => void;
}

const RP_NAME = "PI Dashboard";
/** `provider` claim of a passkey-issued session JWT. */
export const PASSKEY_PROVIDER = "passkey";

export class PasskeyService {
  readonly directory: UserDirectory;
  readonly phone: PhoneSigninManager;
  private readonly getRpContext: (redirectBaseUrl?: string) => RpContext;
  private enabled = false;
  private redirectBaseUrl: string | undefined;
  private readonly log: (line: string) => void;
  private readonly challenges: ChallengeStore<RegisterSlot | AuthSlot>;

  constructor(deps: PasskeyServiceDeps) {
    this.directory = deps.directory;
    this.getRpContext = deps.getRpContext;
    this.log = deps.log ?? ((l) => console.log(l));
    this.challenges = new ChallengeStore(deps.now ?? Date.now);
    this.phone = new PhoneSigninManager({ now: deps.now, log: this.log });
  }

  /**
   * Apply (re)loaded auth config: `auth.passkeys.enabled` and the
   * `auth.redirectBaseUrl` override the RP context derives from. Called by the
   * auth plugin at register and on every `_reloadAuth`.
   */
  configure(auth: { passkeys?: { enabled: boolean }; redirectBaseUrl?: string } | undefined): void {
    this.enabled = auth?.passkeys?.enabled === true;
    this.redirectBaseUrl = auth?.redirectBaseUrl;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Is a validated session JWT still live? Non-passkey sessions: always (their
   * tier is fixed until expiry). Passkey sessions: passkeys enabled AND the
   * user is active in the directory — re-read on every request, so revoke and
   * re-tier apply at the next request (D4).
   */
  sessionTier(payload: { provider?: string; sub?: string }): import("@blackbelt-technology/pi-dashboard-shared/tiers.js").Tier | null {
    if (payload.provider !== PASSKEY_PROVIDER) return null;
    if (!this.enabled || typeof payload.sub !== "string") return null;
    return this.directory.sessionTier(payload.sub);
  }

  rpContext(): RpContext {
    return this.getRpContext(this.redirectBaseUrl);
  }

  /** Throws `409 unstable_origin` unless the RP context is stable. */
  requireStable(): RpContext {
    const ctx = this.rpContext();
    if (!ctx.stable) throw new PasskeyError("unstable_origin", 409);
    return ctx;
  }

  async registrationOptions(token: unknown): Promise<{ challengeId: string; options: PublicKeyCredentialCreationOptionsJSON }> {
    const ctx = this.requireStable();
    const r = this.directory.resolveInvite(token);
    if (!r.ok) throw new PasskeyError(`invite_${r.error}`, 410);
    const options = await generateRegistrationOptions({
      rpName: RP_NAME,
      rpID: ctx.rpId,
      userName: r.user.name,
      userDisplayName: r.user.name,
      userID: new Uint8Array(Buffer.from(r.user.webauthnUserId, "base64url")),
      attestationType: "none",
      excludeCredentials: r.user.credentials
        .filter((c) => c.rpId === ctx.rpId)
        .map((c) => ({ id: c.id, transports: c.transports })),
      authenticatorSelection: { residentKey: "required", userVerification: "required" },
    });
    const challengeId = this.challenges.issue("register", {
      token: token as string,
      challenge: options.challenge,
      rpId: ctx.rpId,
      origin: ctx.rpOrigin,
    });
    return { challengeId, options };
  }

  async verifyRegistration(challengeId: unknown, response: unknown): Promise<DirectoryUser> {
    const slot = this.challenges.take(challengeId, "register") as RegisterSlot | null;
    if (!slot) throw new PasskeyError("challenge_invalid", 400);
    let verification: Awaited<ReturnType<typeof verifyRegistrationResponse>>;
    try {
      verification = await verifyRegistrationResponse({
        response: response as RegistrationResponseJSON,
        expectedChallenge: slot.challenge,
        expectedOrigin: slot.origin,
        expectedRPID: slot.rpId,
        requireUserVerification: true,
      });
    } catch {
      throw new PasskeyError("verification_failed", 401);
    }
    if (!verification.verified) throw new PasskeyError("verification_failed", 401);
    const { credential } = verification.registrationInfo;
    const out = await this.directory.enrollWithInvite(slot.token, {
      id: credential.id,
      publicKey: Buffer.from(credential.publicKey).toString("base64url"),
      counter: credential.counter,
      ...(credential.transports ? { transports: credential.transports } : {}),
      rpId: slot.rpId,
    });
    if (!out.ok) {
      throw out.error === "duplicate_credential"
        ? new PasskeyError("duplicate_credential", 409)
        : new PasskeyError(`invite_${out.error}`, 410);
    }
    logPasskey("enrolled", out.user.id, this.log);
    return out.user;
  }

  async authenticationOptions(): Promise<{ challengeId: string; options: PublicKeyCredentialRequestOptionsJSON }> {
    const ctx = this.requireStable();
    const options = await generateAuthenticationOptions({ rpID: ctx.rpId, userVerification: "required" });
    const challengeId = this.challenges.issue("auth", { challenge: options.challenge, rpId: ctx.rpId, origin: ctx.rpOrigin });
    return { challengeId, options };
  }

  /** Verify an assertion; returns the ACTIVE user. Does not log `login` when `quiet`. */
  async verifyAuthentication(challengeId: unknown, response: unknown, opts: { quiet?: boolean } = {}): Promise<DirectoryUser> {
    const slot = this.challenges.take(challengeId, "auth") as AuthSlot | null;
    if (!slot) throw new PasskeyError("challenge_invalid", 400);
    const resp = response as AuthenticationResponseJSON;
    const credId = typeof resp?.id === "string" ? resp.id : "";
    const found = this.directory.findCredential(credId, slot.rpId);
    if (!found) {
      const elsewhere = this.directory.findCredential(credId);
      if (elsewhere) {
        logPasskey("orphaned", elsewhere.user.id, this.log);
        throw new PasskeyError("orphaned_credential", 401);
      }
      throw new PasskeyError("unknown_credential", 401);
    }
    // A discoverable credential returns the user handle; it must match.
    const handle = resp.response?.userHandle;
    if (handle !== undefined && handle !== found.user.webauthnUserId) throw new PasskeyError("verification_failed", 401);
    let verification: Awaited<ReturnType<typeof verifyAuthenticationResponse>>;
    try {
      verification = await verifyAuthenticationResponse({
        response: resp,
        expectedChallenge: slot.challenge,
        expectedOrigin: slot.origin,
        expectedRPID: slot.rpId,
        credential: {
          id: found.credential.id,
          publicKey: new Uint8Array(Buffer.from(found.credential.publicKey, "base64url")),
          counter: found.credential.counter,
          transports: found.credential.transports,
        },
        requireUserVerification: true,
      });
    } catch {
      throw new PasskeyError("verification_failed", 401);
    }
    if (!verification.verified) throw new PasskeyError("verification_failed", 401);
    await this.directory.touchCredential(found.user.id, found.credential.id, verification.authenticationInfo.newCounter);
    if (!opts.quiet) logPasskey("login", found.user.id, this.log);
    return found.user;
  }
}
