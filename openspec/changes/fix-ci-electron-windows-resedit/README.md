# fix-ci-electron-windows-resedit

Fix Windows VERSIONINFO (FileVersion + ProductVersion) parse failures on ci-electron prerelease slugs by pinning packagerConfig.buildVersion and Windows-only appVersion to a 4-integer string derived from MAJOR.MINOR.PATCH + GITHUB_RUN_NUMBER.
