/**
 * Minimal software WebAuthn authenticator (ES256, `none` attestation) so the
 * passkey ceremonies are tested against the REAL `@simplewebauthn/server`
 * verifier — no mocked crypto. Test-only helper.
 * See change: add-passkey-user-auth.
 */
import crypto from "node:crypto";
import { isoCBOR } from "@simplewebauthn/server/helpers";

const b64u = (b: Uint8Array | Buffer) => Buffer.from(b).toString("base64url");
const sha256 = (b: Uint8Array | Buffer) => crypto.createHash("sha256").update(b).digest();

export interface SoftCredential {
  id: string;
  privateKey: crypto.KeyObject;
  rpId: string;
  userHandle: string;
  counter: number;
}

export function createCredential(
  options: { challenge: string; rp: { id?: string }; user: { id: string } },
  origin: string,
  flags = { uv: true },
): { response: any; credential: SoftCredential } {
  const rpId = options.rp.id!;
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const jwk = publicKey.export({ format: "jwk" });
  const cose = isoCBOR.encode(
    new Map<number, number | Uint8Array>([
      [1, 2],
      [3, -7],
      [-1, 1],
      [-2, Buffer.from(jwk.x!, "base64url")],
      [-3, Buffer.from(jwk.y!, "base64url")],
    ]),
  );
  const credId = crypto.randomBytes(16);
  const flagByte = 0x01 | (flags.uv ? 0x04 : 0) | 0x40;
  const authData = Buffer.concat([
    sha256(Buffer.from(rpId)),
    Buffer.from([flagByte]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    Buffer.from([0, credId.length]),
    credId,
    Buffer.from(cose),
  ]);
  const attestationObject = isoCBOR.encode(
    new Map<string, unknown>([
      ["fmt", "none"],
      ["attStmt", new Map()],
      ["authData", new Uint8Array(authData)],
    ]) as any,
  );
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.create", challenge: options.challenge, origin, crossOrigin: false }));
  const id = b64u(credId);
  return {
    response: {
      id,
      rawId: id,
      type: "public-key",
      response: { clientDataJSON: b64u(clientDataJSON), attestationObject: b64u(attestationObject), transports: ["internal"] },
      clientExtensionResults: {},
    },
    credential: { id, privateKey, rpId, userHandle: options.user.id, counter: 0 },
  };
}

export function getAssertion(
  cred: SoftCredential,
  options: { challenge: string; rpId?: string },
  origin: string,
  flags = { uv: true },
): any {
  cred.counter += 1;
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(cred.counter);
  const authData = Buffer.concat([sha256(Buffer.from(options.rpId ?? cred.rpId)), Buffer.from([0x01 | (flags.uv ? 0x04 : 0)]), counter]);
  const clientDataJSON = Buffer.from(JSON.stringify({ type: "webauthn.get", challenge: options.challenge, origin, crossOrigin: false }));
  const signature = crypto.sign("sha256", Buffer.concat([authData, sha256(clientDataJSON)]), cred.privateKey);
  return {
    id: cred.id,
    rawId: cred.id,
    type: "public-key",
    response: {
      authenticatorData: b64u(authData),
      clientDataJSON: b64u(clientDataJSON),
      signature: b64u(signature),
      userHandle: cred.userHandle,
    },
    clientExtensionResults: {},
  };
}
