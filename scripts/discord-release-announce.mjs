#!/usr/bin/env node
/**
 * Post a GitHub release's notes — the full body, never truncated — to a Discord
 * webhook. Called by the `discord-announce` job in .github/workflows/publish.yml.
 *
 * Usage: DISCORD_WEBHOOK_URL=… node scripts/discord-release-announce.mjs <release.json> [tag]
 *   release.json = `gh release view <tag> --json name,url,body`
 *
 * One embed per message, description ≤ 4000 chars (Discord cap 4096); long
 * bodies continue in numbered follow-ups. Every message sets
 * `allowed_mentions: { parse: [] }` so release text can never ping anyone.
 * Errors carry Discord's status + response body, never the webhook URL.
 * See change: discord-release-full-changelog.
 */

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const LIMIT = 4000;
const TITLE_MAX = 256;
const COLOR = 5793266;
const MAX_RETRIES = 5;
const MAX_RETRY_AFTER_S = 60;

/** Cut index ≤ `end` that never separates a UTF-16 surrogate pair. */
function safeCut(text, end) {
  const code = text.charCodeAt(end - 1);
  return code >= 0xd800 && code <= 0xdbff ? end - 1 : end;
}

/**
 * Split `body` into chunks of at most `limit` chars. Chunks break after a
 * newline whenever a line fits; a longer line is hard-split. For a non-empty
 * body `splitBody(body).join("") === body` (CRLF and trailing newline kept).
 */
export function splitBody(body, limit = LIMIT) {
  const chunks = [];
  let cur = "";
  for (const segment of body.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    if (cur.length + segment.length <= limit) {
      cur += segment;
      continue;
    }
    if (cur) chunks.push(cur);
    cur = segment;
    while (cur.length > limit) {
      const cut = safeCut(cur, limit);
      chunks.push(cur.slice(0, cut));
      cur = cur.slice(cut);
    }
  }
  if (cur) chunks.push(cur);
  return chunks;
}

/** Build one webhook payload per chunk of the release body. */
export function buildPayloads(release, tag = "") {
  const chunks = splitBody(release.body ?? "");
  if (chunks.length === 0) chunks.push("_No release notes._");
  const n = chunks.length;
  const longestSuffix = n > 1 ? ` (${n}/${n})`.length : 0;
  const maxName = TITLE_MAX - "Released ".length - longestSuffix;
  let name = release.name || tag;
  if (name.length > maxName) name = `${name.slice(0, safeCut(name, maxName - 1))}…`;
  return chunks.map((description, i) => ({
    username: "pi-dashboard releases",
    allowed_mentions: { parse: [] },
    embeds: [{
      title: i === 0 ? `Released ${name}` : `Released ${name} (${i + 1}/${n})`,
      url: release.url,
      color: COLOR,
      description,
    }],
  }));
}

/** POST payloads in order; retry 429 up to MAX_RETRIES. Throws on failure. */
export async function postPayloads(payloads, webhookUrl, { fetch = globalThis.fetch, sleep } = {}) {
  const wait = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  for (const payload of payloads) {
    for (let attempt = 0; ; attempt++) {
      let res;
      try {
        res = await fetch(`${webhookUrl}?wait=true`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {
        // Node's fetch errors can embed the URL (= webhook token); never surface them.
        throw new Error("Discord webhook request failed (network error)");
      }
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        const retryAfter = Number(data.retry_after) > 0 ? Number(data.retry_after) : 1;
        if (retryAfter > MAX_RETRY_AFTER_S) {
          throw new Error(`Discord webhook rate-limited (429): retry_after ${retryAfter}s exceeds ${MAX_RETRY_AFTER_S}s`);
        }
        if (attempt >= MAX_RETRIES) {
          throw new Error(`Discord webhook rate-limited (429) after ${MAX_RETRIES} retries`);
        }
        await wait(retryAfter * 1000);
        continue;
      }
      if (!res.ok) throw new Error(`Discord webhook failed: ${res.status} ${await res.text().catch(() => "")}`);
      break;
    }
  }
}

async function main() {
  const [file, tag = ""] = process.argv.slice(2);
  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl) {
    console.log("DISCORD_WEBHOOK_URL not set — skipping Discord announcement");
    return;
  }
  if (!file) throw new Error("usage: discord-release-announce.mjs <release.json> [tag]");
  const payloads = buildPayloads(JSON.parse(readFileSync(file, "utf8")), tag);
  await postPayloads(payloads, webhookUrl);
  console.log(`Announced ${tag || "release"} on Discord (${payloads.length} message(s))`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
