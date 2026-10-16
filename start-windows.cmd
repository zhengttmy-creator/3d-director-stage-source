@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Please install Node.js 22 or later from https://nodejs.org/
  echo Then reopen this file.
  pause
  exit /b 1
)
node scripts/start-local.mjs
if errorlevel 1 pause
