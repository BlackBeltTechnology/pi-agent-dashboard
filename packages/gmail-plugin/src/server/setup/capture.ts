/**
 * Secret capture (design D8): read the new client's id + secret from the
 * creation dialog in memory; when that fails, click "Download JSON", read the
 * newest new `client_secret_*.json` in the dedicated profile's downloads dir and
 * ALWAYS delete what the click produced. The values go through the same store
 * function as `PUT /client`. Nothing here logs, returns or throws the secret.
 * See change: add-gmail-auto-setup.
 */
import { readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { SetupControl, SetupHandoff } from "./errors.js";
import { SEL, type StepEnv } from "./steps.js";

const CLIENT_ID_RE = /[A-Za-z0-9._-]{1,200}\.apps\.googleusercontent\.com/;
const SECRET_RE = /GOCSPX-[A-Za-z0-9_-]+/;
const DOWNLOAD_RE = /^client_secret_.*\.json/;

export interface CapturedClient {
  clientId: string;
  clientSecret: string;
}

/** Pure: pull id + secret out of the dialog's text. */
export function parseClientDialog(text: string): CapturedClient | undefined {
  const clientId = CLIENT_ID_RE.exec(text)?.[0];
  const clientSecret = SECRET_RE.exec(text)?.[0];
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

async function downloads(dir: string): Promise<Set<string>> {
  try {
    return new Set((await readdir(dir)).filter((f) => DOWNLOAD_RE.test(f)));
  } catch {
    return new Set();
  }
}

/** Newest file in `dir` matching the pattern that is not in `before`. */
async function newestNew(dir: string, before: Set<string>): Promise<string | undefined> {
  let best: { f: string; t: number } | undefined;
  for (const f of await downloads(dir)) {
    if (before.has(f) || !f.endsWith(".json")) continue;
    const t = (await stat(path.join(dir, f)).catch(() => undefined))?.mtimeMs ?? 0;
    if (!best || t >= best.t) best = { f, t };
  }
  return best?.f;
}

async function readDialog(env: StepEnv): Promise<CapturedClient | undefined> {
  try {
    return parseClientDialog(await env.dialogText());
  } catch (err) {
    if (err instanceof SetupControl) throw err;
    return undefined;
  }
}

async function readDownload(env: StepEnv, dir: string, before: Set<string>): Promise<CapturedClient | undefined> {
  try {
    await env.click(SEL.downloadJson);
    const file = await env.waitFor(() => newestNew(dir, before), env.timing.markerWaitMs);
    if (!file) return undefined;
    const json = JSON.parse(await readFile(path.join(dir, file), "utf8")) as {
      installed?: { client_id?: unknown; client_secret?: unknown };
    };
    const { client_id: clientId, client_secret: clientSecret } = json.installed ?? {};
    return typeof clientId === "string" && typeof clientSecret === "string" ? { clientId, clientSecret } : undefined;
  } catch (err) {
    if (err instanceof SetupControl) throw err;
    return undefined;
  }
}

export async function captureClient(env: StepEnv): Promise<void> {
  const dir = await env.downloadsDir();
  const before = await downloads(dir);
  try {
    const captured = (await readDialog(env)) ?? (await readDownload(env, dir, before));
    if (!captured) {
      await env.click(SEL.dialogClose).catch(() => undefined);
      throw new SetupHandoff("secret_capture_failed");
    }
    const stored = await env.storeClient({
      installed: { client_id: captured.clientId, client_secret: captured.clientSecret, project_id: env.projectId },
    });
    if (!stored.ok) throw new SetupHandoff(stored.error === "client_in_use" ? "client_in_use" : "secret_capture_failed");
  } catch (err) {
    if (err instanceof SetupControl) throw err;
    throw new SetupHandoff("secret_capture_failed");
  } finally {
    // Whatever the click produced is removed, also on failure.
    for (const f of await downloads(dir)) {
      if (!before.has(f)) await rm(path.join(dir, f), { force: true }).catch(() => undefined);
    }
  }
}
