# instance-directory.ts — index

`listLocalInstances()` / `resolveInstanceRef()` / `formatInstanceLine()` — enumerates `gateway-*.sock` under the HOME config dir for `/dashboard-list` + connect-target resolution. **DISPLAY-ONLY D2 carve-out**: scans so a human can choose, never feeds automatic endpoint selection; ambiguous id prefix is REFUSED, not guessed; exact id beats prefix. Nothing on the bridge's auto-connect path may import it. See change: add-pi-gateway-transport-identity (D11b, tasks 9.5/9.6).
