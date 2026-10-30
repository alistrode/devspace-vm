@echo off
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
set "PATH=%~dp0.tools\bin;%~dp0.tools\node;%~dp0.tools\npm-global;%~dp0.tools\Git\usr\bin;%~dp0.tools;%PATH%"
title DevSpace Auto Start

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] PowerShell was not found.
  exit /b 1
)

rem Run the PowerShell entry point directly. This avoids the fragile nested cmd.exe launcher.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-devspace-public.ps1" %* 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" (
  echo.
  echo DevSpace startup failed. Review the error above.
)

if not defined DEVSPACE_NO_PAUSE (
  echo.
  echo Press any key to close this window.
  pause >nul
)
exit /b %EXIT_CODE%
