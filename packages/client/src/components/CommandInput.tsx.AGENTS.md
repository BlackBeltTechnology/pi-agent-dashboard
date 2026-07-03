# CommandInput.tsx — index

Chat composer textarea + autocomplete. Exports `CommandInput`, `parseViewCommand`, `shouldWalkFileQuery`, `MIN_FILE_QUERY_LEN`, `DASHBOARD_LOCAL_COMMANDS`. Merges `BUILTIN_COMMANDS` + `DASHBOARD_LOCAL_COMMANDS` + server commands. `/`-command and `@`-file/URL autocomplete with viewport-flip dropdown. Intercepts `/view` → `onViewLocal` (never reaches bridge). History recall (ArrowUp/Down when empty). Stop / Force-Stop / Stop-after-turn controls; `retrying` treated as working. Controlled `draft`/`images` modes lifted to App.
