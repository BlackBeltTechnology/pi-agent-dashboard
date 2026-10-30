/**
 * `pi-dashboard credentials status|decrypt|reset` (test-plan E16b, E65–E79, E97,
 * X20–X22, X27). Exemplars: `cli-status.test.ts` (stdout capture + exit code) and
 * `cli-stop.test.ts` (`/api/health` probe stubs). Tests never touch a real keychain
 * (D9): an in-process stub provider or a key file in a tmp HOME.
 * See change: encrypt-credentials-at-rest (D7, D8, D11; decisions G6, G10, G11; task 8.1).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEnvelopeCodec, deriveKid } from "../auth/credential-envelope.js";
import { _resetCredentialKeyForTests, initCredentialKey } from "../auth/credential-key.js";
import { createPluginCredentialStore } from "../auth/plugin-credential-store.js";
import { CREDENTIALS_USAGE, type CredentialsDeps, cmdCredentials } from "../cli/credentials-command.js";
import {
  b64,
  filePath,
  KEY_1,
  KEY_2,
  resetCredentialFiles,
  sha256,
  stubKeychain,
  writeEnvelopeFile,
  writeKeyFile,
  writePlain,
  writeVia,
} from "./helpers/credential-key-kit.js";
import { readVaultDoc } from "./helpers/vault-test-codec.js";

// E71/E76 lock spy: wrap `acquireLock` (store locks AND the key-creation lock go through it).
const events = vi.hoisted(() => [] as string[]);
// Review B1: the `onCompromised` callback of every acquired lock, so a test can report a compromise.
const compromisers = vi.hoisted(() => [] as Array<(err: Error) => void>);
vi.mock("../auth/locked-json-file.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../auth/locked-json-file.js")>();
  return {
    ...actual,
    acquireLock: async (...args: Parameters<typeof actual.acquireLock>) => {
      const name = args[0].split(/[\\/]/).pop();
      compromisers.push(args[2]);
      const release = await actual.acquireLock(...args);
      events.push(`lock ${name}`);
      return async () => {
        events.push(`unlock ${name}`);
        return release();
      };
    },
  };
});

const ENV_KEY = "PI_DASHBOARD_DATA_KEY_FILE";
const isWin = process.platform === "win32"; // platform-branch-ok: POSIX-mode asserts are skipped on win32
const PLUGIN = "plugin-credentials.json";
const VAULT = "vault.json";
const PLUGIN_DOC = { demo: { token: { value: "SECRET-PLUGIN-VALUE" } } };
const VAULT_DOC = { accounts: [{ id: "a1", secret: "SECRET-VAULT-VALUE" }] };

const refusedErr = () =>
  Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }) });
const refused = vi.fn(async () => { throw refusedErr(); });
const reply = (status: number) => vi.fn(async () => new Response("{}", { status }));
const failWith = (code: string) =>
  vi.fn(async () => { throw Object.assign(new TypeError("fetch failed"), { cause: Object.assign(new Error(code), { code }) }); });
const hang = vi.fn(
  (_url: unknown, init?: RequestInit) =>
    new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener("abort", () => rej(init.signal?.reason));
    }),
);

let home: string;
let realHome: string | undefined;
beforeEach(() => {
  realHome = process.env.HOME;
  home = fs.mkdtempSync(path.join(os.tmpdir(), "pi-cli-cred-"));
  process.env.HOME = home;
  events.length = 0;
  _resetCredentialKeyForTests();
  resetCredentialFiles(home);
});
afterEach(() => {
  _resetCredentialKeyForTests();
  vi.restoreAllMocks();
  if (realHome === undefined) delete process.env.HOME;
  else process.env.HOME = realHome;
  fs.rmSync(home, { recursive: true, force: true });
});

const noTty = { isTTY: false };

function run(argv: string[], over: Partial<CredentialsDeps> = {}, opts: { port: number; host?: string } = { port: 18999 }) {
  const out: string[] = [];
  const err: string[] = [];
  const deps: CredentialsDeps = {
    homeDir: home,
    env: {},
    out: (l) => out.push(l),
    err: (l) => err.push(l),
    fetchImpl: refused as unknown as typeof fetch,
    readPid: () => null,
    isProcessAlive: () => false,
    readLockMeta: () => null,
    stdin: noTty,
    ...over,
  };
  return cmdCredentials(argv, opts, deps).then((code) => ({ code, out, err, text: [...out, ...err].join("\n") }));
}

/** Both files encrypted under KEY_1; stub keychain holds KEY_1. */
function seedEncrypted() {
  writeEnvelopeFile("plugin-credentials", PLUGIN_DOC, KEY_1);
  writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
  return stubKeychain(b64(KEY_1));
}
const keyOpts = (kc: ReturnType<typeof stubKeychain>): Partial<CredentialsDeps> => ({ keyOptions: { entryFactory: kc.factory } });
const readJson = (id: "vault" | "plugin-credentials") => JSON.parse(fs.readFileSync(filePath(id, home), "utf8"));
const undecryptable = (name: string) => fs.readdirSync(path.dirname(filePath(name === VAULT ? "vault" : "plugin-credentials", home))).filter((n) => n.startsWith(`${name}.undecryptable-`));

