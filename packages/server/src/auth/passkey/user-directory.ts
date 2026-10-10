/**
 * Passkey user directory (design D4; tasks 4B.1).
 *
 * `~/.pi/dashboard/users.json` (0600). Holds people — not devices: display
 * name, tier, status, WebAuthn credentials (each bound to the RP ID it was
 * created under) and invites (stored as SHA-256 of the token, never the token).
 *
 * The in-memory copy is authoritative for this single server process; every
 * mutation runs on a CLONE inside one serialized chain, is persisted under a
 * proper-lockfile lock (`withLockedJsonFile`) with an atomic write, and only
 * then swapped in. So concurrent mutations never lose a write, and a failed
 * persist leaves the in-memory state unchanged.
 *
 * Lookups (`sessionTier`, `findCredential`) are synchronous map reads, cheap
 * enough to run on every authenticated request — which is how revoke and
 * re-tier take effect at the next request.
 *
 * See change: add-passkey-user-auth.
 */
import crypto from "node:crypto";
import path from "node:path";
import { getDashboardConfigDir } from "@blackbelt-technology/pi-dashboard-shared/dashboard-paths.js";
import { isTier, type Tier } from "@blackbelt-technology/pi-dashboard-shared/tiers.js";
import { readJsonChecked, withLockedJsonFile, writeJsonAtomic } from "../locked-json-file.js";

type UserStatus = "invited" | "active" | "revoked";

export interface StoredCredential {
  /** base64url credential id. */
  id: string;
  /** base64url COSE public key. */
  publicKey: string;
  counter: number;
  transports?: string[];
  /** RP ID the credential was created under (D2). */
  rpId: string;
  createdAt?: number;
  lastUsedAt?: number;
}

export interface StoredInvite {
  id: string;
  /** sha256(token) hex — the token itself is never persisted. */
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  maxUses: number;
  uses: number;
  revoked?: boolean;
}

export interface DirectoryUser {
  id: string;
  name: string;
  tier: Tier;
  status: UserStatus;
  createdAt: number;
  /** base64url WebAuthn user handle (opaque, random). */
  webauthnUserId: string;
  credentials: StoredCredential[];
  invites: StoredInvite[];
}

interface DirectoryFile {
  version: 1;
  users: DirectoryUser[];
}

export type InviteError = "invalid" | "expired" | "exhausted";
export type InviteResolution = { ok: true; user: DirectoryUser; invite: StoredInvite } | { ok: false; error: InviteError };

const DEFAULT_INVITE_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_INVITE_TTL_MS = 7 * DEFAULT_INVITE_TTL_MS;
export const MAX_INVITE_USES = 10;
const MAX_NAME_CHARS = 64;

function defaultUsersPath(): string {
  return path.join(getDashboardConfigDir(), "users.json");
}

const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/** Display names are untrusted text: strip control characters, trim, bound. */
function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new Error("name must be a string");
  // biome-ignore lint/suspicious/noControlCharactersInRegex: stripping control chars is the point
  const name = raw.replace(/[\u0000-\u001f\u007f-\u009f]/g, "").trim();
  if (name.length === 0 || name.length > MAX_NAME_CHARS) throw new Error(`name must be 1..${MAX_NAME_CHARS} characters`);
  return name;
}

function assertTier(tier: unknown): asserts tier is Tier {
  if (!isTier(tier)) throw new Error("tier must be observe, control, or operate");
}

function isUserShape(u: unknown): u is DirectoryUser {
  const x = u as DirectoryUser;
  return (
    !!x &&
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    isTier(x.tier) &&
    (x.status === "invited" || x.status === "active" || x.status === "revoked") &&
    Array.isArray(x.credentials) &&
    Array.isArray(x.invites)
  );
}

