# pairing-client.ts — index

`startPairing(target, deps)` → `PairingSession{send,stop,done}`. Phases proving → confirm → waiting → approved \| rejected \| expired \| refused \| mismatch \| unverifiable \| unreachable \| stopped. Identity proven BEFORE knock (pin ?? advert; none ⇒ TOFU confirm w/ full fp). Request sent only after user `send(name)`. Bearer + pin saved to keyring ONLY on approval. Logs short fp + host only; never bearer/code/name. Ports injected; no electron import. See change: add-electron-server-windows (D3, D11).
