/**
 * Connect flow: build the extension's `connect.html` URL, open it in the target
 * Chrome profile, await the relay handshake (change: add-browser-relay, task
 * 2.8 / design D4).
 *
 * The connect URL is the ONLY credential handoff in the system, and it carries
 * two things the settings UI must explain honestly:
 *
 *  - `token` is appended ONLY when the profile sets `zeroDialog`. Without it the
 *    extension shows its own Allow/Reject dialog once per connect — the human
 *    gate. With it, Chrome skips the dialog, which is why the token is
 *    `writeOnly` config and never served to a client.
 *  - A token MISMATCH is indistinguishable from Reject or from no answer:
 *    the extension refuses inside its own page and NOTHING reaches the relay
 *    (research §7). All three surface as the same 60 s timeout (504). Do not
 *    "improve" this into a distinct error — the relay cannot tell them apart.
 *
 * Accepted exposure (documented in the proposal): the URL, guid and possibly
 * token appear in Chrome's argv for the launch, readable by the same user via
 * `ps` — the same trust boundary as the same-user-readable token file. The guid
 * is single-claim and expires in 60 s.
 */
// Safe wrapper (uniform `windowsHide`); the repo bans direct node:child_process
// imports outside platform/exec.ts.
import { spawn } from "@blackbelt-technology/pi-dashboard-shared/platform/exec.js";
import { buildChromeOpenCommand } from "./capability.js";

/** The pinned Playwright Chrome Extension. Kept in one place (design risk note). */
export const PLAYWRIGHT_EXTENSION_ID = "mmlmfjhmonkocbjadbfplnigmagldckm";

/** Protocol version the extension requires. Bump only with the extension. */
const EXTENSION_PROTOCOL_VERSION = "2";

export interface ConnectUrlOptions {
  port: number;
  guid: string;
  profileToken?: string;
  /** Append `&token=` so Chrome skips its Allow dialog. */
  zeroDialog?: boolean;
  extensionId?: string;
}

/**
 * `chrome-extension://<id>/connect.html?mcpRelayUrl=…&client=…&protocolVersion=2[&token=…]`
 *
 * Built with `URL` so the `client` JSON is encoded rather than string-spliced.
 */
export function buildConnectUrl(opts: ConnectUrlOptions): string {
  const id = opts.extensionId ?? PLAYWRIGHT_EXTENSION_ID;
  const url = new URL(`chrome-extension://${id}/connect.html`);
  url.searchParams.set("mcpRelayUrl", `ws://127.0.0.1:${opts.port}/ws/browser-ext/${opts.guid}`);
  url.searchParams.set("client", JSON.stringify({ name: "pi-dashboard" }));
  url.searchParams.set("protocolVersion", EXTENSION_PROTOCOL_VERSION);
  if (opts.zeroDialog && typeof opts.profileToken === "string" && opts.profileToken.length > 0) {
    url.searchParams.set("token", opts.profileToken);
  }
  return url.toString();
}

export interface OpenChromeDeps {
  platform?: NodeJS.Platform;
  /** Injectable opener (tests assert argv without spawning). */
  run?: (cmd: string, args: string[]) => void;
}

export function openChromeProfile(
  profileDirectory: string,
  url: string,
  deps: OpenChromeDeps = {},
): void {
  const platform = deps.platform ?? process.platform;
  const { cmd, args } = buildChromeOpenCommand(platform, profileDirectory, url);
  if (deps.run) {
    deps.run(cmd, args);
    return;
  }
  // Detached fire-and-forget: Chrome outlives the request, and a failed launch
  // surfaces as the handshake timeout (504), which is the same observable as a
  // user who never clicked Allow.
  const child = spawn(cmd, args, { windowsHide: true, detached: true, shell: false, stdio: "ignore" });
  child.on("error", () => {
    /* reported via the connect timeout */
  });
  child.unref();
}
