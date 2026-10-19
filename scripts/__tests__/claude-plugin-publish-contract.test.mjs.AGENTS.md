# __tests__/claude-plugin-publish-contract.test.mjs — index

Static contract over `publish.yml`. `publish` preflight reads tagged `plugin.json` (`git show "$RELEASE_TAG:..."`) before `sync-versions.js` + publish (E43). `github-release` builds the plugin zip before `Create GitHub Release`, attaches `claude-plugin-dist/*.zip` (E46).
