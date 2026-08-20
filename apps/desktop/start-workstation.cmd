@echo off
setlocal
cd /d "%~dp0..\.."
if exist "apps\desktop\bin\ZeroTrace.exe" (
  "apps\desktop\bin\ZeroTrace.exe"
  exit /b %ERRORLEVEL%
)
powershell -NoProfile -ExecutionPolicy Bypass -File "scripts\start-dev-workstation.ps1"
exit /b %ERRORLEVEL%
