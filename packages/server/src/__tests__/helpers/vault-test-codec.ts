/**
 * Test codec for the vault consumers: the real envelope codec over a FIXED
 * 32-byte key (never a keychain, design D9). `createVaultStore` requires a codec
 * (D1), so every vault suite builds its store with one of these.
 * See change: encrypt-credentials-at-rest (D1, D9).
 */

import fs from "node:fs";
import type { CredentialKeyFailureReason } from "@blackbelt-technology/pi-dashboard-shared/credential-encryption.js";
import { createEnvelopeCodec } from "../../auth/credential-envelope.js";
import type { JsonFileCodec } from "../../auth/locked-json-file.js";
import { KEY_1 } from "./credential-key-kit.js";

/** A ready `vault` codec over `key` (default: the kit's `KEY_1`). */
export function testVaultCodec(key: Buffer = KEY_1): JsonFileCodec {
  return createEnvelopeCodec("vault", () => ({ ok: true, key }));
}

/** A `vault` codec whose key is not available (`reason`): plaintext reads, every write refused. */
export function keylessVaultCodec(reason: CredentialKeyFailureReason = "keychain_unavailable"): JsonFileCodec {
  return createEnvelopeCodec("vault", () => ({ ok: false, reason }));
}

/** The parsed document of a vault file written through `testVaultCodec` (envelope or plaintext). */
export function readVaultDoc(file: string, key: Buffer = KEY_1): Record<string, unknown> {
  const out = testVaultCodec(key).decode(fs.readFileSync(file));
  if (out.kind !== "document") throw new Error(`vault file is ${out.kind}`);
  return out.data;
}
