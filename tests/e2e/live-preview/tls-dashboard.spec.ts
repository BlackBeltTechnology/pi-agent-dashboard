import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, test } from "./fixture.js";
import { freePort } from "./isolated-server.js";

/**
 * L3 — the dashboard over TLS never gets a plain-http `<label>.localhost` frame (mixed content).
 * Row: test-plan #F6. See change: serve-live-previews-on-capability-origin (D1, tier selection `tls-socket`).
 *
 * How TLS is obtained without a real CA: the server's native TLS listener (`tls.enabled`) takes its certificate from a
 * source; the `tailscale` source shells out to `tailscale status --json` / `tailscale cert …`. This spec puts a FAKE
 * `tailscale` first on the server's PATH that reports MagicDNS name `localhost` and writes a self-signed `CN=localhost` cert
 * (openssl), so the listener binds `https://localhost:<tlsPort>`. The browser ignores the (self-signed) certificate errors.
 */
const FAKE_TAILSCALE = `#!/bin/sh
case "$1" in
  status) printf '%s' '{"BackendState":"Running","CertDomains":["localhost"],"Self":{"DNSName":"localhost.","TailscaleIPs":["100.64.0.7"]}}' ;;
  cert)
    shift
    while [ $# -gt 1 ]; do
      case "$1" in
        --cert-file) CERT="$2"; shift 2 ;;
        --key-file) KEY="$2"; shift 2 ;;
        *) shift ;;
      esac
    done
    exec openssl req -x509 -newkey rsa:2048 -nodes -keyout "$KEY" -out "$CERT" -subj "/CN=localhost" -days 2
    ;;
  *) exit 1 ;;
esac
`;

test.use({ ignoreHTTPSErrors: true });

test("T.F6 / #F6 dashboard over https: the viewer mints tier 5 / legacy, never an http *.localhost frame, no mixed content, the frame renders", async ({ page, isolatedServer, operator, upstream }) => {
  test.setTimeout(180_000);
  try {
    execFileSync("openssl", ["version"], { stdio: "ignore" });
  } catch {
    throw new Error("F6 needs `openssl` on PATH (the fake tailscale uses it to mint a self-signed certificate)");
  }
  const fakeBin = fs.mkdtempSync(path.join(os.tmpdir(), "pi-lp-fake-ts-"));
  fs.writeFileSync(path.join(fakeBin, "tailscale"), FAKE_TAILSCALE, { mode: 0o755 });
  const tlsPort = await freePort();
  try {
    await isolatedServer.restart({
      env: { PATH: `${fakeBin}:${process.env.PATH ?? ""}` },
      patch: { tls: { enabled: true, port: tlsPort, host: "127.0.0.1", sources: [{ type: "tailscale" }] } },
    });
    const dash = `https://localhost:${tlsPort}`;
    // The TLS listener comes up once its certificate is obtained (async): wait for a TLS answer.
    await expect
      .poll(
        async () => {
          try {
            const res = await page.request.get(`${dash}/api/health`, { ignoreHTTPSErrors: true, timeout: 5_000 });
            return res.status();
          } catch {
            return 0;
          }
        },
        { message: `the TLS listener answers on ${dash}`, timeout: 90_000, intervals: [1_000] },
      )
      .toBe(200);

    upstream.baseAware = true; // tier 5 forwards /preview/<pid>/ to the upstream
    const mixed: string[] = [];
    const httpLabelRequests: string[] = [];
    page.on("console", (m) => {
      if (/mixed content/i.test(m.text())) mixed.push(m.text());
    });
    page.on("request", (r) => {
      if (/^http:\/\/[a-z0-9]+\.localhost/.test(r.url())) httpLabelRequests.push(r.url());
    });
    const mark = isolatedServer.logMark();
    const viewer = await operator.openLivePreview(page, { dashOrigin: dash, target: upstream.url });
    expect(new URL(page.url()).protocol, "the dashboard page really is https").toBe("https:");

    const src = await viewer.src();
    expect(src, "tier 5 (/preview/<pid>/) or legacy (/live/…): same-origin path on the https dashboard").toMatch(/^\/(preview|live)\//);
    expect(src).not.toMatch(/^http:/);
    const frame = await viewer.ready("#static");
    expect(await frame.evaluate(() => document.getElementById("static")?.textContent), "the frame renders").toBe("static upstream");
    expect(new URL(frame.url()).protocol, "frame is https too").toBe("https:");

    const log = isolatedServer.livePreviewLog(mark).join("\n");
    expect(log, "mint answered tier 5 or legacy").toMatch(/mint tier=(5|legacy) /);
    expect(log, "never tier 1 / 2 / 4 over TLS").not.toMatch(/mint tier=[124] /);
    expect(httpLabelRequests, "no http://*.localhost frame was ever requested").toEqual([]);
    expect(mixed, "no mixed-content console error").toEqual([]);
  } finally {
    await isolatedServer.restart({ reset: true });
    fs.rmSync(fakeBin, { recursive: true, force: true });
  }
});
