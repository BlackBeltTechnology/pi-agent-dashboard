/**
 * Unit tests for scripts/discord-release-announce.mjs — posts the full GitHub
 * release body to Discord, split across ≤ 4000-char embeds.
 * See change: discord-release-full-changelog (test-plan #E1-#E9, #X1-#X5).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPayloads, postPayloads, splitBody } from "../discord-release-announce.mjs";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const SCRIPT = path.resolve(__dirname, "..", "discord-release-announce.mjs");
const release = { name: "v1.2.3", url: "https://github.com/o/r/releases/tag/v1.2.3", body: "## Added\n- a\n- b" };
const WEBHOOK = "https://discord.com/api/webhooks/123456/s3cr3t-t0ken";

const lines = (n, width) => Array.from({ length: n }, (_, i) => `- change ${i} ${"y".repeat(width)}`).join("\n");
const respond = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

describe("splitBody", () => {
  it("E2: a 4000-char body is one chunk; 4001 chars split in two, losslessly", () => {
    const base = `${"a".repeat(1999)}\n${"b".repeat(2000)}`; // 4000 chars
    expect(base).toHaveLength(4000);
    expect(splitBody(base, 4000)).toEqual([base]);
    const over = `${base}c`;
    const chunks = splitBody(over, 4000);
    expect(chunks).toHaveLength(2);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join("")).toBe(over);
  });

  it("E4: hard-splits a single overlong line into 4000-char pieces", () => {
    const body = "x".repeat(9000);
    const chunks = splitBody(body, 4000);
    expect(chunks.map((c) => c.length)).toEqual([4000, 4000, 1000]);
    expect(chunks.join("")).toBe(body);
  });

  it("E5: round-trips byte-exact with CRLF, an overlong line and a trailing newline", () => {
    const body = `## Added\r\n- one\r\n${"z".repeat(5000)}\r\n${lines(150, 30).replaceAll("\n", "\r\n")}\r\n`;
    const chunks = splitBody(body, 4000);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(4000);
    expect(chunks.join("")).toBe(body);
  });

  it("E6: an empty body yields no chunks", () => {
    expect(splitBody("", 4000)).toEqual([]);
  });

  it("never splits a surrogate pair at a chunk boundary", () => {
    const body = `${"a".repeat(3999)}\u{1F600}${"b".repeat(10)}`; // emoji occupies code units 3999-4000
    const chunks = splitBody(body, 4000);
    expect(chunks.join("")).toBe(body);
    for (const c of chunks) {
      expect(c.length).toBeLessThanOrEqual(4000);
      expect(/[\uD800-\uDBFF]$/.test(c)).toBe(false);
      expect(/^[\uDC00-\uDFFF]/.test(c)).toBe(false);
    }
  });
});

describe("buildPayloads", () => {
  it("E1: a short body posts as one titled, linked payload", () => {
    const payloads = buildPayloads(release);
    expect(payloads).toHaveLength(1);
    const [embed] = payloads[0].embeds;
    expect(embed.title).toBe("Released v1.2.3");
    expect(embed.url).toBe(release.url);
    expect(embed.description).toBe(release.body);
  });

  it("E3: a long body posts in full across numbered, linked payloads", () => {
    const body = lines(600, 40);
    const payloads = buildPayloads({ ...release, body });
    const n = payloads.length;
    expect(n).toBeGreaterThan(1);
    for (const p of payloads) {
      expect(p.embeds).toHaveLength(1);
      expect(p.embeds[0].description.length).toBeLessThanOrEqual(4000);
      expect(p.embeds[0].url).toBe(release.url);
    }
    expect(payloads.map((p) => p.embeds[0].description).join("")).toBe(body);
    expect(payloads[0].embeds[0].title).toBe("Released v1.2.3");
    for (let i = 1; i < n; i++) expect(payloads[i].embeds[0].title).toBe(`Released v1.2.3 (${i + 1}/${n})`);
  });

  it("E6: an empty body posts one placeholder payload", () => {
    const payloads = buildPayloads({ ...release, body: "" });
    expect(payloads).toHaveLength(1);
    expect(payloads[0].embeds[0].description).toBe("_No release notes._");
  });

  it("E7: an unnamed release uses the tag", () => {
    expect(buildPayloads({ ...release, name: "" }, "v9.9.9")[0].embeds[0].title).toBe("Released v9.9.9");
  });

  it("E8: long names are shortened so every title fits 256 chars", () => {
    const name = "n".repeat(300);
    const payloads = buildPayloads({ ...release, name, body: "q".repeat(9000) });
    expect(payloads).toHaveLength(3);
    for (const p of payloads) expect(p.embeds[0].title.length).toBeLessThanOrEqual(256);
    expect(payloads[1].embeds[0].title.endsWith("… (2/3)")).toBe(true);
    expect(payloads[0].embeds[0].title.endsWith("…")).toBe(true);
  });

  it("E6: a null body (gh returns null for empty notes) posts one placeholder payload", () => {
    expect(buildPayloads({ ...release, body: null })[0].embeds[0].description).toBe("_No release notes._");
  });

  it("never splits a surrogate pair when shortening a long name", () => {
    const name = `${"n".repeat(245)}\u{1F600}${"m".repeat(50)}`;
    for (const p of buildPayloads({ ...release, name })) {
      const { title } = p.embeds[0];
      expect(title.length).toBeLessThanOrEqual(256);
      expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(title)).toBe(false);
    }
  });

  it("E9: every payload suppresses mentions", () => {
    const body = Array.from({ length: 400 }, (_, i) => `- @everyone @here <@123> <@&456> line ${i}`).join("\n");
    const payloads = buildPayloads({ ...release, body });
    expect(payloads.length).toBeGreaterThan(1);
    for (const p of payloads) expect(p.allowed_mentions).toEqual({ parse: [] });
  });
});

describe("postPayloads", () => {
  const payloads = buildPayloads({ ...release, body: "q".repeat(9000) }); // 3 payloads

  it("X2: a webhook failure stops posting and never exposes the webhook URL", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond(200, {}))
      .mockResolvedValueOnce(respond(500, { message: "boom" }));
    const sleep = vi.fn();
    const err = await postPayloads(payloads, WEBHOOK, { fetch, sleep }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toContain("500");
    expect(err.message).toContain("boom");
    expect(err.message).not.toContain("s3cr3t-t0ken");
    expect(err.message).not.toContain("123456");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("X2: a rejected request never exposes the webhook URL", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError(`Failed to parse URL from ${WEBHOOK}?wait=true`));
    const err = await postPayloads(payloads, WEBHOOK, { fetch, sleep: vi.fn() }).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).not.toContain("s3cr3t-t0ken");
    expect(err.message).not.toContain("123456");
  });

  it("X2: an error body echoing the webhook URL or token is redacted", async () => {
    const fetch = vi.fn().mockResolvedValue(respond(400, { message: `bad ${WEBHOOK} token=s3cr3t-t0ken id=123456` }));
    const err = await postPayloads(payloads, WEBHOOK, { fetch, sleep: vi.fn() }).catch((e) => e);
    expect(err.message).toContain("400");
    expect(err.message).not.toContain("s3cr3t-t0ken");
    expect(err.message).not.toContain("123456");
  });

  it("X2: an unreadable error body still reports the status", async () => {
    const fetch = vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => ({}), text: async () => { throw new Error("no body"); } });
    await expect(postPayloads(payloads, WEBHOOK, { fetch, sleep: vi.fn() })).rejects.toThrow(/502/);
  });

  it("X3: a non-numeric retry_after still waits a real interval", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond(429, { retry_after: "oops" }))
      .mockResolvedValue(respond(200, {}));
    const sleep = vi.fn(async () => {});
    await postPayloads(payloads, WEBHOOK, { fetch, sleep });
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(Number.isFinite(sleep.mock.calls[0][0])).toBe(true);
    expect(sleep.mock.calls[0][0]).toBeGreaterThan(0);
  });

  it("X3: a 429 is retried after retry_after, preserving order", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(respond(429, { retry_after: 0.01 }))
      .mockResolvedValue(respond(200, {}));
    const sleep = vi.fn(async () => {});
    await postPayloads(payloads, WEBHOOK, { fetch, sleep });
    const sent = fetch.mock.calls.map(([, init]) => JSON.parse(init.body).embeds[0].title);
    expect(sent).toEqual(["Released v1.2.3", "Released v1.2.3", "Released v1.2.3 (2/3)", "Released v1.2.3 (3/3)"]);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(sleep.mock.calls[0][0]).toBeGreaterThanOrEqual(10);
  });

  it("X4: gives up after 5 retries of the same payload", async () => {
    const fetch = vi.fn().mockResolvedValue(respond(429, { retry_after: 0.01 }));
    const sleep = vi.fn(async () => {});
    await expect(postPayloads(payloads, WEBHOOK, { fetch, sleep })).rejects.toThrow(/429/);
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("X5: a retry_after above 60 s aborts without waiting", async () => {
    const fetch = vi.fn().mockResolvedValue(respond(429, { retry_after: 120 }));
    const sleep = vi.fn(async () => {});
    await expect(postPayloads(payloads, WEBHOOK, { fetch, sleep })).rejects.toThrow(/retry_after/);
    expect(sleep).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("CLI", () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("X1: skips with exit 0 when DISCORD_WEBHOOK_URL is unset", () => {
    dir = mkdtempSync(path.join(os.tmpdir(), "discord-announce-"));
    const file = path.join(dir, "release.json");
    writeFileSync(file, JSON.stringify(release));
    const env = { ...process.env };
    delete env.DISCORD_WEBHOOK_URL;
    const res = spawnSync(process.execPath, [SCRIPT, file, "v1.2.3"], { env, encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("skipping");
  });
});
