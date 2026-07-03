# PackageReadmeDialog.tsx — index

Dialog fetching + rendering a package README. Exports `PackageReadmeDialog`. Fetches `/api/packages/readme?pkg=<name>`, renders via `MarkdownContent`. Header shows version + install/uninstall button depending on `installed`. Cancels fetch on unmount.