describe("usage", () => {
  it.each([[[]], [["frobnicate"]], [["status", "--yes"]], [["decrypt", "--vault"]], [["reset", "--vualt"]], [["status", "decrypt"]]])(
    "usage: %j → exit 2 with the usage line, nothing touched",
    async (argv) => {
      const kc = seedEncrypted();
      const before = sha256(filePath("vault", home));
      const r = await run(argv, keyOpts(kc));
      expect(r.code).toBe(2);
      expect(r.err).toContain(CREDENTIALS_USAGE);
      expect(sha256(filePath("vault", home))).toBe(before);
      expect(kc.calls.get + kc.calls.set).toBe(0);
    },
  );

  it("usage: flags consumed by buildConfig before the verb are skipped", async () => {
    const r = await run(["--port", "9000", "status"]);
    expect(r.code).toBe(0);
  });
});

describe("status (E65, E97)", () => {
  it("E65: encrypted files + siblings → key=value lines, no marker, no key", async () => {
    const kc = seedEncrypted();
    const dir = path.dirname(filePath("vault", home));
    fs.writeFileSync(`${filePath("plugin-credentials", home)}.corrupt-20260101T000000000Z`, "x");
    fs.writeFileSync(`${filePath("plugin-credentials", home)}.corrupt-20260101T000000000Z-1`, "x");
    fs.writeFileSync(path.join(dir, "vault.json.undecryptable-20260101T000000Z"), "x");
    const r = await run(["status"], keyOpts(kc));
    expect(r.code).toBe(0);
    expect(r.out).toEqual([
      `source=keychain state=ready kid=${deriveKid(KEY_1)}`,
      "plugin-credentials.json: encrypted",
      "vault.json: encrypted",
      "corrupt=2 undecryptable=1",
    ]);
    expect(r.text).not.toContain("pi-dashboard-encrypted");
    expect(r.text).not.toContain(b64(KEY_1));
    expect(r.text).not.toContain("SECRET-");
  });

  it("E65: a locked file shows its reason; the key state shows the failure", async () => {
    writeEnvelopeFile("vault", VAULT_DOC, KEY_2);
    const r = await run(["status"], keyOpts(stubKeychain(b64(KEY_1))));
    expect(r.out[0]).toMatch(/^source=keychain state=ready kid=[0-9a-f]{16}$/);
    expect(r.out).toContain("vault.json: locked key_mismatch");
    expect(r.out).toContain("plugin-credentials.json: absent");
    const lost = await run(["status"], keyOpts(stubKeychain(null)));
    expect(lost.out[0]).toBe("source=keychain state=unavailable reason=key_missing");
    expect(lost.out).toContain("vault.json: locked key_missing");
  });

  it("E65: key-file source is reported and never modified", async () => {
    seedEncrypted();
    const kf = writeKeyFile(b64(KEY_1));
    const r = await run(["status"], { env: { [ENV_KEY]: kf } });
    expect(r.out[0]).toBe(`source=key-file state=ready kid=${deriveKid(KEY_1)}`);
  });

  it("E65: plaintext only and no key → deferred, and status never creates a key", async () => {
    writePlain("vault", VAULT_DOC);
    const kc = stubKeychain(null);
    const r = await run(["status"], keyOpts(kc));
    expect(r.out[0]).toBe("source=keychain state=deferred");
    expect(r.out).toContain("vault.json: plaintext");
    expect(kc.calls.set).toBe(0);
  });

  it("E97: no credential files → keychain untouched, both absent, deferred, exit 0", async () => {
    const kc = stubKeychain(b64(KEY_1));
    const r = await run(["status"], keyOpts(kc));
    expect(r.code).toBe(0);
    expect(kc.calls.get + kc.calls.set).toBe(0);
    expect(kc.calls.ctor).toHaveLength(0);
    expect(r.out).toEqual([
      "source=keychain state=deferred",
      "plugin-credentials.json: absent",
      "vault.json: absent",
      "corrupt=0 undecryptable=0",
    ]);
  });
});

