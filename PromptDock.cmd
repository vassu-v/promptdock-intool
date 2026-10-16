@echo off
rem Run PromptDock straight from the source code (no installer).
rem The first run installs dependencies (~600 MB, needs internet); later runs start instantly.
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js 22 or newer is required: https://nodejs.org & pause & exit /b 1)
if not exist "node_modules\electron\dist\electron.exe" (
  echo Installing dependencies, this happens only once...
  call npm install || (pause & exit /b 1)
)
start "" "node_modules\electron\dist\electron.exe" .
