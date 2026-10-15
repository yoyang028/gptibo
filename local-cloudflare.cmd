@echo off
setlocal
cd /d "%~dp0"
set "TASK_PWSH=D:\ChatGPT\CodexCache\codex-runtimes\codex-primary-runtime\dependencies\native\powershell\pwsh.exe"
if not exist "%TASK_PWSH%" set "TASK_PWSH=pwsh.exe"
"%TASK_PWSH%" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\local\cloudflare.ps1" %*
exit /b %errorlevel%
