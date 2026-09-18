/**
 * In-container fake OIDC issuer runner for the identity-plane E2E (§11.2).
 *
 * Boots the shared lightweight fake issuer on a FIXED port so (a) the
 * in-container keycloak-resolver can discover it at the loopback issuer URL and
 * (b) the Playwright host can mint tokens through the compose-mapped port. This
 * replaces a real Keycloak in the test loop — the resolver still does real OIDC
 * discovery + JWKS + RS256 verification. Dev/test ONLY; never shipped.
 *
 * Launched by test-entrypoint.sh (as /app/scripts/fake-oidc-run.ts) when
 * PI_E2E_IDENTITY=1. Lives under scripts/ because the Dockerfile bakes scripts/
 * into the image but not docker/.
 */
import { startFakeOidcIssuer } from "@blackbelt-technology/pi-dashboard-shared/test-support/fake-oidc-issuer.js";

const port = Number(process.env.PI_E2E_IDENTITY_PORT ?? "18090");
const audience = process.env.PI_E2E_IDENTITY_AUDIENCE ?? "pi-dashboard";
// Bind 0.0.0.0 so a compose-mapped port reaches /mint from the host; advertise
// a stable loopback issuer the in-container resolver + token `iss` agree on.
const issuerUrl = process.env.PI_E2E_IDENTITY_ISSUER ?? `http://127.0.0.1:${port}`;

const issuer = await startFakeOidcIssuer({ host: "0.0.0.0", port, audience, issuerUrl });
console.log(`[fake-oidc] issuer=${issuer.issuer} audience=${issuer.audience} bind=0.0.0.0:${port}`);

const shutdown = () => {
  void issuer.close().then(() => process.exit(0));
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
