/**
 * Webhook URL validation + SSRF policy at registration: scheme allowlist, no
 * userinfo, link-local/metadata refused (literal, numeric, mapped, resolved),
 * the dashboard's own port refused on local addresses, LAN allowed.
 * Harness: `localhost-guard.test.ts` (pure address predicates) + route inject.
 * See change: add-server-push-notifications (test-plan #E29–#E32).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createPushService, type PushService } from "../push/push-service.js";
import {
  isBlockedAddress,
  type LookupAll,
  redactWebhookUrl,
  resolveAndVet,
  validateWebhookUrl,
} from "../push/push-transports/webhook-url.js";
import { registerPushRoutes } from "../routes/push-routes.js";

const SELF_PORT = 8123;

describe("webhook URL helpers", () => {
  it.each(["file:///etc/passwd", "ftp://h/", "javascript:alert(1)", "/relative", "http://u:p@h/"])(
    "validateWebhookUrl rejects %s (test-plan #E29)",
    (raw) => {
      expect(validateWebhookUrl(raw).ok).toBe(false);
    },
  );

  it("validateWebhookUrl canonicalises numeric hosts", () => {
    const v = validateWebhookUrl("http://2852039166/");
    expect(v.ok && v.url.hostname).toBe("169.254.169.254");
  });

  it.each([
    ["169.254.169.254", true],
    ["169.254.0.0", true],
    ["169.254.255.255", true],
    ["169.253.255.255", false],
    ["169.255.0.0", false],
    ["fe80::1", true],
    ["febf::1", true],
    ["fec0::1", false],
    ["fd00:ec2::254", true],
    ["fd00:ec2::253", false],
    ["::ffff:169.254.169.254", true],
    ["::ffff:a9fe:a9fe", true],
    ["[::ffff:a9fe:a9fe]", true],
    ["127.0.0.1", false],
    ["192.168.1.20", false],
    ["not-an-ip", false],
  ])("isBlockedAddress(%s) === %s", (ip, expected) => {
    expect(isBlockedAddress(ip)).toBe(expected);
  });

  it("resolveAndVet refuses when any resolved record is blocked (test-plan #E31)", async () => {
    const lookupAll: LookupAll = async () => [
      { address: "192.168.1.20", family: 4 },
      { address: "169.254.1.1", family: 4 },
    ];
    expect((await resolveAndVet("mixed.example", 80, SELF_PORT, lookupAll)).ok).toBe(false);
  });

  it("resolveAndVet refuses the dashboard's own port on loopback only", async () => {
    expect((await resolveAndVet("127.0.0.1", SELF_PORT, SELF_PORT)).ok).toBe(false);
    expect((await resolveAndVet("[::1]", SELF_PORT, SELF_PORT)).ok).toBe(false);
    expect((await resolveAndVet("127.0.0.1", SELF_PORT + 1, SELF_PORT)).ok).toBe(true);
    expect((await resolveAndVet("192.168.1.20", SELF_PORT, SELF_PORT)).ok).toBe(true);
  });

  it("resolveAndVet refuses the self port via an IPv4-mapped local-interface address", async () => {
    const lan = Object.values(os.networkInterfaces())
      .flat()
      .find((i) => i && i.family === "IPv4" && !i.internal);
    const targets = ["[::ffff:127.0.0.1]", "[::ffff:7f00:1]", ...(lan ? [`[::ffff:${lan.address}]`, lan.address] : [])];
    for (const host of targets) {
      expect((await resolveAndVet(host, SELF_PORT, SELF_PORT)).ok, host).toBe(false);
    }
    // A mapped LAN address on another port stays allowed.
    if (lan) expect((await resolveAndVet(`[::ffff:${lan.address}]`, SELF_PORT + 1, SELF_PORT)).ok).toBe(true);
  });

  it("resolveAndVet refuses an unresolvable host", async () => {
    const lookupAll: LookupAll = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
    };
    expect((await resolveAndVet("nx.example", 80, null, lookupAll)).ok).toBe(false);
  });

  it("redactWebhookUrl renders label (origin) or origin only", () => {
    expect(redactWebhookUrl("https://hooks.example:8443/api/hooks/h1?key=s3cret", "nanoMuse")).toBe(
      "nanoMuse (https://hooks.example:8443)",
    );
    expect(redactWebhookUrl("http://192.168.1.20:8787/api/hooks/h1?key=k")).toBe("http://192.168.1.20:8787");
  });
});

describe("POST /api/push/register — webhook SSRF policy", () => {
  let tmpDir: string;
  let service: PushService;
  let app: FastifyInstance;
  let lookupAnswer: Array<{ address: string; family: 4 | 6 }>;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "push-webhook-url-test-"));
    lookupAnswer = [{ address: "192.168.1.20", family: 4 }];
    service = createPushService({
      config: { enabled: true, coalesceWindowMs: 30_000 },
      dataDir: tmpDir,
      getSession: () => undefined,
      selfPort: () => SELF_PORT,
      logger: { info() {}, warn() {}, error() {} },
      lookupAll: async () => lookupAnswer,
    });
    app = Fastify();
    registerPushRoutes(app, { getPush: () => service });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    service.shutdown();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const register = (deviceToken: string) =>
    app.inject({ method: "POST", url: "/api/push/register", payload: { transport: "webhook", deviceToken } });

  it.each(["file:///etc/passwd", "ftp://h/", "javascript:alert(1)", "/relative", "http://u:p@h/"])(
    "%s → 400, nothing stored (test-plan #E29)",
    async (url) => {
      expect((await register(url)).statusCode).toBe(400);
      expect(service.registry.list()).toHaveLength(0);
    },
  );

  it.each([
    ["http://169.254.169.254/latest/meta-data", 400],
    ["http://2852039166/", 400],
    ["http://[::ffff:169.254.169.254]/", 400],
    ["http://[fe80::1]/", 400],
    ["http://[fd00:ec2::254]/", 400],
    ["http://169.253.255.255/", 200],
    ["http://169.255.0.0/", 200],
  ])("%s → %i (test-plan #E30)", async (url, status) => {
    const before = service.registry.list().length;
    const res = await register(url);
    expect(res.statusCode).toBe(status);
    expect(service.registry.list().length).toBe(status === 200 ? before + 1 : before);
  });

  it("a hostname with any blocked record → 400 (test-plan #E31)", async () => {
    lookupAnswer = [
      { address: "192.168.1.20", family: 4 },
      { address: "169.254.1.1", family: 4 },
    ];
    expect((await register("http://mixed.example/hook")).statusCode).toBe(400);
    expect(service.registry.list()).toHaveLength(0);
  });

  it("self port on loopback → 400; other port and LAN → 200 (test-plan #E32)", async () => {
    expect((await register(`http://127.0.0.1:${SELF_PORT}/api/restart`)).statusCode).toBe(400);
    expect((await register(`http://127.0.0.1:${SELF_PORT + 1}/hook`)).statusCode).toBe(200);
    expect((await register("http://192.168.1.20:8787/api/hooks/h1?key=k")).statusCode).toBe(200);
    expect(service.registry.list()).toHaveLength(2);
  });

  it("the 400 body carries a reason but never echoes the URL", async () => {
    const res = await register("http://169.254.169.254/latest/meta-data?key=s3cret");
    expect(res.statusCode).toBe(400);
    expect(typeof res.json().error).toBe("string");
    expect(res.body).not.toContain("s3cret");
    expect(res.body).not.toContain("meta-data");
  });
});
