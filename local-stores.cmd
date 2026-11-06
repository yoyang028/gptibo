@echo off
setlocal
cd /d "%~dp0"
set "STORES_NODE=D:\ChatGPT\CodexCache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
if not exist "%STORES_NODE%" set "STORES_NODE=node.exe"
if /i "%~1"=="codes" (
  "%STORES_NODE%" scripts\sites\codes.mjs
  pause
  exit /b 0
)
"%STORES_NODE%" scripts\sites\build.mjs
if errorlevel 1 exit /b %errorlevel%
"%STORES_NODE%" scripts\sites\local.mjs
exit /b %errorlevel%
