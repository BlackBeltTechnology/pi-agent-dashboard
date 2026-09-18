/**
 * Live integration check (NOT shipped, dev-only): drives the real
 * keycloak-resolver against a running Keycloak, mirroring index.ts wiring.
 * Run: KC=http://localhost:18080 tsx docker/fixtures/keycloak/live-resolver-check.ts
 */
import { readFileSync } from "node:fs";
import { JtiReplayCache } from "../../../packages/keycloak-resolver-plugin/src/server/dpop.js";
import { JwksSource } from "../../../packages/keycloak-resolver-plugin/src/server/jwks.js";
import { createKeycloakResolver } from "../../../packages/keycloak-resolver-plugin/src/server/resolver.js";
import {
  activeConfig,
  parseKeycloakResolverConfig,
} from "../../../packages/keycloak-resolver-plugin/src/shared/config.js";

const KC = process.env.KC ?? "http://localhost:18080";
const issuer = `${KC}/realms/pi-identity`;

const active = activeConfig(
  parseKeycloakResolverConfig({ issuer, audience: "pi-dashboard", allowInsecureHttp: true }),
);
if (!active) throw new Error("config did not activate (issuer/audience/insecure-http)");

const resolve = createKeycloakResolver({
  config: active,
  jwks: new JwksSource(active),
  replayCache: new JtiReplayCache(),
});

function tokenFor(user: string): string {
  const d = JSON.parse(readFileSync(`/tmp/tok-${user}.json`, "utf8"));
  if (!d.access_token) throw new Error(`no token for ${user}`);
  return d.access_token as string;
}

async function check(user: string) {
  const out = await resolve({
    method: "GET",
    url: `${KC}/`,
    authorization: `Bearer ${tokenFor(user)}`,
  });
  if (out && "principal" in out) {
    console.log(`${user}: RESOLVED → iss=${out.principal.iss} sub=${out.principal.sub}`);
    return out.principal.sub;
  }
  console.log(`${user}: NOT resolved →`, JSON.stringify(out));
  return null;
}

async function main() {
  const anna = await check("anna");
  const bela = await check("bela");

  // Isolation invariant: two distinct principals, both resolved, different subs.
  const ok = anna && bela && anna !== bela;
  console.log(`\nISOLATION: ${ok ? "PASS" : "FAIL"} (anna.sub !== bela.sub: ${anna !== bela})`);

  // Forged/foreign token must NOT resolve to a principal.
  const foreign = await resolve({
    method: "GET",
    url: `${KC}/`,
    authorization: "Bearer eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJodHRwczovL2V2aWwuZXhhbXBsZSJ9.x",
  });
  console.log(`FOREIGN issuer token: ${foreign === null ? "PASS (null, not ours)" : `FAIL → ${JSON.stringify(foreign)}`}`);

  process.exit(ok ? 0 : 1);
}

void main();