describe("decrypt (E66–E70, X20–X22)", () => {
  it("E66: both files → plaintext 0600, deep-equal, exact stdout, no marker", async () => {
    const kc = seedEncrypted();
    const r = await run(["decrypt", "--yes"], keyOpts(kc));
    expect(r.code).toBe(0);
    expect(r.out).toEqual(["plugin-credentials.json: decrypted", "vault.json: decrypted"]);
    expect(readJson("plugin-credentials")).toEqual(PLUGIN_DOC);
    expect(readJson("vault")).toEqual(VAULT_DOC);
    if (!isWin) {
      expect(fs.statSync(filePath("vault", home)).mode & 0o777).toBe(0o600);
      expect(fs.statSync(filePath("plugin-credentials", home)).mode & 0o777).toBe(0o600);
    }
    expect(r.text).not.toContain("pi-dashboard-encrypted");
    expect(r.text).not.toContain("SECRET-");
    expect(fs.existsSync(`${filePath("vault", home)}.tmp`)).toBe(false);
  });

  it("E67: idempotent; an absent file is reported absent", async () => {
    const kc = seedEncrypted();
    await run(["decrypt", "--yes"], keyOpts(kc));
    fs.rmSync(filePath("vault", home));
    const again = await run(["decrypt", "--yes"], keyOpts(stubKeychain(b64(KEY_1))));
    expect(again.code).toBe(0);
    expect(again.out).toEqual(["plugin-credentials.json: already-plaintext", "vault.json: absent"]);
    const third = await run(["decrypt", "--yes"], keyOpts(stubKeychain(b64(KEY_1))));
    expect(third.out).toEqual(["plugin-credentials.json: already-plaintext", "vault.json: absent"]);
    const both = (await run(["decrypt", "--yes"])).out;
    expect(both).toEqual(["plugin-credentials.json: already-plaintext", "vault.json: absent"]);
  });

  it("E67: a plaintext-only host never touches the keychain", async () => {
    writePlain("vault", VAULT_DOC);
    const kc = stubKeychain(b64(KEY_1));
    const r = await run(["decrypt", "--yes"], keyOpts(kc));
    expect(r.out).toEqual(["plugin-credentials.json: absent", "vault.json: already-plaintext"]);
    expect(kc.calls.get + kc.calls.set + kc.calls.ctor.length).toBe(0);
  });

  describe("E68: confirmation", () => {
    const cases: Array<[string, Partial<CredentialsDeps>, string[], boolean]> = [
      ["TTY answer y", { stdin: { isTTY: true }, prompt: async () => "y" }, [], true],
      ["TTY answer n", { stdin: { isTTY: true }, prompt: async () => "n" }, [], false],
      ["no TTY, no --yes", {}, [], false],
      ["--yes", {}, ["--yes"], true],
    ];
    it.each(cases)("%s", async (_n, over, flags, proceeds) => {
      const kc = seedEncrypted();
      const before = sha256(filePath("vault", home));
      const r = await run(["decrypt", ...flags], { ...keyOpts(kc), ...over });
      if (proceeds) {
        expect(r.code).toBe(0);
        expect(readJson("vault")).toEqual(VAULT_DOC);
      } else {
        expect(r.code).not.toBe(0);
        expect(sha256(filePath("vault", home))).toBe(before);
      }
    });
  });

  describe("E69: server check", () => {
    const cases: Array<[string, () => typeof fetch, boolean]> = [
      ["200", () => reply(200) as unknown as typeof fetch, false],
      ["401", () => reply(401) as unknown as typeof fetch, false],
      ["500", () => reply(500) as unknown as typeof fetch, false],
      ["ECONNREFUSED", () => refused as unknown as typeof fetch, true],
      ["timeout", () => hang as unknown as typeof fetch, false],
      ["ECONNRESET", () => failWith("ECONNRESET") as unknown as typeof fetch, false],
    ];
    it.each(cases)("%s", async (_n, make, proceeds) => {
      const kc = seedEncrypted();
      const before = [sha256(filePath("vault", home)), sha256(filePath("plugin-credentials", home))];
      const r = await run(["decrypt", "--yes"], { ...keyOpts(kc), fetchImpl: make(), timeoutMs: 30 });
      if (proceeds) {
        expect(r.code).toBe(0);
      } else {
        expect(r.code).not.toBe(0);
        expect([sha256(filePath("vault", home)), sha256(filePath("plugin-credentials", home))]).toEqual(before);
      }
    });
  });

  it("E70: one locked file blocks the whole decrypt (names vault.json + key_mismatch)", async () => {
    writeEnvelopeFile("plugin-credentials", PLUGIN_DOC, KEY_1);
    writeEnvelopeFile("vault", VAULT_DOC, KEY_2);
    const before = [sha256(filePath("plugin-credentials", home)), sha256(filePath("vault", home))];
    const r = await run(["decrypt", "--yes"], keyOpts(stubKeychain(b64(KEY_1))));
    expect(r.code).not.toBe(0);
    expect(r.out).toContain("vault.json: failed key_mismatch");
    expect(r.out).toContain("plugin-credentials.json: failed not-written");
    expect([sha256(filePath("plugin-credentials", home)), sha256(filePath("vault", home))]).toEqual(before);
  });

  it("E71: lock order plugin → vault, both held until the last write; a concurrent set waits", async () => {
    const kc = seedEncrypted();
    const codec = createEnvelopeCodec("plugin-credentials", () => ({ ok: true, key: KEY_1 }));
    const store = createPluginCredentialStore("demo", { codec, path: filePath("plugin-credentials", home) });
    let setDone = false;
    let pending: Promise<unknown> | undefined;
    const r = await run(["decrypt", "--yes"], {
      ...keyOpts(kc),
      afterLocked: async () => {
        // the file is still the ORIGINAL envelope while both locks are held
        expect(events).toEqual(["lock plugin-credentials.json", "lock vault.json"]);
        pending = store.set("late", { value: "NEW" }).then(() => { setDone = true; });
        pending.catch(() => undefined);
        await new Promise((res) => setTimeout(res, 250));
        expect(setDone).toBe(false);
      },
    });
    expect(r.code).toBe(0);
    expect(events).toEqual(["lock plugin-credentials.json", "lock vault.json", "unlock vault.json", "unlock plugin-credentials.json"]);
    await pending;
    expect(setDone).toBe(true);
    // the set ran AFTER decrypt released: it saw the decrypted data and kept it
    expect(await store.get("token")).toEqual({ value: "SECRET-PLUGIN-VALUE" });
    expect(await store.get("late")).toEqual({ value: "NEW" });
  });

  it("X20: a failed vault write → plugin decrypted, vault failed <reason>, exit≠0, no plaintext .tmp", async () => {
    const kc = seedEncrypted();
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith(VAULT)) throw Object.assign(new Error("EACCES: secret path"), { code: "EACCES" });
      return real(from, to);
    });
    const r = await run(["decrypt", "--yes"], keyOpts(kc));
    expect(r.code).not.toBe(0);
    expect(r.out).toEqual(["plugin-credentials.json: decrypted", "vault.json: failed EACCES"]);
    expect(fs.existsSync(`${filePath("vault", home)}.tmp`)).toBe(false);
    expect(readJson("plugin-credentials")).toEqual(PLUGIN_DOC);
  });

  it("X21: crash after the 1st write → re-run finishes the rest", async () => {
    const kc = seedEncrypted();
    const real = fs.renameSync;
    const spy = vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      if (String(to).endsWith(VAULT)) throw new Error("simulated crash");
      return real(from, to);
    });
    const first = await run(["decrypt", "--yes"], keyOpts(kc));
    expect(first.code).not.toBe(0);
    spy.mockRestore();
    const second = await run(["decrypt", "--yes"], keyOpts(stubKeychain(b64(KEY_1))));
    expect(second.code).toBe(0);
    expect(second.out).toEqual(["plugin-credentials.json: already-plaintext", "vault.json: decrypted"]);
    expect(readJson("vault")).toEqual(VAULT_DOC);
  });

  describe("X22: a live server of this HOME on another port", () => {
    it("live server.pid → refuse, files unchanged, output names the pid", async () => {
      const kc = seedEncrypted();
      const before = [sha256(filePath("vault", home)), sha256(filePath("plugin-credentials", home))];
      const r = await run(["decrypt", "--yes"], { ...keyOpts(kc), readPid: () => 4242, isProcessAlive: (p) => p === 4242 });
      expect(r.code).not.toBe(0);
      expect(r.err.join("\n")).toContain("4242");
      expect([sha256(filePath("vault", home)), sha256(filePath("plugin-credentials", home))]).toEqual(before);
    });
    it("live lock-metadata pid → refuse", async () => {
      const kc = seedEncrypted();
      const r = await run(["decrypt", "--yes"], {
        ...keyOpts(kc),
        readLockMeta: () => ({ pid: 777, httpPort: 8123 }) as never,
        isProcessAlive: (p) => p === 777,
      });
      expect(r.code).not.toBe(0);
      expect(r.err.join("\n")).toContain("777");
    });
    it("stale (dead) pid + ECONNREFUSED → proceeds", async () => {
      const kc = seedEncrypted();
      const r = await run(["decrypt", "--yes"], { ...keyOpts(kc), readPid: () => 4242, isProcessAlive: () => false });
      expect(r.code).toBe(0);
    });
    it("real server.pid file naming this process is honoured by default", async () => {
      const kc = seedEncrypted();
      fs.mkdirSync(path.join(home, ".pi", "dashboard"), { recursive: true });
      fs.writeFileSync(path.join(home, ".pi", "dashboard", "server.pid"), `${process.pid}\n`);
      const r = await run(["decrypt", "--yes"], { ...keyOpts(kc), readPid: undefined, isProcessAlive: undefined });
      expect(r.code).not.toBe(0);
    });
  });
});

