/**
 * Operator-host test doubles (change: add-operator-browser-relay): a carrier
 * socket that can be observed message-by-message, a real Ed25519 identity, and
 * helpers that drive the host side of the registration / connect / link flow
 * against a `RelayManager` the way Electron main + the SPA carrier would.
 */
import { generateKeyPairSync, type KeyObject, sign } from "node:crypto";
import {
  buildHostSignedMessage,
  hostIdFromPublicKey,
} from "@blackbelt-technology/pi-dashboard-shared/browser-host-identity.js";
import type { RelayManager } from "../relay-manager.js";
import { FakeExtension, FakeSocket, type FakeTab } from "./fake-socket.js";

export interface HostIdentity {
  hostId: string;
  publicKey: string;
  privateKey: KeyObject;
}

export function makeIdentity(): HostIdentity {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return { hostId: hostIdFromPublicKey(pub), publicKey: pub, privateKey };
}

export function signFor(id: HostIdentity, nonce: string, serverId: string): string {
  return sign(null, Buffer.from(buildHostSignedMessage(nonce, serverId)), id.privateKey).toString("base64");
}

/** A carrier `/ws` socket whose outbound messages can be observed as they happen. */
export class FakeCarrier extends FakeSocket {
  private readonly taps: Array<(msg: Record<string, unknown>) => void> = [];

  override send(data: string): void {
    super.send(data);
    const msg = JSON.parse(data) as Record<string, unknown>;
    for (const tap of this.taps) tap(msg);
  }

  onMessage(fn: (msg: Record<string, unknown>) => void): void {
    this.taps.push(fn);
  }

  ofType(type: string): Array<Record<string, unknown>> {
    return this.json().filter((m) => m.type === type);
  }
}

export const SERVER_ID = "server-I";

export const profileRows = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    profileDirectory: i === 0 ? "Default" : `Profile ${i}`,
    label: `P${i}`,
    installed: true,
  }));

/** hello → challenge → register over `carrier`. Resolves once the host is bound (or refused). */
export async function registerHost(
  manager: RelayManager,
  carrier: FakeCarrier,
  id: HostIdentity,
  profiles: Array<Record<string, unknown>> = profileRows(1),
  serverId = SERVER_ID,
): Promise<void> {
  await manager.hosts.handle({ type: "browser_host_hello", hostId: id.hostId, publicKey: id.publicKey }, carrier);
  const challenge = carrier.ofType("browser_host_challenge").at(-1);
  if (!challenge) return;
  await manager.hosts.handle(
    {
      type: "browser_host_register",
      hostId: id.hostId,
      signature: signFor(id, challenge.nonce as string, serverId),
      label: "mac-home",
      platform: "darwin",
      canOpenChrome: true,
      profiles,
    },
    carrier,
  );
}

/** The newest `browser_host_connect` the carrier received (the host's view of the request). */
export function lastConnect(carrier: FakeCarrier): { requestId: string; linkId: string; instanceId: string; profileDirectory: string } {
  const m = carrier.ofType("browser_host_connect").at(-1);
  if (!m) throw new Error("no browser_host_connect sent");
  return m as never;
}

export function answerConnect(
  manager: RelayManager,
  carrier: FakeCarrier,
  ok: boolean,
  reason?: string,
  requestId = lastConnect(carrier).requestId,
): void {
  manager.handleHostMessage(
    { type: "browser_host_connect_result", requestId, ok, ...(reason ? { reason } : {}) },
    carrier,
  );
}

/**
 * The extension half of one link: relay frames sent on the carrier reach it,
 * its replies go back as `browser_host_ext_data` (what Electron's shim does).
 */
export function attachLinkedExtension(
  manager: RelayManager,
  carrier: FakeCarrier,
  linkId: string,
  tabs: FakeTab[] = [{ id: 7, title: "A", url: "https://a.test/" }],
): FakeExtension {
  const extSide = new FakeSocket();
  extSide.send = (data: string) => {
    extSide.sent.push(data);
    manager.handleHostMessage({ type: "browser_host_ext_data", linkId, data }, carrier);
  };
  carrier.onMessage((m) => {
    if (m.linkId !== linkId) return;
    if (m.type === "browser_host_relay_data") extSide.deliver(m.data);
    else if (m.type === "browser_host_relay_close") extSide.remoteClose(Number(m.code), String(m.reason ?? ""));
  });
  return new FakeExtension(extSide, tabs);
}

/**
 * Drive one whole operator connect from the host side: consent ok → ext_open →
 * extension handshake. Returns the pending `connect()` promise's inputs.
 */
export function completeConnect(
  manager: RelayManager,
  carrier: FakeCarrier,
  tabs?: FakeTab[],
): { linkId: string; requestId: string; instanceId: string; ext: FakeExtension } {
  const { requestId, linkId, instanceId } = lastConnect(carrier);
  answerConnect(manager, carrier, true);
  // The extension must be listening on the link before `ext_open` attaches it.
  const ext = attachLinkedExtension(manager, carrier, linkId, tabs);
  manager.handleHostMessage({ type: "browser_host_ext_open", linkId }, carrier);
  ext.initialize();
  return { linkId, requestId, instanceId, ext };
}
