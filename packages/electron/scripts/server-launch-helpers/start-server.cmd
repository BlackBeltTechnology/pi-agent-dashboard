@echo off
rem ============================================================================
rem start-server.cmd  -  manual launch of the bundled dashboard server (Windows)
rem
rem Resolves bundled node.exe + bundled jiti loader from THIS script's location
rem and invokes the same argv shape that the Electron main process uses.
rem No system Node required.
rem
rem Usage:
rem   start-server.cmd            ^<-- defaults to: cli.ts start
rem   start-server.cmd status     ^<-- forwards "status" subcommand
rem   start-server.cmd stop
rem   start-server.cmd restart
rem
rem Argv contract: packages/shared/src/platform/node-spawn.ts
rem   :: buildNodeImportArgvParts
rem See change: add-bundle-manual-launch-scripts.
rem ============================================================================
setlocal

rem %~dp0 = directory of this script with trailing backslash
rem        e.g. C:\unzipped\PI-Dashboard-win32-x64\resources\server\
set "SVR_DIR=%~dp0"

rem Bundled node lives one level up under resources\node\
set "NODE_EXE=%SVR_DIR%..\node\node.exe"

rem Build the jiti loader file:// URL.
rem URL form requires forward slashes; %~dp0 uses backslashes.
set "SVR_URL=%SVR_DIR:\=/%"
set "JITI_URL=file:///%SVR_URL%node_modules/jiti/lib/jiti-register.mjs"

rem Entry passed as raw Windows path. Node's drive-letter heuristic
rem accepts argv-position drive letters; jiti hook then takes over.
set "CLI=%SVR_DIR%packages\server\src\cli.ts"

rem If user passed no args, default to "start"
if "%~1"=="" (
  set "ARGS=start"
) else (
  set "ARGS=%*"
)

cd /d "%SVR_DIR%"
"%NODE_EXE%" --import "%JITI_URL%" "%CLI%" %ARGS%
set "EC=%ERRORLEVEL%"

echo.
echo Server exited with code %EC%
echo Press any key to close...
pause >nul
endlocal & exit /b %EC%
