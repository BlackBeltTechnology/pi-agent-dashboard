@echo off
rem ============================================================================
rem start-server.cmd  -  manual launch of the bundled dashboard server (Windows)
rem
rem Resolves bundled node.exe + the bundled TypeScript loader from THIS script's
rem location and invokes the same argv shape that the Electron main process uses.
rem Loader: the Node-native register module (the only server loader).
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
rem See changes: add-bundle-manual-launch-scripts, fix-appimage-cold-boot-latency,
rem strip-only-native-ts-loader.
rem ============================================================================
setlocal

rem %~dp0 = directory of this script with trailing backslash
rem        e.g. C:\unzipped\PI-Dashboard-win32-x64\resources\server\
set "SVR_DIR=%~dp0"

rem Bundled node lives one level up under resources\node\
set "NODE_EXE=%SVR_DIR%..\node\node.exe"

rem Build the TypeScript loader file:// URL (Node-native register module only).
rem URL form requires forward slashes; %~dp0 uses backslashes.
rem Entry: RAW Windows path (Node path.resolve()s the main entry under any
rem --import loader, so a file:// entry breaks).
set "SVR_URL=%SVR_DIR:\=/%"
set "LOADER_URL=file:///%SVR_URL%node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs"
set "CLI=%SVR_DIR%packages\server\src\cli.ts"

rem If user passed no args, default to "start"
if "%~1"=="" (
  set "ARGS=start"
) else (
  set "ARGS=%*"
)

cd /d "%SVR_DIR%"
"%NODE_EXE%" --import "%LOADER_URL%" "%CLI%" %ARGS%
set "EC=%ERRORLEVEL%"

echo.
echo Server exited with code %EC%
echo Press any key to close...
pause >nul
endlocal & exit /b %EC%
