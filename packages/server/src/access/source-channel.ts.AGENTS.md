# source-channel.ts — index

`sourceChannel(ip)` -> remote requester key by allocation: IPv4 `/24`, IPv6 `/64` (hextets expanded, zone stripped), `::ffff:` mapped as IPv4, else `source:<raw>`/`source:unknown`. Used by `server.ts` network observer + `denial-hold.ts`; subject stays exact address. See change: add-access-grant-dialog (D9 resolved, rotating sources).
