@echo off
rem Copyright (c) 2026 Celestial
rem Licensed under the PolyForm Noncommercial License 1.0.0. See LICENSE.md.
setlocal EnableExtensions

set "PUBLIC_IP=127.0.0.1"
if not defined OPAL_PORT set "OPAL_PORT=20054"
if not defined OPAL_RELAY_HOST set "OPAL_RELAY_HOST=%PUBLIC_IP%"
if not defined OPAL_PUBLIC_HOST set "OPAL_PUBLIC_HOST=%PUBLIC_IP%"
if not defined OPAL_RELAY_PORT set "OPAL_RELAY_PORT=28091"
if not defined OPAL_RELAY_BIND set "OPAL_RELAY_BIND=0.0.0.0"
set "GRANITE_LOCKSTEP_BUFFER_FRAMES=12"
set "OPAL_LOCKSTEP_DELAY_FRAMES=12"
set "OPAL_LOCKSTEP_HZ=83"
if not "%OPAL_LOCKSTEP_DELAY_FRAMES%"=="%GRANITE_LOCKSTEP_BUFFER_FRAMES%" (
  echo [ERROR] GRANITE_LOCKSTEP_BUFFER_FRAMES and OPAL_LOCKSTEP_DELAY_FRAMES must match.
  pause
  exit /b 1
)
if not defined GRANITE_PORT set "GRANITE_PORT=22000"
if not defined GRANITE_HOST set "GRANITE_HOST=0.0.0.0"

set "ROOT=%~dp0"
set "OPAL_SERVER=%ROOT%Opal"
set "GRANITE_SERVER=%ROOT%Granite\Server"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js is not available on PATH.
  pause
  exit /b 1
)

if not exist "%OPAL_SERVER%\Opal.js" (
  echo [ERROR] Opal server entry point was not found: %OPAL_SERVER%\Opal.js
  pause
  exit /b 1
)

if not exist "%GRANITE_SERVER%\Server.js" (
  echo [ERROR] Granite server entry point was not found: %GRANITE_SERVER%\Server.js
  pause
  exit /b 1
)

start "Granite HTTPS" /D "%GRANITE_SERVER%" cmd /k "node Server.js"
start "Opal WSS" /D "%OPAL_SERVER%" cmd /k "node Opal.js"

echo Granite and Opal were started in separate windows.
echo Opal WSS: wss://%OPAL_PUBLIC_HOST%:%OPAL_PORT%/  relay %OPAL_RELAY_HOST%:%OPAL_RELAY_PORT%
echo Close each server window or press Ctrl+C in it when finished.
endlocal
