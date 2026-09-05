# useContentViews.ts — index

URL-routing navigation helpers. `handleOpenDirectorySettings(cwd)` (renamed from `handleOpenPiResources`, change: add-folder-actions-menu — route + label always said Directory Settings, only the name lagged) navigates to `buildFolderSettingsUrl(cwd)`. `handleViewPiResourceFile(filePath, title)` navigates to `buildPiResourceFileUrl(filePath, title)`. Takes `navigate: (to: string) => void`.