describe("reset (E72–E79, X27)", () => {
  /** vault locked `key_missing`: encrypted under KEY_1, the keychain holds nothing. */
  function lostKey() {
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    return stubKeychain(null);
  }

  it("E72: keychain, key lost → renamed aside, new key created once, new file decodes with it", async () => {
    const original = (() => { writeEnvelopeFile("vault", VAULT_DOC, KEY_1); return sha256(filePath("vault", home)); })();
    const kc = stubKeychain(null);
    const bytes = fs.readFileSync(filePath("vault", home));
    const r = await run(["reset", "--vault", "--yes"], keyOpts(kc));
    expect(r.code).toBe(0);
    const aside = undecryptable(VAULT);
    expect(aside).toHaveLength(1);
    expect(aside[0]).toMatch(/^vault\.json\.undecryptable-\d{8}T\d{6}Z$/);
    expect(fs.readFileSync(path.join(path.dirname(filePath("vault", home)), aside[0] as string)).equals(bytes)).toBe(true);
    expect(sha256(path.join(path.dirname(filePath("vault", home)), aside[0] as string))).toBe(original);
    expect(fs.existsSync(filePath("vault", home))).toBe(false);
    expect(kc.calls.set).toBe(1);
    expect(r.out).toContain("key: created");
    // "then add an account" (a fresh server process)
    _resetCredentialKeyForTests();
    await initCredentialKey({ homeDir: home, env: {}, entryFactory: kc.factory, log: () => {} });
    await writeVia("vault", { accounts: ["new"] });
    expect(kc.calls.set).toBe(1);
    expect(readVaultDoc(filePath("vault", home), Buffer.from(kc.lastSet as string, "base64"))).toEqual({ accounts: ["new"] });
    expect(r.text).not.toContain("SECRET-");
  });

  it("E73: no TTY and no --yes → refused, nothing renamed", async () => {
    const kc = lostKey();
    const before = sha256(filePath("vault", home));
    const r = await run(["reset", "--vault"], keyOpts(kc));
    expect(r.code).not.toBe(0);
    expect(sha256(filePath("vault", home))).toBe(before);
    expect(undecryptable(VAULT)).toHaveLength(0);
  });

  it.each([["200", reply(200)], ["401", reply(401)]])("E74: server answers %s → refused, unchanged", async (_n, fetchImpl) => {
    const kc = lostKey();
    const before = sha256(filePath("vault", home));
    const r = await run(["reset", "--vault", "--yes"], { ...keyOpts(kc), fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(r.code).not.toBe(0);
    expect(sha256(filePath("vault", home))).toBe(before);
    expect(undecryptable(VAULT)).toHaveLength(0);
  });

  it("E75: key-file source, file missing → renamed aside, no key file created, remedy printed, exit≠0", async () => {
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    const missing = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "pi-keyfile-")), "data-key");
    const r = await run(["reset", "--vault", "--yes"], { env: { [ENV_KEY]: missing } });
    expect(r.code).not.toBe(0);
    expect(undecryptable(VAULT)).toHaveLength(1);
    expect(fs.existsSync(filePath("vault", home))).toBe(false);
    expect(fs.existsSync(missing)).toBe(false);
    expect(r.out.join("\n")).toContain(`openssl rand -base64 32 > ${missing}; chmod 600 ${missing}`);
  });

  it("E76: lock sequence — plugin, vault, rename, unlock vault, unlock plugin, THEN the creation lock", async () => {
    const kc = lostKey();
    const real = fs.renameSync;
    vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
      events.push(`rename ${path.basename(String(from))}`);
      return real(from, to);
    });
    const r = await run(["reset", "--vault", "--yes"], keyOpts(kc));
    expect(r.code).toBe(0);
    expect(events).toEqual([
      "lock plugin-credentials.json",
      "lock vault.json",
      "rename vault.json",
      "unlock vault.json",
      "unlock plugin-credentials.json",
      "lock credential-key",
      "unlock credential-key",
    ]);
    expect(kc.calls.set).toBe(1);
  });

  it("E77: --plugin-credentials renames only the plugin file", async () => {
    writeEnvelopeFile("plugin-credentials", PLUGIN_DOC, KEY_1);
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    const vaultSha = sha256(filePath("vault", home));
    const r = await run(["reset", "--plugin-credentials", "--yes"], keyOpts(stubKeychain(null)));
    expect(undecryptable(PLUGIN)).toHaveLength(1);
    expect(undecryptable(VAULT)).toHaveLength(0);
    expect(sha256(filePath("vault", home))).toBe(vaultSha);
    expect(r.out.join("\n")).not.toContain("vault.json");
  });

  it("E77: an envelope that stays blocks key creation (rule D4)", async () => {
    writeEnvelopeFile("plugin-credentials", PLUGIN_DOC, KEY_1);
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    const kc = stubKeychain(null);
    await run(["reset", "--plugin-credentials", "--yes"], keyOpts(kc));
    expect(kc.calls.set).toBe(0);
  });

  it("E78: existing key kept (key_mismatch) → setPassword 0; new file decodes with key B", async () => {
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    const kc = stubKeychain(b64(KEY_2));
    const r = await run(["reset", "--vault", "--yes"], keyOpts(kc));
    expect(r.code).toBe(0);
    expect(kc.calls.set).toBe(0);
    expect(undecryptable(VAULT)).toHaveLength(1);
    _resetCredentialKeyForTests();
    await initCredentialKey({ homeDir: home, env: {}, entryFactory: kc.factory, log: () => {} });
    await writeVia("vault", { accounts: ["new"] });
    expect(readVaultDoc(filePath("vault", home), KEY_2)).toEqual({ accounts: ["new"] });
    expect(kc.calls.set).toBe(0);
  });

  it("E79: a non-locked file is left alone (`not-locked`, exit 0)", async () => {
    const kc = seedEncrypted();
    const before = sha256(filePath("vault", home));
    const r = await run(["reset", "--vault", "--yes"], keyOpts(kc));
    expect(r.code).toBe(0);
    expect(r.out).toEqual(["vault.json: not-locked"]);
    expect(sha256(filePath("vault", home))).toBe(before);
    expect(undecryptable(VAULT)).toHaveLength(0);
    expect(kc.calls.set).toBe(0);
  });

  it("E79: bare reset renames BOTH locked files with the YYYYMMDDTHHMMSSZ stamp", async () => {
    writeEnvelopeFile("plugin-credentials", PLUGIN_DOC, KEY_1);
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    const r = await run(["reset", "--yes"], { ...keyOpts(stubKeychain(null)), now: () => new Date("2026-03-04T05:06:07.890Z") });
    expect(r.code).toBe(0);
    expect(undecryptable(PLUGIN)).toEqual(["plugin-credentials.json.undecryptable-20260304T050607Z"]);
    expect(undecryptable(VAULT)).toEqual(["vault.json.undecryptable-20260304T050607Z"]);
  });

  it("E79: two resets in the same second → `-1` suffix, first backup byte-unchanged", async () => {
    const now = () => new Date("2026-03-04T05:06:07.000Z");
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    await run(["reset", "--vault", "--yes"], { ...keyOpts(stubKeychain(null)), now });
    const firstName = "vault.json.undecryptable-20260304T050607Z";
    const firstBytes = fs.readFileSync(path.join(path.dirname(filePath("vault", home)), firstName));
    writeEnvelopeFile("vault", { accounts: ["second"] }, KEY_1);
    await run(["reset", "--vault", "--yes"], { ...keyOpts(stubKeychain(null)), now });
    expect(undecryptable(VAULT).sort()).toEqual([firstName, `${firstName}-1`]);
    expect(fs.readFileSync(path.join(path.dirname(filePath("vault", home)), firstName)).equals(firstBytes)).toBe(true);
  });

  it("X27: a live server of this HOME refuses reset", async () => {
    const kc = lostKey();
    const before = sha256(filePath("vault", home));
    const r = await run(["reset", "--vault", "--yes"], { ...keyOpts(kc), readPid: () => 4242, isProcessAlive: (p) => p === 4242 });
    expect(r.code).not.toBe(0);
    expect(sha256(filePath("vault", home))).toBe(before);
    expect(undecryptable(VAULT)).toHaveLength(0);
  });
});

