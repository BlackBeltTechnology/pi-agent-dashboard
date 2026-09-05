# useInstallPrompt.ts — index

PWA install-prompt state. Returns `{ canInstall, isInstalled, isIOS, prompt }`. Defers `beforeinstallprompt` event; `isInstalled`/`isIOS` detected via `display-mode: standalone` + UA. `prompt()` triggers deferred install.
