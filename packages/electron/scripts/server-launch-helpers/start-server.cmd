@echo off
rem ============================================================================
rem start-server.cmd  -  manual launch of the bundled dashboard server (Windows)
rem
rem Resolves bundled node.exe + the bundled TypeScript loader from THIS script's
rem location and invokes the same argv shape that the Electron main process uses.
rem Loader: Node-native (default) or jiti when PI_DASHBOARD_TS_LOADER=jiti.
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
rem See changes: add-bundle-manual-launch-scripts, fix-appimage-cold-boot-latency.
rem ============================================================================
setlocal

rem %~dp0 = directory of this script with trailing backslash
rem        e.g. C:\unzipped\PI-Dashboard-win32-x64\resources\server\
set "SVR_DIR=%~dp0"

rem Bundled node lives one level up under resources\node\
set "NODE_EXE=%SVR_DIR%..\node\node.exe"

rem Build the TypeScript loader file:// URL (native default, jiti opt-in).
rem URL form requires forward slashes; %~dp0 uses backslashes.
rem Entry: RAW Windows path for both loaders (Node path.resolve()s the main
rem entry, so a file:// entry breaks; jiti also misnormalises file:/// URLs).
set "SVR_URL=%SVR_DIR:\=/%"
rem Unknown non-empty values warn and fall back to native (parity with selectTsLoader).
if not "%PI_DASHBOARD_TS_LOADER%"=="" if not "%PI_DASHBOARD_TS_LOADER%"=="jiti" if not "%PI_DASHBOARD_TS_LOADER%"=="native" (
  echo WARNING: unknown PI_DASHBOARD_TS_LOADER="%PI_DASHBOARD_TS_LOADER%"; using the native TypeScript loader ^(valid: native, jiti^). 1>&2
)
if "%PI_DASHBOARD_TS_LOADER%"=="jiti" (
  set "LOADER_URL=file:///%SVR_URL%node_modules/jiti/lib/jiti-register.mjs"
) else (
  set "LOADER_URL=file:///%SVR_URL%node_modules/@blackbelt-technology/pi-dashboard-shared/src/platform/native-ts-register.mjs"
)
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
