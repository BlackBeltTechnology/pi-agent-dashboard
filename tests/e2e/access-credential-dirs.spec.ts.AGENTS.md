# access-credential-dirs.spec.ts — index

L3 #F6/#F7 (T.103/T.104). #F6: container-seeded `access-grants.json` holding `~/.aws` + `/fixtures/__cred-dirs-e2e__/other`; Settings ▸ Access lists only the admitted row; revoking it leaves the `~/.aws` row in the file (read back in container); store removed in `finally`. #F7 (variant harness, `PI_E2E_BROWSE_CONFINEMENT=1`): remote `/api/browse` of `~/.aws` and Chrome profile → 403, `~/.config/app` → 200. Authored without a runnable harness. See change: harden-agent-tool-guards.