describe("E16b: the CLI never writes the key file", () => {
  it("key file sha256 + mtime unchanged across decrypt and reset", async () => {
    const kf = writeKeyFile(b64(KEY_1));
    const stat = () => fs.statSync(kf);
    const sha = sha256(kf);
    const mtime = stat().mtimeMs;
    writeEnvelopeFile("plugin-credentials", PLUGIN_DOC, KEY_1);
    writeEnvelopeFile("vault", VAULT_DOC, KEY_2); // locked key_mismatch
    const blocked = await run(["decrypt", "--yes"], { env: { [ENV_KEY]: kf } });
    expect(blocked.code).not.toBe(0);
    const reset = await run(["reset", "--vault", "--yes"], { env: { [ENV_KEY]: kf } });
    expect(reset.code).toBe(0);
    const dec = await run(["decrypt", "--yes"], { env: { [ENV_KEY]: kf } });
    expect(dec.code).toBe(0);
    expect(sha256(kf)).toBe(sha);
    expect(stat().mtimeMs).toBe(mtime);
  });
});

describe("review B1: a store lock compromised while held", () => {
  const compromise = () => {
    for (const report of compromisers.splice(0)) report(Object.assign(new Error("lock compromised"), { code: "ECOMPROMISED" }));
  };

  it("decrypt writes nothing and fails", async () => {
    const kc = seedEncrypted();
    const before = [sha256(filePath("plugin-credentials", home)), sha256(filePath("vault", home))];
    compromisers.length = 0;
    const r = await run(["decrypt", "--yes"], { ...keyOpts(kc), afterLocked: compromise });
    expect(r.code).toBe(1);
    expect([sha256(filePath("plugin-credentials", home)), sha256(filePath("vault", home))]).toEqual(before);
    expect(r.text).toMatch(/lock compromised/);
    expect(r.text).not.toContain("SECRET-");
  });

  it("reset renames nothing and fails", async () => {
    writeEnvelopeFile("vault", VAULT_DOC, KEY_1);
    const before = sha256(filePath("vault", home));
    compromisers.length = 0;
    const r = await run(["reset", "--vault", "--yes"], { ...keyOpts(stubKeychain(null)), afterLocked: compromise });
    expect(r.code).toBe(1);
    expect(sha256(filePath("vault", home))).toBe(before);
    expect(undecryptable(VAULT)).toHaveLength(0);
    expect(r.text).toMatch(/lock compromised/);
  });
});
