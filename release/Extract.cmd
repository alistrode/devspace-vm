@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Extract.ps1"
if errorlevel 1 pause
