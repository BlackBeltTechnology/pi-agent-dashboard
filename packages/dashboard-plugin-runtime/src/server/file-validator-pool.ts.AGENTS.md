# file-validator-pool.ts — index

`createFileValidatorPool({size=2,queueMax=8,timeoutMs=5000})` / `getFileValidatorPool()`. `worker_threads` pool running plugin validators; outcome `ok{bytes}`\|`rejected`\|`error`\|`timeout`\|`busy`. Bytes transferred to worker and back; hard `terminate()` on timeout; overflow → `busy`; validator that mutates bytes → `error`. Worker `resourceLimits` 256/64 MiB. See change: add-editor-pane-file-handlers.
