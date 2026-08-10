# file-preview-survives-churn.spec.ts — index

Playwright spec. Rendered-DOM regression for hoisted file-preview overlay. Routes `/api/open-editor`→500 to force preview path. Sends `[[faux:text-realfile]]`, clicks `./hello.txt` FileLink, asserts `file-preview-overlay` visible + shows live content "hello from the sample-git fixture". Churns: sends `[[faux:slow-stream]]`, asserts overlay stays open + content intact through streaming (`slow-chunk-0`) and streaming→committed (`slow-chunk-39`). Esc dismisses. Needs `PI_E2E_SEED=1`. See change: fix-file-preview-survives-message-churn.
