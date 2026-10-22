# server-error-classification.ts — index

Pure `isDeadlineOrChildExitError(message)` returns true for messages starting with "Server did not respond within" or "Server child process exited prematurely". Drives main.ts routing: terminal errors → Setup/Retry/Quit dialog; deadline/child-exit → fall through to loading page. Drift-guarded against `buildServerStartupError` prefixes. See change: tighten-electron-server-startup-deadline.
