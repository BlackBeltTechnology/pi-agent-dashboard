# trust-mode-boot.ts — index

`decideBootTrustMode({write?,load?})`, called first in `createServer`. `pair` iff every trusted-list entry `isLoopbackOnlyEntry`, else `legacy`. Persists with origin `upgrade`. Unparseable config.json never written (fallback `legacy` + error). Write failure → process fallback + error, decided again next boot. See change: retire-trusted-networks-bypass.
