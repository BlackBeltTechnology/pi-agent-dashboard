/**
 * Test fixtures: a local fake GitHub release server, archive builders and
 * tmp-dir bookkeeping. Never touches the network or the real $HOME.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as http from "node:http";
import * as os from "node:os";
import * as path from "node:path";

const tmpDirs: string[] = [];
export function tmpDir(prefix = "pcraft-"): string {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tmpDirs.push(d);
  return d;
}
export function cleanupTmp(): void {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
}

export const sha256 = (b: Buffer | string): string => createHash("sha256").update(b).digest("hex");

export const STUB_VERSION_OUTPUT = "photocraft-cli 0.7.0 (stub)";

/** A tiny executable stand-in for photocraft-cli. */
export const STUB_BINARY = `#!/bin/sh\necho "${STUB_VERSION_OUTPUT}"\n`;

function sh(cmd: string, args: string[], cwd?: string): void {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed: ${r.stderr}`);
}

/** tar.gz of `files` (relative path → content; mode 0755 for names under bin/ or ending in photocraft-cli). */
export function makeTarGz(files: Record<string, string>): Buffer {
  const dir = tmpDir("pcraft-src-");
  for (const [rel, content] of Object.entries(files)) {
    const p = path.join(dir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, content);
    fs.chmodSync(p, rel.includes("bin/") || rel.endsWith("-cli") ? 0o755 : 0o644);
  }
  const out = path.join(tmpDir("pcraft-ar-"), "a.tar.gz");
  sh("tar", ["-czf", out, "-C", dir, "."]);
  return fs.readFileSync(out);
}

/** Archive crafted with python (entries tar/zip cannot be made by the CLI tools). */
export function craftArchive(kind: "tar-traversal" | "tar-absolute" | "tar-symlink" | "tar-hardlink" | "zip-symlink"): Buffer {
  const out = path.join(tmpDir("pcraft-craft-"), kind.startsWith("zip") ? "a.zip" : "a.tar.gz");
  const script = `
import sys, io, tarfile, zipfile
kind, out = sys.argv[1], sys.argv[2]
if kind.startswith("tar"):
    t = tarfile.open(out, "w:gz")
    def add(name, data=b"x", mode=0o644, type=tarfile.REGTYPE, link=""):
        i = tarfile.TarInfo(name); i.size = len(data) if type == tarfile.REGTYPE else 0
        i.mode = mode; i.type = type; i.linkname = link
        t.addfile(i, io.BytesIO(data) if type == tarfile.REGTYPE else None)
    add("root/bin/photocraft-cli", b"#!/bin/sh\\necho ok\\n", 0o755)
    if kind == "tar-traversal": add("../../x")
    if kind == "tar-absolute": add("/tmp/pcraft-abs-x")
    if kind == "tar-symlink": add("root/link", type=tarfile.SYMTYPE, link="/etc/passwd")
    if kind == "tar-hardlink": add("root/hard", type=tarfile.LNKTYPE, link="root/bin/photocraft-cli")
    t.close()
else:
    z = zipfile.ZipFile(out, "w")
    z.writestr("photocraft-cli", "#!/bin/sh\\necho ok\\n")
    i = zipfile.ZipInfo("link"); i.create_system = 3; i.external_attr = (0o120777 << 16)
    z.writestr(i, "/etc/passwd")
    z.close()
`;
  const r = spawnSync("python3", ["-c", script, kind, out], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`python3 craft failed: ${r.stderr}`);
  return fs.readFileSync(out);
}

export function isBsdtar(): boolean {
  const r = spawnSync("tar", ["--version"], { encoding: "utf8" });
  return /bsdtar/.test(r.stdout);
}

export interface FixtureOptions {
  /** `owner/name` of the fake repository; default `storytold/photocraft`. */
  repo?: string;
  tag?: string;
  /** asset name → bytes served for it. */
  assets: Record<string, Buffer>;
  /** SHA256SUMS.txt body; default: correct digests for every asset. `null` → 404. */
  sums?: string | null;
  /** Latest endpoint status override (e.g. 403). */
  latestStatus?: number;
  /** Cut the connection after this fraction of an asset body. */
  truncateAt?: number;
  /** Delay (ms) before serving asset bodies. */
  assetDelayMs?: number;
  /** Omit these asset names from the release JSON. */
  hide?: string[];
}

export interface Fixture {
  url: string;
  requests: { method: string; url: string; auth?: string }[];
  close: () => Promise<void>;
}

export async function startFixture(o: FixtureOptions): Promise<Fixture> {
  const tag = o.tag ?? "v0.7.0";
  const repo = o.repo ?? "storytold/photocraft";
  const requests: Fixture["requests"] = [];
  const sumsBody =
    o.sums === undefined ? `${Object.entries(o.assets).map(([n, b]) => `${sha256(b)}  ${n}`).join("\n")}\n` : o.sums;
  let base = "";
  const releaseJson = () => ({
    tag_name: tag,
    assets: [
      ...Object.entries(o.assets)
        .filter(([n]) => !(o.hide ?? []).includes(n))
        .map(([name, b]) => ({ name, size: b.length, browser_download_url: `${base}/download/${tag}/${name}` })),
      { name: "SHA256SUMS.txt", size: (sumsBody ?? "").length, browser_download_url: `${base}/download/${tag}/SHA256SUMS.txt` },
    ],
  });

  const server = http.createServer((req, res) => {
    const url = req.url ?? "";
    requests.push({ method: req.method ?? "GET", url, auth: req.headers.authorization });
    if (url === `/repos/${repo}/releases/latest`) {
      if (o.latestStatus) {
        res.writeHead(o.latestStatus).end("{}");
        return;
      }
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(releaseJson()));
      return;
    }
    if (url === `/repos/${repo}/releases/tags/${tag}`) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(releaseJson()));
      return;
    }
    const m = /^\/download\/[^/]+\/(.+)$/.exec(url);
    if (m) {
      const name = decodeURIComponent(m[1]);
      if (name === "SHA256SUMS.txt") {
        if (sumsBody === null) res.writeHead(404).end();
        else res.writeHead(200).end(sumsBody);
        return;
      }
      const body = o.assets[name];
      if (!body) {
        res.writeHead(404).end();
        return;
      }
      setTimeout(() => {
        if (o.truncateAt !== undefined) {
          const cut = Math.floor(body.length * o.truncateAt);
          res.writeHead(200, { "content-length": String(body.length) });
          res.write(body.subarray(0, cut), () => setTimeout(() => res.destroy(), 20));
          return;
        }
        res.writeHead(200, { "content-length": String(body.length) }).end(body);
      }, o.assetDelayMs ?? 0);
      return;
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return {
    url: base,
    requests,
    close: () => new Promise<void>((r) => (server.closeAllConnections(), server.close(() => r()))),
  };
}