export class UserDirectory {
  private state: DirectoryFile;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly filePath: string = defaultUsersPath(),
    private readonly now: () => number = Date.now,
  ) {
    this.state = this.load();
  }

  private load(): DirectoryFile {
    try {
      const { data } = readJsonChecked<Partial<DirectoryFile>>(this.filePath, "users");
      const users = Array.isArray(data.users) ? data.users.filter(isUserShape) : [];
      return { version: 1, users };
    } catch (err) {
      console.warn(`[passkey] users.json unreadable: ${(err as Error).message}`);
      return { version: 1, users: [] };
    }
  }

  /** Serialized clone → fn → persist → swap. */
  private mutate<T>(fn: (draft: DirectoryFile) => T): Promise<T> {
    const run = this.chain.then(async () => {
      const draft = structuredClone(this.state);
      const result = fn(draft);
      await withLockedJsonFile(this.filePath, () => writeJsonAtomic(this.filePath, draft), { logTag: "users" });
      this.state = draft;
      return result;
    });
    this.chain = run.catch(() => undefined);
    return run;
  }

  private static userIn(draft: DirectoryFile, id: string): DirectoryUser {
    const u = draft.users.find((x) => x.id === id);
    if (!u) throw new Error("unknown user");
    return u;
  }

  list(): DirectoryUser[] {
    return structuredClone(this.state.users);
  }

  get(id: string): DirectoryUser | undefined {
    const u = this.state.users.find((x) => x.id === id);
    return u ? structuredClone(u) : undefined;
  }

  isEmpty(): boolean {
    return this.state.users.length === 0;
  }

  create(input: { name: unknown; tier: unknown }): Promise<DirectoryUser> {
    let name: string;
    try {
      name = cleanName(input.name);
      assertTier(input.tier);
    } catch (err) {
      return Promise.reject(err);
    }
    const tier = input.tier as Tier;
    return this.mutate((draft) => {
      const user: DirectoryUser = {
        id: crypto.randomBytes(16).toString("hex"),
        name,
        tier,
        status: "invited",
        createdAt: this.now(),
        webauthnUserId: crypto.randomBytes(32).toString("base64url"),
        credentials: [],
        invites: [],
      };
      draft.users.push(user);
      return structuredClone(user);
    });
  }

  /** First user only, always `operate`. The caller enforces genuine-local. */
  bootstrap(input: { name: unknown }): Promise<DirectoryUser> {
    if (!this.isEmpty()) return Promise.reject(new Error("directory is not empty"));
    return this.create({ name: input.name, tier: "operate" });
  }

  setTier(id: string, tier: unknown): Promise<DirectoryUser> {
    try {
      assertTier(tier);
    } catch (err) {
      return Promise.reject(err);
    }
    return this.mutate((draft) => {
      const u = UserDirectory.userIn(draft, id);
      u.tier = tier as Tier;
      return structuredClone(u);
    });
  }

  revoke(id: string): Promise<DirectoryUser> {
    return this.mutate((draft) => {
      const u = UserDirectory.userIn(draft, id);
      u.status = "revoked";
      for (const inv of u.invites) inv.revoked = true;
      return structuredClone(u);
    });
  }

  mintInvite(
    userId: string,
    opts: { ttlMs?: number; maxUses?: number } = {},
  ): Promise<{ token: string; invite: StoredInvite }> {
    const ttlMs = Math.min(Math.max(Math.trunc(opts.ttlMs ?? DEFAULT_INVITE_TTL_MS), 1000), MAX_INVITE_TTL_MS);
    const maxUses = Math.min(Math.max(Math.trunc(opts.maxUses ?? 1), 1), MAX_INVITE_USES);
    const token = crypto.randomBytes(32).toString("base64url");
    return this.mutate((draft) => {
      const u = UserDirectory.userIn(draft, userId);
      if (u.status === "revoked") throw new Error("user is revoked");
      const createdAt = this.now();
      const invite: StoredInvite = {
        id: crypto.randomBytes(8).toString("hex"),
        tokenHash: hashToken(token),
        createdAt,
        expiresAt: createdAt + ttlMs,
        maxUses,
        uses: 0,
      };
      // Drop dead invites so the list stays bounded.
      u.invites = u.invites.filter((i) => !i.revoked && i.uses < i.maxUses && i.expiresAt > createdAt);
      u.invites.push(invite);
      return { token, invite: structuredClone(invite) };
    });
  }

  revokeInvite(inviteId: string): Promise<boolean> {
    return this.mutate((draft) => {
      for (const u of draft.users) {
        const inv = u.invites.find((i) => i.id === inviteId);
        if (inv) {
          inv.revoked = true;
          return true;
        }
      }
      return false;
    });
  }

  private static resolveIn(draft: DirectoryFile, token: unknown, now: number): InviteResolution {
    if (typeof token !== "string" || token.length < 16 || token.length > 128) return { ok: false, error: "invalid" };
    const h = hashToken(token);
    for (const user of draft.users) {
      const invite = user.invites.find((i) => i.tokenHash === h);
      if (!invite) continue;
      if (invite.revoked || user.status === "revoked") return { ok: false, error: "invalid" };
      if (invite.uses >= invite.maxUses) return { ok: false, error: "exhausted" };
      if (invite.expiresAt <= now) return { ok: false, error: "expired" };
      return { ok: true, user, invite };
    }
    return { ok: false, error: "invalid" };
  }

  resolveInvite(token: unknown): InviteResolution {
    const r = UserDirectory.resolveIn(this.state, token, this.now());
    return r.ok ? { ok: true, user: structuredClone(r.user), invite: structuredClone(r.invite) } : r;
  }

  /**
   * Atomically re-validate the invite, count one use, add the credential and
   * activate the user. Re-validation inside the mutation closes the race of
   * two enrollments on a single-use invite.
   */
  enrollWithInvite(
    token: unknown,
    credential: StoredCredential,
  ): Promise<{ ok: true; user: DirectoryUser } | { ok: false; error: InviteError | "duplicate_credential" }> {
    return this.mutate((draft) => {
      const r = UserDirectory.resolveIn(draft, token, this.now());
      if (!r.ok) return r;
      if (draft.users.some((u) => u.credentials.some((c) => c.id === credential.id))) {
        return { ok: false as const, error: "duplicate_credential" as const };
      }
      r.invite.uses += 1;
      r.user.credentials.push({ ...credential, createdAt: this.now() });
      r.user.status = "active";
      return { ok: true as const, user: structuredClone(r.user) };
    });
  }

  /**
   * Credential lookup for a ceremony. Only ACTIVE users; when `rpId` is given
   * a credential under another RP ID is not offered (orphaned, D2).
   */
  findCredential(credId: string, rpId?: string): { user: DirectoryUser; credential: StoredCredential } | null {
    for (const user of this.state.users) {
      if (user.status !== "active") continue;
      const credential = user.credentials.find((c) => c.id === credId);
      if (!credential) continue;
      if (rpId !== undefined && credential.rpId !== rpId) return null;
      return { user: structuredClone(user), credential: structuredClone(credential) };
    }
    return null;
  }

  touchCredential(userId: string, credId: string, counter: number): Promise<void> {
    return this.mutate((draft) => {
      const c = UserDirectory.userIn(draft, userId).credentials.find((x) => x.id === credId);
      if (c) {
        c.counter = counter;
        c.lastUsedAt = this.now();
      }
    });
  }

  /** Tier for a passkey session `sub`, or null (unknown / not active ⇒ unauthenticated). */
  sessionTier(userId: string): Tier | null {
    const u = this.state.users.find((x) => x.id === userId);
    return u && u.status === "active" ? u.tier : null;
  }

  /**
   * Orphan impact of moving the RP ID from `currentRpId` to `nextRpId` (D3):
   * credentials usable now (non-revoked user, `rpId === currentRpId`) that
   * would stop working.
   */
  impact(currentRpId: string, nextRpId: string): { orphaned: number; users: number } {
    if (currentRpId === nextRpId) return { orphaned: 0, users: 0 };
    let orphaned = 0;
    let users = 0;
    for (const u of this.state.users) {
      if (u.status === "revoked") continue;
      const n = u.credentials.filter((c) => c.rpId === currentRpId).length;
      orphaned += n;
      if (n > 0) users += 1;
    }
    return { orphaned, users };
  }
}
