import path from "node:path";
import { REPO_ROOT } from "../lifecycle.js";

/**
 * Fixed loopback port the identity overlay (compose.test.identity.yml) publishes
 * for the in-container fake OIDC issuer, so the host mints via POST /mint.
 */
export const IDENTITY_ISSUER_PORT = Number(process.env.PW_IDENTITY_ISSUER_PORT ?? "18090");

/** Base URL of the host-mapped fake OIDC issuer. */
export const IDENTITY_ISSUER_URL =
  process.env.PW_IDENTITY_ISSUER_URL ?? `http://localhost:${IDENTITY_ISSUER_PORT}`;

/**
 * Marker for the identity-managed harness lifecycle — SEPARATE from the shared
 * suite's `.e2e-managed` so the two never tear each other down.
 */
export const IDENTITY_MARKER_PATH = path.join(REPO_ROOT, "test-results", ".e2e-identity-managed");

/** Session ids the entrypoint seeds (scripts/seed-identity-sessions.mjs). */
export const ANNA_SESSION_ID = "019f1d00-0000-7000-8000-0000000000a1";
export const BELA_SESSION_ID = "019f1d00-0000-7000-8000-0000000000b1";
